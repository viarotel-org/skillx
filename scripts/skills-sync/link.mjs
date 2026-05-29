import { lstat, mkdir, readlink, symlink, unlink } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { mapWithConcurrency } from './concurrency.mjs'
import { assertDirectory, discoverSkillDirs, resolveInside, SKILLS_ROOT } from './fs.mjs'

/**
 * @typedef {import('./link-config.mjs').LinkConfig} LinkConfig
 * @typedef {import('./link-config.mjs').LinkTarget} LinkTarget
 */

/**
 * @typedef {object} LinkSkill
 * @property {string} name
 * @property {string} sourcePath
 */

/**
 * @typedef {object} LinkTask
 * @property {LinkTarget} target
 * @property {LinkSkill} skill
 * @property {string} linkPath
 */

/**
 * @typedef {'created' | 'fixed' | 'planned' | 'skipped' | 'warned' | 'failed'} LinkTaskStatus
 */

/**
 * @typedef {object} LinkTaskResult
 * @property {LinkTaskStatus} status
 * @property {'create' | 'fix' | 'skip' | 'warn' | 'failed'} action
 * @property {string} targetPath
 * @property {string} targetDisplayPath
 * @property {string} skillName
 * @property {string} linkPath
 * @property {string} sourcePath
 * @property {string} [message]
 */

/**
 * @typedef {object} LinkTargetSummary
 * @property {LinkTarget} target
 * @property {number} total
 * @property {number} completed
 * @property {number} created
 * @property {number} fixed
 * @property {number} skipped
 * @property {number} warned
 * @property {number} failed
 * @property {string | null} firstError
 */

/**
 * @typedef {object} LinkRunSummary
 * @property {number} durationMs
 * @property {number} skillCount
 * @property {number} targetCount
 * @property {number} totalOps
 * @property {number} created
 * @property {number} fixed
 * @property {number} skipped
 * @property {number} warned
 * @property {number} failed
 * @property {LinkTargetSummary[]} targets
 * @property {LinkTaskResult[]} results
 */

/**
 * @typedef {object} LinkRunOptions
 * @property {boolean} [dryRun]
 * @property {boolean} [force]
 * @property {boolean} [verbose]
 */

/**
 * @typedef {object} Logger
 * @property {(message: string) => void} info
 * @property {(message: string) => void} success
 * @property {(message: string) => void} warn
 * @property {(message: string) => void} error
 * @property {(message: string) => void} debug
 */

/**
 * @param {string} cwd
 * @param {LinkConfig} config
 * @param {LinkRunOptions} [options]
 * @param {Logger} [logger]
 * @returns {Promise<LinkRunSummary>}
 */
export async function linkSkillDirectories(cwd, config, options = {}, logger) {
  const startedAt = Date.now()
  const skills = await scanLinkSkills(cwd)
  const tasks = createLinkTasks(config.targets, skills)
  const results = await mapWithConcurrency(tasks, config.concurrency, task => processLinkTask(task, options))
  const summary = createLinkRunSummary({
    startedAt,
    skills,
    targets: config.targets,
    results,
  })

  if (options.verbose && logger) {
    for (const result of results) {
      logger.info(formatVerboseResult(result))
    }
  }

  return summary
}

/**
 * @param {string} cwd
 * @returns {Promise<LinkSkill[]>}
 */
export async function scanLinkSkills(cwd) {
  const skillsRootPath = resolveInside(cwd, SKILLS_ROOT)
  await assertDirectory(skillsRootPath, 'Skills root')

  const discoveredSkills = await discoverSkillDirs(skillsRootPath)
  return discoveredSkills
    .filter(skill => skill.relativePath !== '.' && !skill.relativePath.includes('/'))
    .map(skill => ({
      name: skill.relativePath,
      sourcePath: skill.absolutePath,
    }))
}

/**
 * @param {LinkTarget[]} targets
 * @param {LinkSkill[]} skills
 * @returns {LinkTask[]}
 */
