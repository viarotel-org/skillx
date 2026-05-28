#!/usr/bin/env node
import process from 'node:process'
import { getErrorMessage, loadSkillsConfig } from './skills-sync/config.mjs'
import { pathExists, resolveInside, SKILLS_ROOT } from './skills-sync/fs.mjs'
import { createLogger } from './skills-sync/logger.mjs'

const logger = createLogger()

try {
  const options = parseArgs(process.argv.slice(2))
  const cwd = process.cwd()
  const config = await loadSkillsConfig({ cwd, configPath: options.configPath })
  const localSkillsPath = resolveInside(cwd, SKILLS_ROOT, 'local')

  if (!(await pathExists(localSkillsPath))) {
    throw new Error('Protected directory skills/local does not exist.')
  }

  logger.success(`Validated ${config.sources.length} sources from ${config.configPath}.`)
}
catch (error) {
  logger.error(getErrorMessage(error))
  process.exitCode = 1
}

/**
 * @param {string[]} args
 * @returns {{ configPath?: string }}
 */
function parseArgs(args) {
  /** @type {{ configPath?: string }} */
  const options = {
    configPath: undefined,
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

    throw new Error(`Unknown argument: ${arg}`)
  }

  return options
}
