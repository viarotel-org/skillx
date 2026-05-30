#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { mapWithConcurrency } from './skills-sync/concurrency.mjs'
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

export { mapWithConcurrency } from './skills-sync/concurrency.mjs'

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
 * @property {'remote' | 'local'} type
 * @property {string} location
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
 * @typedef {object} DeduplicateConfig
 * @property {boolean} enabled
 * @property {'content-hash'} strategy
 */

/**
 * @typedef {object} SkillsConfig
 * @property {string} configPath
 * @property {DeduplicateConfig} deduplicate
 * @property {{ sourceConcurrency: number }} defaults
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
 * @property {{ targetId: string, relativePath: string, contentHash: string }[]} [skills]
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
    const deduplicateState = createDeduplicateState(config.deduplicate)

    const sourcePlans = await mapWithConcurrency(
      enabledSources,
      config.defaults.sourceConcurrency,
      source => planSource(cwd, source, runWorkspace, options, logger),
    )

    for (const result of sourcePlans) {
      if (result.status === 'synced') {
        applyContentDeduplication(result, deduplicateState, summary, config.deduplicate)
        finalizeSyncedSourceResult(result)
      }

      if (result.status === 'synced' && !options.dryRun) {
        const skippedSymlinks = await commitSourcePlan(cwd, result, runWorkspace)
        result.skippedSymlinks = skippedSymlinks
        summary.skippedSymlinks.push(...skippedSymlinks.map(item => ({
          source: result.id,
          ...item,
        })))
      }

      if (result.status === 'synced') {
        summary.synced.push(result)
        syncedManifestSources.push(result)
        activeManagedTargets.push(...(result.targets ?? []))
        continue
      }

      summary.failed.push(result)
      const source = result.source
      const previousSource = previousManifest?.sources?.[source.id]
      if (source.preserveOnFailure && previousSource) {
        registerPreservedSourceHashes(previousSource, source.id, deduplicateState, config.deduplicate)
        activeManagedTargets.push(...getPreviousManagedTargets(source.id, previousSource))
        syncedManifestSources.push({
          id: source.id,
          type: previousSource.type ?? source.type,
          location: previousSource.location ?? source.location,
          branch: source.branch,
          path: source.path,
          mode: previousSource.mode ?? source.mode,
          includes: previousSource.includes ?? source.includes,
          excludes: previousSource.excludes ?? source.excludes,
          commit: previousSource.commit,
          status: 'preserved',
          targets: getPreviousManagedTargets(source.id, previousSource),
          skillPaths: previousSource.skillPaths ?? [],
          skills: previousSource.skills ?? [],
        })
      }
    }

    await handleStaleManagedDirectories(cwd, previousManifest, activeManagedTargets, config.protectedIds, summary, options, logger)
    await reportUnknownDirectories(cwd, activeManagedTargets, config.protectedIds, summary, logger, summary.stalePlanned)

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
 * @param {string[]} [excludedDirectoryIds]
 * @returns {Promise<void>}
 */
