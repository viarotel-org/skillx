import { readFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { minimatch } from 'minimatch'
import YAML from 'yaml'

/**
 * @typedef {object} DefaultsConfig
 * @property {string} branch
 * @property {string} path
 * @property {'flat' | 'nested'} mode
 * @property {boolean} enabled
 * @property {boolean} preserveOnFailure
 * @property {number} cloneTimeoutMs
 * @property {number} cloneMaxAttempts
 * @property {number} sourceConcurrency
 * @property {string[]} includes
 * @property {string[]} excludes
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

export const DEFAULT_CONFIG_PATH = 'skills-sources.yaml'

const SOURCE_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const DEFAULT_PROTECTED_IDS = ['local-*', 'subscribe']
const DEFAULTS = {
  branch: 'main',
  path: 'skills',
  mode: 'flat',
  enabled: true,
  preserveOnFailure: false,
  cloneTimeoutMs: 300000,
  cloneMaxAttempts: 3,
  sourceConcurrency: 3,
  includes: [],
  excludes: [],
}
const SOURCE_MODES = ['flat', 'nested']

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

  if (isProtectedId(sourceId, protectedIds)) {
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

  const cloneTimeoutMs = normalizePositiveInteger(mergedDefaults.cloneTimeoutMs, 'defaults.cloneTimeoutMs', DEFAULTS.cloneTimeoutMs, issues)
  const cloneMaxAttempts = normalizePositiveInteger(mergedDefaults.cloneMaxAttempts, 'defaults.cloneMaxAttempts', DEFAULTS.cloneMaxAttempts, issues)
  const sourceConcurrency = normalizePositiveInteger(mergedDefaults.sourceConcurrency, 'defaults.sourceConcurrency', DEFAULTS.sourceConcurrency, issues)

  if (!isValidSourceMode(mergedDefaults.mode)) {
    issues.push('`defaults.mode` must be either "flat" or "nested".')
  }

  const includes = normalizeFilterPatterns(mergedDefaults.includes, 'defaults.includes', issues)
  const excludes = normalizeFilterPatterns(mergedDefaults.excludes, 'defaults.excludes', issues)

  return {
    branch: String(mergedDefaults.branch ?? DEFAULTS.branch),
    path: String(mergedDefaults.path ?? DEFAULTS.path),
    mode: isValidSourceMode(mergedDefaults.mode) ? mergedDefaults.mode : DEFAULTS.mode,
    enabled: Boolean(mergedDefaults.enabled),
    preserveOnFailure: Boolean(mergedDefaults.preserveOnFailure),
    cloneTimeoutMs,
    cloneMaxAttempts,
    sourceConcurrency,
    includes,
    excludes,
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
    const protectedIdIssue = validateProtectedIdPattern(protectedId)
    if (protectedIdIssue) {
      issues.push(protectedIdIssue)
    }
  }

  return protectedIds
}

/**
 * @param {string} sourceId
 * @param {string[]} protectedIds
 * @returns {boolean}
 */
function isProtectedId(sourceId, protectedIds) {
  return protectedIds.some(protectedId => sourceId === protectedId || minimatch(sourceId, protectedId, { nonegate: true, nocomment: true }))
}

/**
 * @param {unknown} protectedId
 * @returns {string | null}
 */
function validateProtectedIdPattern(protectedId) {
  if (typeof protectedId !== 'string' || protectedId.trim().length === 0) {
    return `Protected id "${String(protectedId)}" must be a non-empty string.`
  }

  if (protectedId !== protectedId.trim()) {
    return `Protected id "${protectedId}" must not include leading or trailing whitespace.`
  }

  if (protectedId.includes('/') || protectedId.includes('\\')) {
    return `Protected id "${protectedId}" must be a single directory id or glob pattern.`
  }

  if (!/^[a-z0-9*?-]+$/.test(protectedId) || !/[a-z0-9]/.test(protectedId)) {
    return `Protected id "${protectedId}" must use lowercase kebab-case characters and may include * or ? wildcards.`
  }

  if (protectedId.startsWith('-')) {
    return `Protected id "${protectedId}" must not start with a hyphen.`
  }

  return null
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

    const mode = rawSource.mode ?? defaults.mode
    if (!isValidSourceMode(mode)) {
      issues.push(`${sourceLabel}: mode must be either "flat" or "nested".`)
    }

    const cloneTimeoutMs = normalizePositiveInteger(rawSource.cloneTimeoutMs ?? defaults.cloneTimeoutMs, `${sourceLabel}.cloneTimeoutMs`, defaults.cloneTimeoutMs, issues)
    const cloneMaxAttempts = normalizePositiveInteger(rawSource.cloneMaxAttempts ?? defaults.cloneMaxAttempts, `${sourceLabel}.cloneMaxAttempts`, defaults.cloneMaxAttempts, issues)

    const includes = normalizeFilterPatterns(rawSource.includes ?? defaults.includes, `${sourceLabel}.includes`, issues)
    const excludes = normalizeFilterPatterns(rawSource.excludes ?? defaults.excludes, `${sourceLabel}.excludes`, issues)

    return {
      id: typeof id === 'string' ? id : '',
      url: typeof rawSource.url === 'string' ? rawSource.url : '',
      branch: typeof branch === 'string' ? branch : defaults.branch,
      path: typeof normalizedPath === 'string' ? normalizedPath : defaults.path,
      mode: isValidSourceMode(mode) ? mode : defaults.mode,
      enabled: Boolean(enabled),
      preserveOnFailure: Boolean(preserveOnFailure),
      cloneTimeoutMs,
      cloneMaxAttempts,
      includes,
      excludes,
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
    mode: defaults.mode,
    enabled: false,
    preserveOnFailure: defaults.preserveOnFailure,
    cloneTimeoutMs: defaults.cloneTimeoutMs,
    cloneMaxAttempts: defaults.cloneMaxAttempts,
    includes: [...defaults.includes],
    excludes: [...defaults.excludes],
    priority: null,
  }
}

/**
 * @param {unknown} mode
 * @returns {mode is 'flat' | 'nested'}
 */
function isValidSourceMode(mode) {
  return typeof mode === 'string' && SOURCE_MODES.includes(mode)
}

/**
 * @param {unknown} value
 * @param {string} label
 * @param {number} fallback
 * @param {string[]} issues
 * @returns {number}
 */
function normalizePositiveInteger(value, label, fallback, issues) {
  if (!Number.isInteger(value) || value <= 0) {
    issues.push(`\`${label}\` must be a positive integer.`)
    return fallback
  }

  return value
}

/**
 * @param {unknown} rawPatterns
 * @param {string} label
 * @param {string[]} issues
 * @returns {string[]}
 */
function normalizeFilterPatterns(rawPatterns, label, issues) {
  if (rawPatterns === undefined) {
    return []
  }

  if (!Array.isArray(rawPatterns)) {
    issues.push(`\`${label}\` must be an array when provided.`)
    return []
  }

  /** @type {string[]} */
  const patterns = []
  for (const [patternIndex, rawPattern] of rawPatterns.entries()) {
    const patternLabel = `${label}[${patternIndex}]`
    if (typeof rawPattern !== 'string' || rawPattern.trim().length === 0) {
      issues.push(`\`${patternLabel}\` must be a non-empty string.`)
      continue
    }

    const pattern = rawPattern.trim()
    const patternIssue = validateFilterPattern(pattern)
    if (patternIssue) {
      issues.push(`\`${patternLabel}\`: ${patternIssue}`)
      continue
    }

    patterns.push(pattern)
  }

  return patterns
}

/**
 * @param {string} pattern
 * @returns {string | null}
 */
function validateFilterPattern(pattern) {
  if (pattern === '.') {
    return null
  }

  if (pattern.includes('\\')) {
    return `filter pattern "${pattern}" must use forward slashes.`
  }

  if (path.posix.isAbsolute(pattern)) {
    return `filter pattern "${pattern}" must be relative.`
  }

  const parts = pattern.split('/')
  if (parts.some(part => part.length === 0 || part === '.' || part === '..')) {
    return `filter pattern "${pattern}" must not contain empty, dot, or parent segments.`
  }

  return null
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