export function createLinkTasks(targets, skills) {
  return targets.flatMap(target => skills.map(skill => ({
    target,
    skill,
    linkPath: path.join(target.absolutePath, ...skill.name.split('/')),
  })))
}

/**
 * @param {LinkTask} task
 * @param {LinkRunOptions} options
 * @returns {Promise<LinkTaskResult>}
 */
export async function processLinkTask(task, options = {}) {
  try {
    return await processLinkTaskUnsafe(task, options)
  }
  catch (error) {
    return createTaskResult(task, {
      status: 'failed',
      action: 'failed',
      message: formatLinkError(error),
    })
  }
}

/**
 * @param {LinkTask} task
 * @param {LinkRunOptions} options
 * @returns {Promise<LinkTaskResult>}
 */
async function processLinkTaskUnsafe(task, options) {
  const existingLinkStat = await lstatIfExists(task.linkPath)
  if (!existingLinkStat) {
    if (!options.dryRun) {
      await mkdir(path.dirname(task.linkPath), { recursive: true })
      await createSkillSymlink(task.skill.sourcePath, task.linkPath)
    }

    return createTaskResult(task, {
      status: options.dryRun ? 'planned' : 'created',
      action: 'create',
      message: options.dryRun ? 'Would create link.' : 'Created link.',
    })
  }

  if (!existingLinkStat.isSymbolicLink()) {
    return createTaskResult(task, {
      status: 'warned',
      action: 'warn',
      message: 'Path exists and is not a symbolic link; leaving it unchanged.',
    })
  }

  const currentTarget = await readlink(task.linkPath)
  const resolvedCurrentTarget = path.resolve(path.dirname(task.linkPath), currentTarget)
  const resolvedExpectedTarget = path.resolve(task.skill.sourcePath)
  if (resolvedCurrentTarget === resolvedExpectedTarget) {
    return createTaskResult(task, {
      status: 'skipped',
      action: 'skip',
      message: 'Link already points to the expected skill.',
    })
  }

  if (!options.force) {
    return createTaskResult(task, {
      status: 'warned',
      action: 'warn',
      message: `Link points to ${currentTarget}; use --force to repair it.`,
    })
  }

  if (!options.dryRun) {
    await unlink(task.linkPath)
    await createSkillSymlink(task.skill.sourcePath, task.linkPath)
  }

  return createTaskResult(task, {
    status: options.dryRun ? 'planned' : 'fixed',
    action: 'fix',
    message: options.dryRun ? 'Would repair link.' : 'Repaired link.',
  })
}

/**
 * @param {string} sourcePath
 * @param {string} linkPath
 * @returns {Promise<void>}
 */
async function createSkillSymlink(sourcePath, linkPath) {
  try {
    await symlink(sourcePath, linkPath, 'dir')
  }
  catch (error) {
    throw createSymlinkError(error)
  }
}

/**
 * @param {{ startedAt: number, skills: LinkSkill[], targets: LinkTarget[], results: LinkTaskResult[] }} input
 * @returns {LinkRunSummary}
 */
export function createLinkRunSummary(input) {
  const targets = input.targets.map(target => summarizeTarget(target, input.results))

  return {
    durationMs: Date.now() - input.startedAt,
    skillCount: input.skills.length,
    targetCount: input.targets.length,
    totalOps: input.targets.length * input.skills.length,
    created: countResults(input.results, 'created'),
    fixed: countResults(input.results, 'fixed'),
    skipped: countResults(input.results, 'skipped'),
    warned: countResults(input.results, 'warned'),
    failed: countResults(input.results, 'failed'),
    targets,
    results: input.results,
  }
}

/**
 * @param {LinkRunSummary} summary
 * @returns {boolean}
 */
export function hasLinkFailures(summary) {
  return summary.failed > 0 || summary.warned > 0
}

/**
 * @param {LinkRunSummary} summary
 * @returns {string[]}
 */
