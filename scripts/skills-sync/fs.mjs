import { constants as fileConstants } from 'node:fs'
import { access, cp, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

export const SKILLS_ROOT = 'skills'
export const MANIFEST_PATH = '.skills-sync/manifest.json'

const EXCLUDED_DIRECTORY_NAMES = ['.git', '.github', '.idea', '.vscode', 'node_modules']
const EXCLUDED_ROOT_FILES = ['.env', '.env.local', '.env.production', '.gitattributes', '.gitignore', '.npmrc', '.yarnrc', '.yarnrc.yml']

/**
 * @typedef {object} FileOperationOptions
 * @property {boolean} [dryRun]
 * @property {boolean} [keepTemp]
 * @property {string} [runId]
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
 * @property {string | null} [commit]
 * @property {string} [status]
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
 * @property {string | null} [commit]
 * @property {string} [status]
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
  const manifest = JSON.parse(rawManifest)

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
  await writeFile(absoluteManifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
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
      commit: source.commit,
      status: source.status,
    }])

  return {
    version: 1,
    sources: Object.fromEntries(sourceEntries),
  }
}

/**
 * @param {Manifest | null} previousManifest
 * @param {string[]} currentSourceIds
 * @param {string[]} [protectedIds]
 * @returns {string[]}
 */
export function getStaleManagedIds(previousManifest, currentSourceIds, protectedIds = []) {
  if (!previousManifest?.sources || typeof previousManifest.sources !== 'object') {
    return []
  }

  const currentSourceIdSet = new Set(currentSourceIds)
  const protectedIdSet = new Set(protectedIds)

  return Object.keys(previousManifest.sources)
    .filter(sourceId => !currentSourceIdSet.has(sourceId))
    .filter(sourceId => !protectedIdSet.has(sourceId))
    .sort()
}

/**
 * @param {string} cwd
 * @param {string[]} knownSourceIds
 * @param {string[]} [protectedIds]
 * @returns {Promise<string[]>}
 */
export async function listUnknownSkillDirs(cwd, knownSourceIds, protectedIds = []) {
  const skillsRootPath = resolveInside(cwd, SKILLS_ROOT)
  if (!(await pathExists(skillsRootPath))) {
    return []
  }

  const entries = await readdir(skillsRootPath, { withFileTypes: true })
  const knownSourceIdSet = new Set(knownSourceIds)
  const protectedIdSet = new Set(protectedIds)

  return entries
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .filter(entryName => !knownSourceIdSet.has(entryName))
    .filter(entryName => !protectedIdSet.has(entryName))
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
 * @returns {Promise<number>}
 */
export async function countDirectSkillDirs(sourcePath) {
  return countSkillDirs(sourcePath)
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
  await cp(sourcePath, targetPath, {
    recursive: true,
    force: true,
    dereference: false,
    filter: source => shouldCopyPath(sourcePath, source),
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
 * @returns {boolean}
 */
function shouldCopyPath(rootPath, sourcePath) {
  const relativePath = path.relative(rootPath, sourcePath)
  if (relativePath.length === 0) {
    return true
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
 * @param {string} directoryPath
 * @returns {Promise<number>}
 */
async function countSkillDirs(directoryPath) {
  const entries = await readdir(directoryPath, { withFileTypes: true })
  const hasSkillFile = entries.some(entry => entry.isFile() && entry.name === 'SKILL.md')
  const childDirectories = entries
    .filter(entry => entry.isDirectory())
    .filter(entry => !EXCLUDED_DIRECTORY_NAMES.includes(entry.name))

  /** @type {number[]} */
  const childCounts = await Promise.all(childDirectories.map(entry => countSkillDirs(path.join(directoryPath, entry.name))))
  const childTotal = childCounts.reduce((total, count) => total + count, 0)

  return childTotal + (hasSkillFile ? 1 : 0)
}
