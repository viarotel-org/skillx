#!/usr/bin/env node
import { rm } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { getErrorMessage, loadSkillsConfig } from './skills-sync/config.mjs'
import {
  acquireSyncLock,
  assertDirectory,
  atomicReplaceDirectory,
  cleanupRunWorkspace,
  copyDirectory,
  createManifest,
  createRunWorkspace,
  discoverSkillDirs,
  ensureDirectory,
  filterSkillDirs,
  getStaleManagedIds,
  listUnknownSkillDirs,
  MANIFEST_PATH,
  planSkillTargets,
  readManifest,
  removeGeneratedSkillDir,
  resolveInside,
  SKILLS_ROOT,
  writeManifest,
} from './skills-sync/fs.mjs'
import { classifyGitError, cloneSource, formatCommandError, getHeadCommit } from './skills-sync/git.mjs'
import { createLogger } from './skills-sync/logger.mjs'
import { createSummary, writeSummaryFiles } from './skills-sync/summary.mjs'

/**
 * @typedef {object} SyncOptions
 * @property {string} [configPath]
 * @property {boolean} [dryRun]
 * @property {boolean} [keepTemp]
 * @property {boolean} [verbose]
 * @property {string} [cwd]
 */

/**
 * @typedef {object} Logger
 * @property {(message: string) => void} info
 * @property {(message: string) => void} success
 * @property {(message: string) => void} warn
 * @property {(message: string) => void} error
 * @property {(message: string) => void} debug
 * @property {(message: string) => void} group
 * @property {() => void} groupEnd
 */

/**
 * @typedef {object} SourceConfig
 * @property {string} id
 * @property {string} url
 * @property {string} branch
 * @property {string} path
 * @property {'flat' | 'nested'} mode
 * @property {boolean} enabled
 * @property {boolean} preserveOnFailure
 * @property {number} cloneTimeoutMs
 * @property {number} cloneMaxAttempts
 * @property {string[]} includes
 * @property {string[]} excludes
 * @property {unknown} priority
 */

/**
 * @typedef {object} SkillsConfig
 * @property {string} configPath
 * @property {string[]} protectedIds
 * @property {SourceConfig[]} sources
 */

/**
 * @typedef {object} RunWorkspace
 * @property {string} workspacePath
 * @property {string} reposPath
 * @property {string} stagingPath
 * @property {string} backupsPath
 */

/**
 * @typedef {object} ManifestSource
 * @property {string} [commit]
 * @property {string[]} [targets]
 * @property {string[]} [skillPaths]
 */

/**
 * @typedef {object} Manifest
 * @property {number} version
 * @property {Record<string, ManifestSource>} sources
 */

if (isDirectCli()) {
  await runCli(process.argv.slice(2))
}

/**
 * @param {string[]} args
 * @returns {Promise<void>}
 */
export async function runCli(args) {
  const options = parseArgs(args)
  const logger = createLogger({ verbose: options.verbose })

  try {
    await syncSkills(options, logger)
  }
  catch (error) {
    logger.error(getErrorMessage(error))
    process.exitCode = 1
  }
}

/**
 * @param {SyncOptions} [options]
 * @param {Logger} [logger]
 * @returns {Promise<void>}
 */
export async function syncSkills(options = {}, logger = createLogger()) {
  const cwd = options.cwd ?? process.cwd()
  const releaseLock = await acquireSyncLock(cwd)

  try {
    await syncSkillsWithLock(cwd, options, logger)
  }
  finally {
    await releaseLock()
  }
}

/**
 * @param {string} cwd
 * @param {SyncOptions} options
 * @param {Logger} logger
 * @returns {Promise<void>}
 */
async function syncSkillsWithLock(cwd, options, logger) {
  const config = /** @type {SkillsConfig} */ (await loadSkillsConfig({ cwd, configPath: options.configPath }))
  const summary = createSummary({ dryRun: options.dryRun, configPath: config.configPath })
  const enabledSources = config.sources.filter(source => source.enabled)
  const skippedSources = config.sources.filter(source => !source.enabled)
  const previousManifest = /** @type {Manifest | null} */ (await readManifest(cwd, MANIFEST_PATH))
  const runWorkspace = await createRunWorkspace(cwd, { dryRun: options.dryRun })

  summary.totalSources = config.sources.length
  summary.skipped.push(...skippedSources.map(source => ({
    id: source.id,
    message: 'Source is disabled.',
  })))

  logger.info(`Loaded ${config.sources.length} sources from ${config.configPath}.`)
  if (options.dryRun) {
    logger.info('Dry-run mode is enabled. Repository files will not be changed.')
  }

  try {
    await prepareLocalDirectories(cwd, options)

    const syncedManifestSources = []
    const activeManagedTargets = []

    for (const source of enabledSources) {
      const result = await syncSource(cwd, source, runWorkspace, options, logger)

      if (result.status === 'synced') {
        summary.synced.push(result)
        syncedManifestSources.push(result)
        activeManagedTargets.push(...(result.targets ?? []))
        continue
      }

      summary.failed.push(result)
      const previousSource = previousManifest?.sources?.[source.id]
      if (source.preserveOnFailure && previousSource) {
        activeManagedTargets.push(...getPreviousManagedTargets(source.id, previousSource))
        syncedManifestSources.push({
          id: source.id,
          url: source.url,
          branch: source.branch,
          path: source.path,
          mode: previousSource.mode ?? source.mode,
          includes: previousSource.includes ?? source.includes,
          excludes: previousSource.excludes ?? source.excludes,
          commit: previousSource.commit,
          status: 'preserved',
          targets: getPreviousManagedTargets(source.id, previousSource),
          skillPaths: previousSource.skillPaths ?? [],
        })
      }
    }

    await handleStaleManagedDirectories(cwd, previousManifest, activeManagedTargets, config.protectedIds, summary, options, logger)
    await reportUnknownDirectories(cwd, activeManagedTargets, config.protectedIds, summary, logger)

    const nextManifest = createManifest(syncedManifestSources)
    await writeManifest(cwd, nextManifest, { dryRun: options.dryRun })
    await writeSummaryFiles(cwd, summary)

    logger.success(`Sync finished: ${summary.synced.length} synced, ${summary.failed.length} failed, ${summary.skipped.length} skipped.`)
    if (summary.failed.length > 0) {
      logger.warn('Some sources failed. See .skills-sync/summary.md for details.')
    }
  }
  finally {
    await cleanupRunWorkspace(runWorkspace.workspacePath, { keepTemp: options.keepTemp })
  }
}

