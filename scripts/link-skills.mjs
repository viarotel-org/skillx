#!/usr/bin/env node
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { getErrorMessage } from './skills-sync/config.mjs'
import { acquireSyncLock } from './skills-sync/fs.mjs'
import { resolveLinkConfig } from './skills-sync/link-config.mjs'
import { formatLinkSummary, hasLinkFailures, linkSkillDirectories } from './skills-sync/link.mjs'
import { createLogger } from './skills-sync/logger.mjs'

/**
 * @typedef {object} LinkOptions
 * @property {string} [targets]
 * @property {boolean} [dryRun]
 * @property {boolean} [force]
 * @property {boolean} [verbose]
 * @property {string} [cwd]
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
    const summary = await linkSkills(options, logger)
    if (hasLinkFailures(summary)) {
      process.exitCode = 1
    }
  }
  catch (error) {
    logger.error(getErrorMessage(error))
    process.exitCode = 1
  }
}

/**
 * @param {LinkOptions} [options]
 * @param {ReturnType<typeof createLogger>} [logger]
 * @returns {Promise<import('./skills-sync/link.mjs').LinkRunSummary>}
 */
export async function linkSkills(options = {}, logger = createLogger()) {
  const cwd = options.cwd ?? process.cwd()
  const releaseLock = await acquireSyncLock(cwd)

  try {
    const config = await resolveLinkConfig({
      cwd,
      targets: options.targets,
    })

    logger.info(`Loaded ${config.targets.length} link targets from ${config.targetSource}.`)
    logger.info(`Using link concurrency ${config.concurrency}.`)
    if (options.dryRun) {
      logger.info('Dry-run mode is enabled. Symlinks will not be changed.')
    }

    const summary = await linkSkillDirectories(cwd, config, options, logger)
    for (const line of formatLinkSummary(summary)) {
      logger.info(line)
    }

    return summary
  }
  finally {
    await releaseLock()
  }
}

/**
 * @param {string[]} args
 * @returns {LinkOptions}
 */
export function parseArgs(args) {
  /** @type {LinkOptions} */
  const options = {
    targets: undefined,
    dryRun: false,
    force: false,
    verbose: false,
  }

  for (let argIndex = 0; argIndex < args.length; argIndex += 1) {
    const arg = args[argIndex]
    if (arg === '--') {
      continue
    }

    if (arg === '--targets') {
      if (!args[argIndex + 1] || args[argIndex + 1].startsWith('--')) {
        throw new Error('--targets requires a comma-separated directory list.')
      }
      options.targets = args[argIndex + 1]
      argIndex += 1
      continue
    }

    if (arg === '--dry-run') {
      options.dryRun = true
      continue
    }

    if (arg === '--force') {
      options.force = true
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
