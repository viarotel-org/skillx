import { constants as fileConstants } from 'node:fs'
import { access, cp, lstat, mkdir, readdir, readFile, readlink, rename, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { minimatch } from 'minimatch'

export const SKILLS_ROOT = 'skills'
export const MANIFEST_PATH = '.skills-sync/manifest.json'

const EXCLUDED_DIRECTORY_NAMES = ['.git', '.github', '.idea', '.vscode', 'node_modules']
const EXCLUDED_ROOT_FILES = ['.env', '.env.local', '.env.production', '.gitattributes', '.gitignore', '.npmrc', '.yarnrc', '.yarnrc.yml']

/**
 * @typedef {object} FileOperationOptions
 * @property {boolean} [dryRun]
 * @property {boolean} [keepTemp]
 * @property {string} [runId]
 * @property {{ path: string, target: string }[]} [skippedSymlinks]
 */

/**
 * @typedef {object} RunWorkspace
 * @property {string} runId
 * @property {string} workspacePath
 * @property {string} reposPath
 * @property {string} stagingPath
 * @property {string} backupsPath
 */

/**
 * @typedef {object} ManifestSource
 * @property {string} [url]
 * @property {string} [branch]
 * @property {string} [path]
 * @property {string} [mode]
 * @property {string[]} [includes]
 * @property {string[]} [excludes]
 * @property {string | null} [commit]
 * @property {string} [status]
 * @property {number} [skillCount]
 * @property {number} [discoveredSkillCount]
 * @property {string[]} [targets]
 * @property {string[]} [skillPaths]
 * @property {string} [message]
 */

/**
 * @typedef {object} Manifest
 * @property {number} version
 * @property {Record<string, ManifestSource>} sources
 */

/**
 * @typedef {object} SyncResultSource
 * @property {string} id
 * @property {string} [url]
 * @property {string} [branch]
 * @property {string} [path]
 * @property {string} [mode]
 * @property {string[]} [includes]
 * @property {string[]} [excludes]
 * @property {string | null} [commit]
 * @property {string} [status]
 * @property {string[]} [targets]
 * @property {string[]} [skillPaths]
 */

/**
 * @typedef {object} DiscoveredSkill
 * @property {string} absolutePath
 * @property {string} relativePath
 */

/**
 * @typedef {DiscoveredSkill & { targetId: string, nestedPath: string }} PlannedSkillTarget
 */

/**
 * @param {string} targetPath
 * @returns {Promise<boolean>}
 */
export async function pathExists(targetPath) {
  try {
    await access(targetPath, fileConstants.F_OK)
    return true
  }
  catch {
    return false
  }
}

/**
 * @param {string} rootPath
 * @param {...string} segments
 * @returns {string}
 */
export function resolveInside(rootPath, ...segments) {
  const resolvedRoot = path.resolve(rootPath)
  const resolvedTarget = path.resolve(resolvedRoot, ...segments)
  const isInside = resolvedTarget === resolvedRoot || resolvedTarget.startsWith(`${resolvedRoot}${path.sep}`)

  if (!isInside) {
    throw new Error(`Resolved path escapes root: ${resolvedTarget}`)
  }

  return resolvedTarget
}

/**
 * @param {string} directoryPath
 * @param {FileOperationOptions} [options]
 * @returns {Promise<void>}
 */
export async function ensureDirectory(directoryPath, options = {}) {
  if (options.dryRun) {
    return
  }

  await mkdir(directoryPath, { recursive: true })
}

/**
 * @param {string} cwd
 * @returns {Promise<() => Promise<void>>}
 */
export async function acquireSyncLock(cwd) {
  const lockPath = resolveInside(cwd, '.skills-sync', 'sync.lock')
  await mkdir(path.dirname(lockPath), { recursive: true })

  try {
    await mkdir(lockPath)
  }
  catch (error) {
    if (isNodeError(error) && error.code === 'EEXIST') {
      throw new Error('A skills sync is already running for this repository.')
    }

    throw error
  }

  let released = false
  return async () => {
    if (released) {
      return
    }

    released = true
    await rm(lockPath, { recursive: true, force: true })
  }
}

/**
 * @param {string} cwd
 * @param {FileOperationOptions} [options]
 * @returns {Promise<RunWorkspace>}
 */
export async function createRunWorkspace(cwd, options = {}) {
  const runId = options.runId ?? `run-${Date.now()}-${process.pid}`
  const workspacePath = resolveInside(cwd, '.skills-sync', 'tmp', runId)
  const reposPath = path.join(workspacePath, 'repos')
  const stagingPath = path.join(workspacePath, 'staging')
  const backupsPath = path.join(workspacePath, 'backups')

  if (!options.dryRun) {
    await mkdir(reposPath, { recursive: true })
    await mkdir(stagingPath, { recursive: true })
    await mkdir(backupsPath, { recursive: true })
  }
  else {
    await mkdir(reposPath, { recursive: true })
  }

  return {
    runId,
    workspacePath,
    reposPath,
    stagingPath,
    backupsPath,
  }
}

/**
 * @param {string} workspacePath
 * @param {FileOperationOptions} [options]
 * @returns {Promise<void>}
 */
export async function cleanupRunWorkspace(workspacePath, options = {}) {
  if (options.keepTemp) {
    return
  }

  await rm(workspacePath, { recursive: true, force: true })
}

/**
 * @param {string} cwd
 * @param {string} [manifestPath]
 * @returns {Promise<Manifest | null>}
 */
export async function readManifest(cwd, manifestPath = MANIFEST_PATH) {
  const absoluteManifestPath = resolveInside(cwd, manifestPath)
  if (!(await pathExists(absoluteManifestPath))) {
    return null
  }

  const rawManifest = await readFile(absoluteManifestPath, 'utf8')
  let manifest
  try {
    manifest = JSON.parse(rawManifest)
  }
  catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`Manifest parse failed at ${absoluteManifestPath}: ${message}. Run pnpm sync:dry-run to validate the current sync plan before rebuilding the manifest.`)
  }

  if (!manifest || typeof manifest !== 'object' || !manifest.sources || typeof manifest.sources !== 'object') {
    return null
  }

  return manifest
}