async function reportUnknownDirectories(cwd, knownDirectoryIds, protectedIds, summary, logger, excludedDirectoryIds = []) {
  const excludedDirectoryIdSet = new Set(excludedDirectoryIds)
  const unknownDirs = (await listUnknownSkillDirs(cwd, knownDirectoryIds, protectedIds))
    .filter(directoryId => !excludedDirectoryIdSet.has(directoryId))
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
async function planSource(cwd, source, runWorkspace, options, logger) {
  logger.group(`Sync ${source.id}`)

  try {
    const sourcePlanInput = await prepareSourcePlanInput(cwd, source, runWorkspace, logger)
    const discoveredSkills = await discoverSkillDirs(sourcePlanInput.sourceSkillsPath)
    const selectedSkills = filterSkillDirs(discoveredSkills, source)
    const plannedTargets = await attachSkillContentHashes(planSkillTargets(source, selectedSkills).map(plannedTarget => ({
      ...plannedTarget,
      sourceRootPath: sourcePlanInput.sourceRootPath,
    })))
    const targets = getUniqueValues(plannedTargets.map(target => target.targetId))
    const skillPaths = plannedTargets.map(target => target.relativePath)

    logger.success(`Planned ${source.id}: ${selectedSkills.length}/${discoveredSkills.length} skill directories${sourcePlanInput.commit ? ` at ${sourcePlanInput.commit.slice(0, 12)}` : ''}.`)
    return {
      id: source.id,
      type: source.type,
      location: source.location,
      branch: source.branch,
      path: source.path,
      mode: source.mode,
      includes: source.includes,
      excludes: source.excludes,
      status: 'synced',
      skillCount: selectedSkills.length,
      discoveredSkillCount: discoveredSkills.length,
      commit: sourcePlanInput.commit,
      targets,
      skillPaths,
      skills: createManifestSkills(plannedTargets),
      source,
      plannedTargets,
      message: options.dryRun ? 'Dry-run validated clone, filters, and target paths.' : 'Synced successfully.',
    }
  }
  catch (error) {
    const reason = classifyGitError(error)
    const message = `${reason}: ${formatCommandError(error)}`
    logger.error(`Failed ${source.id}: ${message}`)
    return {
      id: source.id,
      type: source.type,
      location: source.location,
      branch: source.branch,
      path: source.path,
      status: 'failed',
      skillCount: 0,
      commit: null,
      source,
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
 * @param {RunWorkspace} runWorkspace
 * @param {Logger} logger
 * @returns {Promise<{ sourceRootPath: string, sourceSkillsPath: string, commit: string | null }>}
 */
async function prepareSourcePlanInput(cwd, source, runWorkspace, logger) {
  if (source.type === 'local') {
    logger.info(`Reading local source ${source.location}.`)
    const sourceRootPath = source.location === '.'
      ? cwd
      : resolveInside(cwd, ...source.location.split('/'))
    const sourceSkillsPath = source.path === '.'
      ? sourceRootPath
      : path.join(sourceRootPath, ...source.path.split('/'))

    await assertDirectory(sourceSkillsPath, `Source path ${source.path}`)

    return {
      sourceRootPath,
      sourceSkillsPath,
      commit: null,
    }
  }

  logger.info(`Cloning ${source.location}#${source.branch}.`)
  const repoPath = path.join(runWorkspace.reposPath, source.id)
  const sourceSkillsPath = source.path === '.'
    ? repoPath
    : path.join(repoPath, ...source.path.split('/'))

  await cloneSourceWithRetry(source, repoPath, { cwd, maxAttempts: source.cloneMaxAttempts }, logger)
  await assertDirectory(sourceSkillsPath, `Source path ${source.path}`)

  return {
    sourceRootPath: repoPath,
    sourceSkillsPath,
    commit: await getHeadCommit(repoPath),
  }
}

/**
 * @param {string} cwd
 * @param {import('./skills-sync/summary.mjs').SummaryItem & { source: SourceConfig, plannedTargets: import('./skills-sync/fs.mjs').PlannedSkillTarget[] }} sourcePlan
 * @param {RunWorkspace} runWorkspace
 * @returns {Promise<{ path: string, target: string }[]>}
 */
async function commitSourcePlan(cwd, sourcePlan, runWorkspace) {
  const skippedSymlinks = []
  if (sourcePlan.source.mode === 'nested') {
    await syncNestedSource(cwd, sourcePlan.source, sourcePlan.plannedTargets, runWorkspace, skippedSymlinks)
  }
  else {
    await syncFlatSource(cwd, sourcePlan.plannedTargets, runWorkspace, skippedSymlinks)
  }

  return skippedSymlinks
}

/**
 * @param {string} cwd
 * @param {SourceConfig} source
 * @param {import('./skills-sync/fs.mjs').PlannedSkillTarget[]} plannedTargets
 * @param {RunWorkspace} runWorkspace
 * @returns {Promise<void>}
 */
async function syncNestedSource(cwd, source, plannedTargets, runWorkspace, skippedSymlinks = []) {
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
    await copyDirectory(plannedTarget.absolutePath, stagedSkillPath, {
      skippedSymlinks,
      sourceRootPath: plannedTarget.sourceRootPath,
    })
  }

  await atomicReplaceDirectory(targetPath, stagedPath, runWorkspace.backupsPath)
}

/**
 * @param {string} cwd
 * @param {import('./skills-sync/fs.mjs').PlannedSkillTarget[]} plannedTargets
 * @param {RunWorkspace} runWorkspace
 * @returns {Promise<void>}
 */
async function syncFlatSource(cwd, plannedTargets, runWorkspace, skippedSymlinks = []) {
  for (const plannedTarget of plannedTargets) {
    const stagedPath = path.join(runWorkspace.stagingPath, plannedTarget.targetId)
    const targetPath = resolveInside(cwd, SKILLS_ROOT, plannedTarget.targetId)
    await copyDirectory(plannedTarget.absolutePath, stagedPath, {
      skippedSymlinks,
      sourceRootPath: plannedTarget.sourceRootPath,
    })
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
 * @param {import('./skills-sync/fs.mjs').PlannedSkillTarget[]} plannedTargets
 * @returns {Promise<import('./skills-sync/fs.mjs').PlannedSkillTarget[]>}
 */
async function attachSkillContentHashes(plannedTargets) {
  return Promise.all(plannedTargets.map(async plannedTarget => ({
    ...plannedTarget,
    contentHash: await createSkillContentHash(plannedTarget.absolutePath),
  })))
}

/**
 * @param {string} skillDirectoryPath
 * @returns {Promise<string>}
 */
async function createSkillContentHash(skillDirectoryPath) {
  const skillBuffer = await readFile(path.join(skillDirectoryPath, 'SKILL.md'))
  return createHash('sha256').update(skillBuffer).digest('hex')
}

/**
 * @param {DeduplicateConfig} deduplicate
 * @returns {{ seenHashes: Map<string, { sourceId: string, relativePath: string, targetId: string }> }}
 */
function createDeduplicateState(deduplicate) {
  if (!deduplicate.enabled) {
    return {
      seenHashes: new Map(),
    }
  }

  return {
    seenHashes: new Map(),
  }
}

/**
 * @param {import('./skills-sync/summary.mjs').SummaryItem & { plannedTargets: import('./skills-sync/fs.mjs').PlannedSkillTarget[], deduplicated?: Array<{ source: string, path: string, target: string, duplicateOfSource: string, duplicateOfPath: string }> }} sourcePlan
 * @param {{ seenHashes: Map<string, { sourceId: string, relativePath: string, targetId: string }> }} deduplicateState
 * @param {import('./skills-sync/summary.mjs').SyncSummary} summary
 * @param {DeduplicateConfig} deduplicate
 * @returns {void}
 */
function applyContentDeduplication(sourcePlan, deduplicateState, summary, deduplicate) {
  if (!deduplicate.enabled) {
    return
  }

  const keptTargets = []
  const deduplicatedItems = []

  for (const plannedTarget of sourcePlan.plannedTargets) {
    const contentHash = plannedTarget.contentHash
    if (!contentHash) {
      keptTargets.push(plannedTarget)
      continue
    }

    const duplicateOf = deduplicateState.seenHashes.get(contentHash)
    if (!duplicateOf) {
      deduplicateState.seenHashes.set(contentHash, {
        sourceId: sourcePlan.id,
        relativePath: plannedTarget.relativePath,
        targetId: plannedTarget.targetId,
      })
      keptTargets.push(plannedTarget)
      continue
    }

    deduplicatedItems.push({
      source: sourcePlan.id,
      path: plannedTarget.relativePath,
      target: plannedTarget.targetId,
      duplicateOfSource: duplicateOf.sourceId,
      duplicateOfPath: duplicateOf.relativePath,
    })
  }

  sourcePlan.plannedTargets = keptTargets
  sourcePlan.deduplicated = deduplicatedItems
  summary.deduplicated.push(...deduplicatedItems)
}

/**
 * @param {import('./skills-sync/summary.mjs').SummaryItem & { plannedTargets: import('./skills-sync/fs.mjs').PlannedSkillTarget[], deduplicated?: Array<unknown>, message?: string, skills?: Array<{ targetId: string, relativePath: string, contentHash: string }> }} sourcePlan
 * @returns {void}
 */
function finalizeSyncedSourceResult(sourcePlan) {
  sourcePlan.targets = getUniqueValues(sourcePlan.plannedTargets.map(target => target.targetId))
  sourcePlan.skillPaths = sourcePlan.plannedTargets.map(target => target.relativePath)
  sourcePlan.skillCount = sourcePlan.plannedTargets.length
  sourcePlan.skills = createManifestSkills(sourcePlan.plannedTargets)

  const deduplicatedCount = sourcePlan.deduplicated?.length ?? 0
  if (deduplicatedCount === 0) {
    return
  }

  sourcePlan.message = `${sourcePlan.message ?? 'Synced successfully.'} Deduplicated ${deduplicatedCount} duplicate skill${deduplicatedCount === 1 ? '' : 's'}.`
}

/**
 * @param {import('./skills-sync/fs.mjs').PlannedSkillTarget[]} plannedTargets
 * @returns {{ targetId: string, relativePath: string, contentHash: string }[]}
 */
function createManifestSkills(plannedTargets) {
  return plannedTargets
    .filter(plannedTarget => typeof plannedTarget.contentHash === 'string')
    .map(plannedTarget => ({
      targetId: plannedTarget.targetId,
      relativePath: plannedTarget.relativePath,
      contentHash: plannedTarget.contentHash,
    }))
}

/**
 * @param {ManifestSource | undefined} previousSource
 * @param {string} sourceId
 * @param {{ seenHashes: Map<string, { sourceId: string, relativePath: string, targetId: string }> }} deduplicateState
 * @param {DeduplicateConfig} deduplicate
 * @returns {void}
 */
function registerPreservedSourceHashes(previousSource, sourceId, deduplicateState, deduplicate) {
  if (!deduplicate.enabled || !Array.isArray(previousSource?.skills)) {
    return
  }

  for (const skill of previousSource.skills) {
    if (typeof skill?.contentHash !== 'string' || deduplicateState.seenHashes.has(skill.contentHash)) {
      continue
    }

    deduplicateState.seenHashes.set(skill.contentHash, {
      sourceId,
      relativePath: typeof skill.relativePath === 'string' ? skill.relativePath : '.',
      targetId: typeof skill.targetId === 'string' ? skill.targetId : sourceId,
    })
  }
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