/**
 * @param {string} cwd
 * @param {SyncOptions} options
 * @returns {Promise<void>}
 */
async function prepareLocalDirectories(cwd, options) {
  await ensureDirectory(resolveInside(cwd, SKILLS_ROOT), { dryRun: options.dryRun })
}

/**
 * @param {string} cwd
 * @param {Manifest | null} previousManifest
 * @param {string[]} currentManagedTargetIds
 * @param {string[]} protectedIds
 * @param {import('./skills-sync/summary.mjs').SyncSummary} summary
 * @param {SyncOptions} options
 * @param {Logger} logger
 * @returns {Promise<void>}
 */
async function handleStaleManagedDirectories(cwd, previousManifest, currentManagedTargetIds, protectedIds, summary, options, logger) {
  const staleManagedIds = getStaleManagedIds(previousManifest, currentManagedTargetIds, protectedIds)
  for (const staleManagedId of staleManagedIds) {
    if (options.dryRun) {
      summary.stalePlanned.push(staleManagedId)
      logger.warn(`Dry-run would remove stale generated directory skills/${staleManagedId}.`)
      continue
    }

    await removeGeneratedSkillDir(cwd, staleManagedId)
    summary.staleRemoved.push(staleManagedId)
    logger.warn(`Removed stale generated directory skills/${staleManagedId}.`)
  }
}

/**
 * @param {string} cwd
 * @param {string[]} knownDirectoryIds
 * @param {string[]} protectedIds
 * @param {import('./skills-sync/summary.mjs').SyncSummary} summary
 * @param {Logger} logger
 * @returns {Promise<void>}
 */
async function reportUnknownDirectories(cwd, knownDirectoryIds, protectedIds, summary, logger) {
  const unknownDirs = await listUnknownSkillDirs(cwd, knownDirectoryIds, protectedIds)
  summary.unknownDirs.push(...unknownDirs)

  for (const unknownDir of unknownDirs) {
    logger.warn(`Leaving unknown skills directory untouched: skills/${unknownDir}.`)
  }
}

/**
 * @param {string} cwd
 * @param {SourceConfig} source
 * @param {RunWorkspace} runWorkspace
 * @param {SyncOptions} options
 * @param {Logger} logger
 * @returns {Promise<import('./skills-sync/summary.mjs').SummaryItem>}
 */
async function syncSource(cwd, source, runWorkspace, options, logger) {
  logger.group(`Sync ${source.id}`)
  logger.info(`Cloning ${source.url}#${source.branch}.`)

  const repoPath = path.join(runWorkspace.reposPath, source.id)
  const sourceSkillsPath = source.path === '.'
    ? repoPath
    : path.join(repoPath, ...source.path.split('/'))

  try {
    await cloneSourceWithRetry(source, repoPath, { cwd, maxAttempts: source.cloneMaxAttempts }, logger)
    await assertDirectory(sourceSkillsPath, `Source path ${source.path}`)

    const commit = await getHeadCommit(repoPath)
    const discoveredSkills = await discoverSkillDirs(sourceSkillsPath)
    const selectedSkills = filterSkillDirs(discoveredSkills, source)
    const plannedTargets = planSkillTargets(source, selectedSkills)
    const targets = getUniqueValues(plannedTargets.map(target => target.targetId))
    const skillPaths = plannedTargets.map(target => target.relativePath)

    if (!options.dryRun) {
      if (source.mode === 'nested') {
        await syncNestedSource(cwd, source, plannedTargets, runWorkspace)
      }
      else {
        await syncFlatSource(cwd, plannedTargets, runWorkspace)
      }
    }

    logger.success(`Synced ${source.id}: ${selectedSkills.length}/${discoveredSkills.length} skill directories at ${commit.slice(0, 12)}.`)
    return {
      id: source.id,
      url: source.url,
      branch: source.branch,
      path: source.path,
      mode: source.mode,
      includes: source.includes,
      excludes: source.excludes,
      status: 'synced',
      skillCount: selectedSkills.length,
      discoveredSkillCount: discoveredSkills.length,
      commit,
      targets,
      skillPaths,
      message: options.dryRun ? 'Dry-run validated clone, filters, and target paths.' : 'Synced successfully.',
    }
  }
  catch (error) {
    const reason = classifyGitError(error)
    const message = `${reason}: ${formatCommandError(error)}`
    logger.error(`Failed ${source.id}: ${message}`)
    return {
      id: source.id,
      url: source.url,
      branch: source.branch,
      path: source.path,
      status: 'failed',
      skillCount: 0,
      commit: null,
      message,
    }
  }
  finally {
    logger.groupEnd()
  }
}