/**
 * @param {string} cwd
 * @param {Manifest} manifest
 * @param {FileOperationOptions} [options]
 * @returns {Promise<void>}
 */
export async function writeManifest(cwd, manifest, options = {}) {
  if (options.dryRun) {
    return
  }

  const absoluteManifestPath = resolveInside(cwd, MANIFEST_PATH)
  await mkdir(path.dirname(absoluteManifestPath), { recursive: true })
  await writeFileAtomic(absoluteManifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
}

/**
 * @param {SyncResultSource[]} sources
 * @returns {Manifest}
 */
export function createManifest(sources) {
  const sourceEntries = sources
    .filter(source => source.status === 'synced' || source.status === 'preserved')
    .map(source => [source.id, {
      url: source.url,
      branch: source.branch,
      path: source.path,
      mode: source.mode,
      includes: source.includes ?? [],
      excludes: source.excludes ?? [],
      commit: source.commit,
      status: source.status,
      targets: source.targets ?? [source.id],
      skillPaths: source.skillPaths ?? [],
    }])

  return {
    version: 2,
    sources: Object.fromEntries(sourceEntries),
  }
}

/**
 * @param {Manifest | null} previousManifest
 * @param {string[]} currentManagedTargetIds
 * @param {string[]} [protectedIds]
 * @returns {string[]}
 */
export function getStaleManagedIds(previousManifest, currentManagedTargetIds, protectedIds = []) {
  if (!previousManifest?.sources || typeof previousManifest.sources !== 'object') {
    return []
  }

  const currentManagedTargetIdSet = new Set(currentManagedTargetIds)
  const previousManagedTargetIds = Object.entries(previousManifest.sources)
    .flatMap(([sourceId, source]) => getManifestSourceTargets(sourceId, source))

  return [...new Set(previousManagedTargetIds)]
    .filter(targetId => !currentManagedTargetIdSet.has(targetId))
    .filter(targetId => !isProtectedDirectoryId(targetId, protectedIds))
    .sort()
}

/**
 * @param {string} cwd
 * @param {string[]} knownDirectoryIds
 * @param {string[]} [protectedIds]
 * @returns {Promise<string[]>}
 */
export async function listUnknownSkillDirs(cwd, knownDirectoryIds, protectedIds = []) {
  const skillsRootPath = resolveInside(cwd, SKILLS_ROOT)
  if (!(await pathExists(skillsRootPath))) {
    return []
  }

  const entries = await readdir(skillsRootPath, { withFileTypes: true })
  const knownDirectoryIdSet = new Set(knownDirectoryIds)

  return entries
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .filter(entryName => !knownDirectoryIdSet.has(entryName))
    .filter(entryName => !isProtectedDirectoryId(entryName, protectedIds))
    .sort()
}

/**
 * @param {string} cwd
 * @param {string} sourceId
 * @param {FileOperationOptions} [options]
 * @returns {Promise<void>}
 */
export async function removeGeneratedSkillDir(cwd, sourceId, options = {}) {
  const targetPath = resolveInside(cwd, SKILLS_ROOT, sourceId)
  if (options.dryRun) {
    return
  }

  await rm(targetPath, { recursive: true, force: true })
}

/**
 * @param {string} sourcePath
 * @returns {Promise<DiscoveredSkill[]>}
 */
export async function discoverSkillDirs(sourcePath) {
  /** @type {DiscoveredSkill[]} */
  const skills = []
  await collectSkillDirs(sourcePath, sourcePath, skills)

  return skills.sort((leftSkill, rightSkill) => leftSkill.relativePath.localeCompare(rightSkill.relativePath))
}

/**
 * @param {DiscoveredSkill[]} skills
 * @param {{ includes?: string[], excludes?: string[] }} [filters]
 * @returns {DiscoveredSkill[]}
 */
export function filterSkillDirs(skills, filters = {}) {
  const includes = filters.includes ?? []
  const excludes = filters.excludes ?? []

  return skills.filter((skill) => {
    const isIncluded = includes.length === 0 || includes.some(pattern => matchesSkillPattern(skill.relativePath, pattern))
    const isExcluded = excludes.some(pattern => matchesSkillPattern(skill.relativePath, pattern))

    return isIncluded && !isExcluded
  })
}

/**
 * @param {{ id: string, mode?: string }} source
 * @param {DiscoveredSkill[]} skills
 * @returns {PlannedSkillTarget[]}
 */
export function planSkillTargets(source, skills) {
  const mode = source.mode ?? 'flat'
  const plannedTargets = skills.map(skill => ({
    ...skill,
    targetId: mode === 'nested' ? source.id : createFlatTargetId(source.id, skill.relativePath),
    nestedPath: mode === 'nested' ? skill.relativePath : '.',
  }))

  if (mode === 'flat') {
    assertUniqueFlatTargets(plannedTargets)
  }

  return plannedTargets
}

/**
 * @param {string} sourcePath
 * @param {string} label
 * @returns {Promise<void>}
 */
export async function assertDirectory(sourcePath, label) {
  let sourceStat
  try {
    sourceStat = await stat(sourcePath)
  }
  catch {
    throw new Error(`${label} does not exist: ${sourcePath}`)
  }

  if (!sourceStat.isDirectory()) {
    throw new Error(`${label} is not a directory: ${sourcePath}`)
  }
}

/**
 * @param {string} sourcePath
 * @param {string} targetPath
 * @param {FileOperationOptions} [options]
 * @returns {Promise<void>}
 */
export async function copyDirectory(sourcePath, targetPath, options = {}) {
  if (options.dryRun) {
    return
  }

  await rm(targetPath, { recursive: true, force: true })
  await mkdir(path.dirname(targetPath), { recursive: true })
  await cp(sourcePath, targetPath, {
    recursive: true,
    force: true,
    dereference: false,
    filter: source => shouldCopyPath(sourcePath, source, options.skippedSymlinks ?? []),
  })
}

/**
 * @param {string} targetPath
 * @param {string} stagedPath
 * @param {string} backupRoot
 * @param {FileOperationOptions} [options]
 * @returns {Promise<void>}
 */
export async function atomicReplaceDirectory(targetPath, stagedPath, backupRoot, options = {}) {
  if (options.dryRun) {
    return
  }

  await mkdir(path.dirname(targetPath), { recursive: true })

  const backupPath = path.join(backupRoot, path.basename(targetPath))
  const hasExistingTarget = await pathExists(targetPath)

  if (hasExistingTarget) {
    await rm(backupPath, { recursive: true, force: true })
    await rename(targetPath, backupPath)
  }

  try {
    await rename(stagedPath, targetPath)
  }
  catch (error) {
    if (hasExistingTarget) {
      await rename(backupPath, targetPath)
    }
    throw error
  }

  if (hasExistingTarget) {
    await rm(backupPath, { recursive: true, force: true })
  }
}

/**
 * @param {string} rootPath
 * @param {string} sourcePath
 * @param {{ path: string, target: string }[]} skippedSymlinks
 * @returns {Promise<boolean>}
 */
async function shouldCopyPath(rootPath, sourcePath, skippedSymlinks) {
  const relativePath = path.relative(rootPath, sourcePath)
  if (relativePath.length === 0) {
    return true
  }

  const sourceStat = await lstat(sourcePath)
  if (sourceStat.isSymbolicLink()) {
    skippedSymlinks.push({
      path: relativePath.split(path.sep).join('/'),
      target: await readlink(sourcePath),
    })

    return false
  }

  const pathSegments = relativePath.split(path.sep)
  if (pathSegments.some(segment => EXCLUDED_DIRECTORY_NAMES.includes(segment))) {
    return false
  }

  if (pathSegments.length === 1 && EXCLUDED_ROOT_FILES.includes(pathSegments[0])) {
    return false
  }

  if (path.basename(sourcePath).startsWith('.env.')) {
    return false
  }

  return path.basename(sourcePath) !== '.DS_Store'
}

/**
 * @param {string} sourceRootPath
 * @param {string} directoryPath
 * @param {DiscoveredSkill[]} skills
 * @returns {Promise<void>}
 */
async function collectSkillDirs(sourceRootPath, directoryPath, skills) {
  const entries = await readdir(directoryPath, { withFileTypes: true })
  const hasSkillFile = entries.some(entry => entry.isFile() && entry.name === 'SKILL.md')

  if (hasSkillFile) {
    skills.push({
      absolutePath: directoryPath,
      relativePath: toPosixRelativePath(sourceRootPath, directoryPath),
    })
  }

  const childDirectories = entries
    .filter(entry => entry.isDirectory())
    .filter(entry => !EXCLUDED_DIRECTORY_NAMES.includes(entry.name))

  await Promise.all(childDirectories.map(entry => collectSkillDirs(sourceRootPath, path.join(directoryPath, entry.name), skills)))
}

/**
 * @param {string} sourceRootPath
 * @param {string} directoryPath
 * @returns {string}
 */
function toPosixRelativePath(sourceRootPath, directoryPath) {
  const relativePath = path.relative(sourceRootPath, directoryPath)
  if (relativePath.length === 0) {
    return '.'
  }

  return relativePath.split(path.sep).join('/')
}

/**
 * @param {string} relativePath
 * @param {string} pattern
 * @returns {boolean}
 */
function matchesSkillPattern(relativePath, pattern) {
  return minimatch(relativePath, pattern, { dot: true })
}

/**
 * @param {string} directoryId
 * @param {string[]} protectedIds
 * @returns {boolean}
 */
function isProtectedDirectoryId(directoryId, protectedIds) {
  return protectedIds.some(protectedId => directoryId === protectedId || minimatch(directoryId, protectedId, { nonegate: true, nocomment: true }))
}

/**
 * @param {string} sourceId
 * @param {string} relativePath
 * @returns {string}
 */
function createFlatTargetId(sourceId, relativePath) {
  if (relativePath === '.') {
    return sourceId
  }

  const skillSlug = relativePath
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '-')
    .replaceAll(/^-+|-+$/g, '')

  if (skillSlug.length === 0) {
    throw new Error(`Cannot create generated target id for ${sourceId}/${relativePath}.`)
  }

  return `${sourceId}-${skillSlug}`
}