export function formatLinkSummary(summary) {
  return [
    ...summary.targets.map(formatTargetSummary),
    '',
    `Total: ${summary.targetCount} targets × ${summary.skillCount} skills = ${summary.totalOps} ops`,
    `Done in ${formatDuration(summary.durationMs)} | skipped ${summary.skipped} failed ${summary.failed}${summary.warned > 0 ? ` warned ${summary.warned}` : ''}`,
  ]
}

/**
 * @param {LinkTarget} target
 * @param {LinkTaskResult[]} results
 * @returns {LinkTargetSummary}
 */
function summarizeTarget(target, results) {
  const targetResults = results.filter(result => result.targetPath === target.absolutePath)
  const failed = countResults(targetResults, 'failed')
  const warned = countResults(targetResults, 'warned')

  return {
    target,
    total: targetResults.length,
    completed: targetResults.length - failed - warned,
    created: countResults(targetResults, 'created'),
    fixed: countResults(targetResults, 'fixed'),
    skipped: countResults(targetResults, 'skipped'),
    warned,
    failed,
    firstError: targetResults.find(result => result.status === 'failed' || result.status === 'warned')?.message ?? null,
  }
}

/**
 * @param {LinkTaskResult[]} results
 * @param {LinkTaskStatus} status
 * @returns {number}
 */
function countResults(results, status) {
  return results.filter(result => result.status === status).length
}

/**
 * @param {LinkTargetSummary} targetSummary
 * @returns {string}
 */
function formatTargetSummary(targetSummary) {
  const mark = targetSummary.failed > 0 || targetSummary.warned > 0 ? '✖' : '✔'
  const details = []
  if (targetSummary.failed > 0) {
    details.push(`${targetSummary.failed} failed`)
  }

  if (targetSummary.warned > 0) {
    details.push(`${targetSummary.warned} warned`)
  }

  const suffix = details.length > 0 ? ` (${details.join(', ')})` : ''
  return `target: ${targetSummary.target.displayPath} ${mark} ${targetSummary.completed}/${targetSummary.total}${suffix}`
}

/**
 * @param {number} durationMs
 * @returns {string}
 */
function formatDuration(durationMs) {
  if (durationMs < 1000) {
    return `${durationMs}ms`
  }

  return `${(durationMs / 1000).toFixed(1)}s`
}

/**
 * @param {LinkTaskResult} result
 * @returns {string}
 */
function formatVerboseResult(result) {
  return `${result.action}: ${result.targetDisplayPath}/${result.skillName} -> ${result.sourcePath}${result.message ? ` (${result.message})` : ''}`
}

/**
 * @param {LinkTask} task
 * @param {{ status: LinkTaskStatus, action: LinkTaskResult['action'], message?: string }} result
 * @returns {LinkTaskResult}
 */
function createTaskResult(task, result) {
  return {
    status: result.status,
    action: result.action,
    targetPath: task.target.absolutePath,
    targetDisplayPath: task.target.displayPath,
    skillName: task.skill.name,
    linkPath: task.linkPath,
    sourcePath: task.skill.sourcePath,
    message: result.message,
  }
}

/**
 * @param {string} targetPath
 * @returns {Promise<import('node:fs').Stats | null>}
 */
async function lstatIfExists(targetPath) {
  try {
    return await lstat(targetPath)
  }
  catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return null
    }

    throw error
  }
}

/**
 * @param {unknown} error
 * @returns {Error}
 */
function createSymlinkError(error) {
  const message = formatLinkError(error)
  const symlinkError = new Error(message)
  symlinkError.cause = error

  return symlinkError
}

/**
 * @param {unknown} error
 * @returns {string}
 */
export function formatLinkError(error, platform = process.platform) {
  if (isNodeError(error) && platform === 'win32' && ['EPERM', 'EACCES'].includes(error.code)) {
    return `${error.message}. Creating directory symlinks on Windows requires Developer Mode or administrator privileges.`
  }

  if (error instanceof Error) {
    return error.message
  }

  return String(error)
}

/**
 * @param {unknown} error
 * @returns {error is NodeJS.ErrnoException}
 */
function isNodeError(error) {
  return error instanceof Error && 'code' in error
}
