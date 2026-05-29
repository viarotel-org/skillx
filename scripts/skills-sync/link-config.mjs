import { access, readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'
import { createJiti } from 'jiti'

export const DEFAULT_LINK_CONCURRENCY = 48
export const MAX_LINK_CONCURRENCY = 64

const CONFIG_FILENAMES = ['agents.config.ts', 'agents.config.js', 'agents.config.json']

/**
 * @typedef {object} LinkTarget
 * @property {string} absolutePath
 * @property {string} displayPath
 * @property {string} inputPath
 */

/**
 * @typedef {object} LinkConfig
 * @property {LinkTarget[]} targets
 * @property {number} concurrency
 * @property {'cli' | 'env' | 'config' | 'default'} targetSource
 * @property {string | null} configPath
 */

/**
 * @param {{ cwd?: string, targets?: string, env?: NodeJS.ProcessEnv, homeDir?: string }} [options]
 * @returns {Promise<LinkConfig>}
 */
export async function resolveLinkConfig(options = {}) {
  const cwd = options.cwd ?? process.cwd()
  const env = options.env ?? process.env
  const homeDir = options.homeDir ?? os.homedir()
  const loadedConfig = await loadOptionalAgentsConfig(cwd)
  const configDocument = loadedConfig?.document
  const configValues = normalizeConfigValues(configDocument)
  const targetResolution = resolveRawTargets({
    cliTargets: options.targets,
    envTargets: env.AGENTS_DIRS,
    configTargets: configValues.targets,
    homeDir,
  })

  return {
    targets: normalizeTargets(targetResolution.targets, { cwd, homeDir }),
    concurrency: normalizeConcurrency(configValues.concurrency),
    targetSource: targetResolution.source,
    configPath: loadedConfig?.configPath ?? null,
  }
}

/**
 * @param {string} cwd
 * @returns {Promise<{ configPath: string, document: unknown } | null>}
 */
export async function loadOptionalAgentsConfig(cwd) {
  for (const configFilename of CONFIG_FILENAMES) {
    const configPath = path.resolve(cwd, configFilename)
    if (!(await pathExists(configPath))) {
      continue
    }

    return {
      configPath,
      document: await loadAgentsConfigDocument(configPath),
    }
  }

  return null
}

/**
 * @param {string} configPath
 * @returns {Promise<unknown>}
 */
async function loadAgentsConfigDocument(configPath) {
  if (configPath.endsWith('.json')) {
    return JSON.parse(await readFile(configPath, 'utf8'))
  }

  const jiti = createJiti(pathToFileURL(configPath).href, {
    interopDefault: true,
  })

  return await jiti.import(configPath, { default: true })
}

/**
 * @param {unknown} configDocument
 * @returns {{ targets?: unknown, concurrency?: unknown }}
 */
export function normalizeConfigValues(configDocument) {
  if (!isPlainObject(configDocument)) {
    return {}
  }

  const topLevelConfig = {
    targets: configDocument.targets,
    concurrency: configDocument.concurrency,
  }

  if (!isPlainObject(configDocument.link)) {
    return topLevelConfig
  }

  return {
    targets: configDocument.link.targets ?? topLevelConfig.targets,
    concurrency: configDocument.link.concurrency ?? topLevelConfig.concurrency,
  }
}

/**
 * @param {{ cliTargets?: string, envTargets?: string, configTargets?: unknown, homeDir: string }} options
 * @returns {{ targets: unknown, source: LinkConfig['targetSource'] }}
 */
function resolveRawTargets(options) {
  if (typeof options.cliTargets === 'string' && options.cliTargets.trim().length > 0) {
    return {
      targets: options.cliTargets,
      source: 'cli',
    }
  }

  if (typeof options.envTargets === 'string' && options.envTargets.trim().length > 0) {
    return {
      targets: options.envTargets,
      source: 'env',
    }
  }

  if (options.configTargets !== undefined) {
    return {
      targets: options.configTargets,
      source: 'config',
    }
  }

  if (typeof options.homeDir !== 'string' || options.homeDir.trim().length === 0) {
    throw new Error('Unable to resolve default agents directory because HOME is not available.')
  }

  return {
    targets: path.join(options.homeDir, '.agents'),
    source: 'default',
  }
}

/**
 * @param {unknown} rawTargets
 * @param {{ cwd: string, homeDir: string }} options
 * @returns {LinkTarget[]}
 */
export function normalizeTargets(rawTargets, options) {
  const targetValues = parseRawTargets(rawTargets)
  const targetMap = new Map()

  for (const targetValue of targetValues) {
    const absolutePath = resolveTargetPath(targetValue, options)
    if (!targetMap.has(absolutePath)) {
      targetMap.set(absolutePath, {
        absolutePath,
        displayPath: formatDisplayPath(absolutePath, options.homeDir),
        inputPath: targetValue,
      })
    }
  }

  const targets = [...targetMap.values()]
  if (targets.length === 0) {
    throw new Error('At least one agents target directory is required.')
  }

  return targets
}

/**
 * @param {unknown} rawTargets
 * @returns {string[]}
 */
function parseRawTargets(rawTargets) {
  if (typeof rawTargets === 'string') {
    return rawTargets
      .split(',')
      .map(target => target.trim())
      .filter(target => target.length > 0)
  }

  if (Array.isArray(rawTargets)) {
    return rawTargets.flatMap((target) => {
      if (typeof target !== 'string') {
        throw new TypeError('Agents target entries must be strings.')
      }

      return parseRawTargets(target)
    })
  }

  throw new Error('Agents targets must be a comma-separated string or an array of strings.')
}

/**
 * @param {string} targetValue
 * @param {{ cwd: string, homeDir: string }} options
 * @returns {string}
 */
function resolveTargetPath(targetValue, options) {
  const expandedTarget = expandHomePath(targetValue, options.homeDir)
  const resolvedTarget = path.isAbsolute(expandedTarget)
    ? path.resolve(expandedTarget)
    : path.resolve(options.cwd, expandedTarget)

  return resolvedTarget
}

/**
 * @param {string} targetValue
 * @param {string} homeDir
 * @returns {string}
 */
function expandHomePath(targetValue, homeDir) {
  if (targetValue === '~') {
    assertHomeDir(homeDir)
    return homeDir
  }

  if (targetValue.startsWith('~/')) {
    assertHomeDir(homeDir)
    return path.join(homeDir, targetValue.slice(2))
  }

  return targetValue
}

/**
 * @param {unknown} rawConcurrency
 * @returns {number}
 */
export function normalizeConcurrency(rawConcurrency) {
  if (rawConcurrency === undefined) {
    return DEFAULT_LINK_CONCURRENCY
  }

  if (!Number.isInteger(rawConcurrency) || rawConcurrency < 1 || rawConcurrency > MAX_LINK_CONCURRENCY) {
    throw new Error(`Link concurrency must be an integer between 1 and ${MAX_LINK_CONCURRENCY}.`)
  }

  return rawConcurrency
}

/**
 * @param {string} targetPath
 * @param {string} homeDir
 * @returns {string}
 */
export function formatDisplayPath(targetPath, homeDir = os.homedir()) {
  if (typeof homeDir === 'string' && homeDir.length > 0) {
    const resolvedHome = path.resolve(homeDir)
    if (targetPath === resolvedHome) {
      return '~'
    }

    if (targetPath.startsWith(`${resolvedHome}${path.sep}`)) {
      return `~/${path.relative(resolvedHome, targetPath).split(path.sep).join('/')}`
    }
  }

  return targetPath
}

/**
 * @param {string} homeDir
 * @returns {void}
 */
function assertHomeDir(homeDir) {
  if (typeof homeDir !== 'string' || homeDir.trim().length === 0) {
    throw new Error('Unable to expand ~ because HOME is not available.')
  }
}

/**
 * @param {string} targetPath
 * @returns {Promise<boolean>}
 */
async function pathExists(targetPath) {
  try {
    await access(targetPath)
    return true
  }
  catch {
    return false
  }
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