/**
 * @param {PlannedSkillTarget[]} plannedTargets
 * @returns {void}
 */
function assertUniqueFlatTargets(plannedTargets) {
  const seenTargets = new Map()
  for (const plannedTarget of plannedTargets) {
    const previousRelativePath = seenTargets.get(plannedTarget.targetId)
    if (previousRelativePath) {
      throw new Error(`Generated target collision for ${plannedTarget.targetId}: ${previousRelativePath} and ${plannedTarget.relativePath}.`)
    }

    seenTargets.set(plannedTarget.targetId, plannedTarget.relativePath)
  }
}

/**
 * @param {string} sourceId
 * @param {ManifestSource | undefined} source
 * @returns {string[]}
 */
function getManifestSourceTargets(sourceId, source) {
  if (Array.isArray(source?.targets)) {
    return source.targets
  }

  return [sourceId]
}

/**
 * @param {string} targetPath
 * @param {string} content
 * @returns {Promise<void>}
 */
async function writeFileAtomic(targetPath, content) {
  const tempPath = `${targetPath}.${process.pid}.${Date.now()}.tmp`

  try {
    await writeFile(tempPath, content, 'utf8')
    await rename(tempPath, targetPath)
  }
  catch (error) {
    await rm(tempPath, { force: true })
    throw error
  }
}

/**
 * @param {unknown} error
 * @returns {error is NodeJS.ErrnoException}
 */
function isNodeError(error) {
  return error instanceof Error && 'code' in error
}