/**
 * @param {string} cwd
 * @param {SourceConfig} source
 * @param {import('./skills-sync/fs.mjs').PlannedSkillTarget[]} plannedTargets
 * @param {RunWorkspace} runWorkspace
 * @returns {Promise<void>}
 */
async function syncNestedSource(cwd, source, plannedTargets, runWorkspace) {
  if (plannedTargets.length === 0) {
    return
  }

  const stagedPath = path.join(runWorkspace.stagingPath, source.id)
  const targetPath = resolveInside(cwd, SKILLS_ROOT, source.id)
  await ensureDirectory(stagedPath)

  for (const plannedTarget of plannedTargets) {
    const stagedSkillPath = plannedTarget.nestedPath === '.'
      ? stagedPath
      : path.join(stagedPath, ...plannedTarget.nestedPath.split('/'))
    await copyDirectory(plannedTarget.absolutePath, stagedSkillPath)
  }

  await atomicReplaceDirectory(targetPath, stagedPath, runWorkspace.backupsPath)
}

/**
 * @param {string} cwd
 * @param {import('./skills-sync/fs.mjs').PlannedSkillTarget[]} plannedTargets
 * @param {RunWorkspace} runWorkspace
 * @returns {Promise<void>}
 */
async function syncFlatSource(cwd, plannedTargets, runWorkspace) {
  for (const plannedTarget of plannedTargets) {
    const stagedPath = path.join(runWorkspace.stagingPath, plannedTarget.targetId)
    const targetPath = resolveInside(cwd, SKILLS_ROOT, plannedTarget.targetId)
    await copyDirectory(plannedTarget.absolutePath, stagedPath)
    await atomicReplaceDirectory(targetPath, stagedPath, runWorkspace.backupsPath)
  }
}

/**
 * @param {string} sourceId
 * @param {ManifestSource} previousSource
 * @returns {string[]}
 */
function getPreviousManagedTargets(sourceId, previousSource) {
  return Array.isArray(previousSource.targets) ? previousSource.targets : [sourceId]
}

/**
 * @param {string[]} values
 * @returns {string[]}
 */
function getUniqueValues(values) {
  return [...new Set(values)]
}

/**
 * @param {SourceConfig} source
 * @param {string} repoPath
 * @param {{ cwd: string, maxAttempts: number }} options
 * @param {Logger} logger
 * @returns {Promise<void>}
 */
async function cloneSourceWithRetry(source, repoPath, options, logger) {
  let lastError = null

  for (let attempt = 1; attempt <= options.maxAttempts; attempt += 1) {
    try {
      await cloneSource(source, repoPath, { cwd: options.cwd, timeoutMs: source.cloneTimeoutMs })
      return
    }
    catch (error) {
      lastError = error
      const reason = classifyGitError(error)
      const canRetry = reason === 'network_error' || reason === 'clone_failed'
      if (!canRetry || attempt === options.maxAttempts) {
        break
      }

      logger.warn(`Clone attempt ${attempt} failed for ${source.id}; retrying (${reason}).`)
      await rm(repoPath, { recursive: true, force: true })
    }
  }

  throw lastError
}

/**
 * @param {string[]} args
 * @returns {SyncOptions}
 */
export function parseArgs(args) {
  /** @type {SyncOptions} */
  const options = {
    configPath: undefined,
    dryRun: false,
    keepTemp: false,
    verbose: false,
  }

  for (let argIndex = 0; argIndex < args.length; argIndex += 1) {
    const arg = args[argIndex]
    if (arg === '--config') {
      if (!args[argIndex + 1] || args[argIndex + 1].startsWith('--')) {
        throw new Error('--config requires a file path.')
      }
      options.configPath = args[argIndex + 1]
      argIndex += 1
      continue
    }

    if (arg === '--dry-run') {
      options.dryRun = true
      continue
    }

    if (arg === '--keep-temp') {
      options.keepTemp = true
      continue
    }

    if (arg === '--verbose') {
      options.verbose = true
      continue
    }

    throw new Error(`Unknown argument: ${arg}`)
  }

  return options
}

/**
 * @returns {boolean}
 */
function isDirectCli() {
  return Boolean(process.argv[1]) && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
}
