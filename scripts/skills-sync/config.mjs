import { readFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import YAML from 'yaml'

/**
 * @typedef {object} DefaultsConfig
 * @property {string} branch
 * @property {string} path
 * @property {boolean} enabled
 * @property {boolean} preserveOnFailure
 */

/**
 * @typedef {object} SourceConfig
 * @property {string} id
 * @property {string} url
 * @property {string} branch
 * @property {string} path
 * @property {boolean} enabled
 * @property {boolean} preserveOnFailure
 * @property {unknown} priority
 */

export const DEFAULT_CONFIG_PATH = 'config/skills-sources.yaml'

const SOURCE_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const DEFAULT_PROTECTED_IDS = ['local', 'subscribe']
const DEFAULTS = {
  branch: 'main',
  path: 'skills',
  enabled: true,
  preserveOnFailure: true,
}

export class ConfigValidationError extends Error {
  /**
   * @param {string[]} issues
   */
  constructor(issues) {
    super(`Invalid skills sources config:\n${issues.map(issue => `- ${issue}`).join('\n')}`)
    this.name = 'ConfigValidationError'
    this.issues = issues
  }
}

/**
 * @param {{ cwd?: string, configPath?: string }} [options]
 */
export async function loadSkillsConfig(options = {}) {
  const cwd = options.cwd ?? process.cwd()
  const configPath = options.configPath ?? DEFAULT_CONFIG_PATH
  const absoluteConfigPath = path.resolve(cwd, configPath)
  const rawConfig = await readFile(absoluteConfigPath, 'utf8')

  let parsedConfig
  try {
    parsedConfig = YAML.parse(rawConfig)
  }
  catch (error) {
    throw new ConfigValidationError([`YAML parse failed: ${getErrorMessage(error)}`])
  }

  return validateConfigDocument(parsedConfig, { configPath })
}

/**
 * @param {unknown} configDocument
 * @param {{ configPath?: string }} [options]
 */
export function validateConfigDocument(configDocument, options = {}) {
  const issues = []

  if (!isPlainObject(configDocument)) {
    throw new ConfigValidationError(['Config root must be an object.'])
  }

  if (configDocument.version !== 1) {
    issues.push('`version` must be 1.')
  }

  const defaults = normalizeDefaults(configDocument.defaults, issues)
  const protectedIds = normalizeProtectedIds(configDocument.protectedIds, issues)
  const rawSources = configDocument.sources

  if (!Array.isArray(rawSources)) {
    issues.push('`sources` must be an array.')
  }

  const sources = Array.isArray(rawSources)
    ? normalizeSources(rawSources, defaults, protectedIds, issues)
    : []

  if (issues.length > 0) {
    throw new ConfigValidationError(issues)
  }

  return {
    configPath: options.configPath ?? DEFAULT_CONFIG_PATH,
    version: 1,
    defaults,
    protectedIds,
    sources,
  }
}

/**
 * @param {unknown} sourceId
 * @param {string[]} [protectedIds]
 * @returns {string | null}
 */
export function validateSourceId(sourceId, protectedIds = DEFAULT_PROTECTED_IDS) {
  if (typeof sourceId !== 'string' || sourceId.length === 0) {
    return 'Source id must be a non-empty string.'
  }

  if (!SOURCE_ID_PATTERN.test(sourceId)) {
    return `Source id "${sourceId}" must use kebab-case lowercase letters and numbers.`
  }

  if (protectedIds.includes(sourceId)) {
    return `Source id "${sourceId}" is protected and cannot be generated.`
  }

  return null
}

/**
 * @param {unknown} relativePath
 * @param {string} [label]
 * @returns {string | null}
 */
export function validateRelativePath(relativePath, label = 'path') {
  if (typeof relativePath !== 'string' || relativePath.trim().length === 0) {
    return `Source ${label} must be a non-empty string.`
  }

  if (relativePath === '.') {
    return null
  }

  if (relativePath.includes('\\')) {
    return `Source ${label} "${relativePath}" must use forward slashes.`
  }

  if (path.posix.isAbsolute(relativePath)) {
    return `Source ${label} "${relativePath}" must be relative.`
  }

  const parts = relativePath.split('/')
  if (parts.some(part => part === '..' || part === '.' || part.length === 0)) {
    return `Source ${label} "${relativePath}" must not contain empty, dot, or parent segments.`
  }

  return null
}

/**
 * @param {unknown} error
 * @returns {string}
 */
export function getErrorMessage(error) {
  if (error instanceof Error) {
    return error.message
  }

  return String(error)
}

/**
 * @param {unknown} rawDefaults
 * @param {string[]} issues
 * @returns {DefaultsConfig}
 */
function normalizeDefaults(rawDefaults, issues) {
  if (rawDefaults !== undefined && !isPlainObject(rawDefaults)) {
    issues.push('`defaults` must be an object when provided.')
    return DEFAULTS
  }

  const mergedDefaults = {
    ...DEFAULTS,
    ...(rawDefaults ?? {}),
  }

  if (typeof mergedDefaults.branch !== 'string' || mergedDefaults.branch.trim().length === 0) {
    issues.push('`defaults.branch` must be a non-empty string.')
  }

  const pathIssue = validateRelativePath(mergedDefaults.path, 'defaults.path')
  if (pathIssue) {
    issues.push(pathIssue)
  }

  if (typeof mergedDefaults.enabled !== 'boolean') {
    issues.push('`defaults.enabled` must be a boolean.')
  }

  if (typeof mergedDefaults.preserveOnFailure !== 'boolean') {
    issues.push('`defaults.preserveOnFailure` must be a boolean.')
  }

  return {
    branch: String(mergedDefaults.branch ?? DEFAULTS.branch),
    path: String(mergedDefaults.path ?? DEFAULTS.path),
    enabled: Boolean(mergedDefaults.enabled),
    preserveOnFailure: Boolean(mergedDefaults.preserveOnFailure),
  }
}

/**
 * @param {unknown} rawProtectedIds
 * @param {string[]} issues
 * @returns {string[]}
 */
function normalizeProtectedIds(rawProtectedIds, issues) {
  if (rawProtectedIds !== undefined && !Array.isArray(rawProtectedIds)) {
    issues.push('`protectedIds` must be an array when provided.')
    return DEFAULT_PROTECTED_IDS
  }

  const protectedIds = [...new Set([...DEFAULT_PROTECTED_IDS, ...(rawProtectedIds ?? [])])]
  for (const protectedId of protectedIds) {
    if (typeof protectedId !== 'string' || !SOURCE_ID_PATTERN.test(protectedId)) {
      issues.push(`Protected id "${String(protectedId)}" must use kebab-case.`)
    }
  }

  return protectedIds
}

/**
 * @param {unknown[]} rawSources
 * @param {DefaultsConfig} defaults
 * @param {string[]} protectedIds
 * @param {string[]} issues
 * @returns {SourceConfig[]}
 */
function normalizeSources(rawSources, defaults, protectedIds, issues) {
  const seenSourceIds = new Set()
  return rawSources.map((rawSource, sourceIndex) => {
    const sourceLabel = `sources[${sourceIndex}]`

    if (!isPlainObject(rawSource)) {
      issues.push(`${sourceLabel} must be an object.`)
      return createInvalidSource(defaults)
    }

    const id = rawSource.id
    const idIssue = validateSourceId(id, protectedIds)
    if (idIssue) {
      issues.push(`${sourceLabel}: ${idIssue}`)
    }
    else if (seenSourceIds.has(id)) {
      issues.push(`${sourceLabel}: duplicate source id "${id}".`)
    }
    else {
      seenSourceIds.add(id)
    }

    if (!isSafeGitUrl(rawSource.url)) {
      issues.push(`${sourceLabel}: url must be a non-empty git URL string.`)
    }

    const normalizedPath = rawSource.path ?? defaults.path
    const pathIssue = validateRelativePath(normalizedPath)
    if (pathIssue) {
      issues.push(`${sourceLabel}: ${pathIssue}`)
    }

    const branch = rawSource.branch ?? defaults.branch
    if (typeof branch !== 'string' || branch.trim().length === 0) {
      issues.push(`${sourceLabel}: branch must be a non-empty string.`)
    }

    const enabled = rawSource.enabled ?? defaults.enabled
    if (typeof enabled !== 'boolean') {
      issues.push(`${sourceLabel}: enabled must be a boolean.`)
    }

    const preserveOnFailure = rawSource.preserveOnFailure ?? defaults.preserveOnFailure
    if (typeof preserveOnFailure !== 'boolean') {
      issues.push(`${sourceLabel}: preserveOnFailure must be a boolean.`)
    }

    return {
      id: typeof id === 'string' ? id : '',
      url: typeof rawSource.url === 'string' ? rawSource.url : '',
      branch: typeof branch === 'string' ? branch : defaults.branch,
      path: typeof normalizedPath === 'string' ? normalizedPath : defaults.path,
      enabled: Boolean(enabled),
      preserveOnFailure: Boolean(preserveOnFailure),
      priority: rawSource.priority ?? null,
    }
  })
}

/**
 * @param {DefaultsConfig} defaults
 * @returns {SourceConfig}
 */
function createInvalidSource(defaults) {
  return {
    id: '',
    url: '',
    branch: defaults.branch,
    path: defaults.path,
    enabled: false,
    preserveOnFailure: defaults.preserveOnFailure,
    priority: null,
  }
}

/**
 * @param {unknown} url
 * @returns {boolean}
 */
function isSafeGitUrl(url) {
  return typeof url === 'string'
    && url.trim().length > 0
    && !url.startsWith('-')
    && !url.includes('\n')
    && !url.includes('\r')
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
