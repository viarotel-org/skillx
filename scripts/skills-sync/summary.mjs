import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

/**
 * @typedef {object} SummaryItem
 * @property {string} id
 * @property {string} [url]
 * @property {string} [branch]
 * @property {string} [path]
 * @property {string} [status]
 * @property {number} [skillCount]
 * @property {string | null} [commit]
 * @property {string} [message]
 */

/**
 * @typedef {object} SyncSummary
 * @property {boolean} dryRun
 * @property {string | undefined} configPath
 * @property {number} totalSources
 * @property {SummaryItem[]} synced
 * @property {SummaryItem[]} failed
 * @property {SummaryItem[]} skipped
 * @property {string[]} staleRemoved
 * @property {string[]} stalePlanned
 * @property {string[]} unknownDirs
 */

/**
 * @param {{ dryRun?: boolean, configPath?: string }} [options]
 * @returns {SyncSummary}
 */
export function createSummary(options = {}) {
  return {
    dryRun: Boolean(options.dryRun),
    configPath: options.configPath,
    totalSources: 0,
    synced: [],
    failed: [],
    skipped: [],
    staleRemoved: [],
    stalePlanned: [],
    unknownDirs: [],
  }
}

/**
 * @param {SyncSummary} summary
 * @returns {string}
 */
export function formatSummaryMarkdown(summary) {
  const lines = [
    '# Skills subscription sync',
    '',
    `- Mode: ${summary.dryRun ? 'dry-run' : 'write'}`,
    `- Config: ${summary.configPath}`,
    `- Total sources: ${summary.totalSources}`,
    `- Synced: ${summary.synced.length}`,
    `- Failed: ${summary.failed.length}`,
    `- Skipped: ${summary.skipped.length}`,
    `- Stale removed: ${summary.staleRemoved.length}`,
    '',
    '## Sources',
    '',
    '| Source | Status | Skills | Commit | Message |',
    '| --- | --- | ---: | --- | --- |',
    ...formatSourceRows(summary),
    '',
    '## Cleanup',
    '',
    ...formatCleanupLines(summary),
  ]

  return `${lines.join('\n')}\n`
}

/**
 * @param {string} cwd
 * @param {SyncSummary} summary
 * @returns {Promise<void>}
 */
export async function writeSummaryFiles(cwd, summary) {
  const summaryDirectory = path.resolve(cwd, '.skills-sync')
  await mkdir(summaryDirectory, { recursive: true })
  await writeFile(path.join(summaryDirectory, 'summary.md'), formatSummaryMarkdown(summary), 'utf8')
  await writeFile(path.join(summaryDirectory, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`, 'utf8')

  if (process.env.GITHUB_STEP_SUMMARY) {
    await writeFile(process.env.GITHUB_STEP_SUMMARY, formatSummaryMarkdown(summary), 'utf8')
  }
}

/**
 * @param {SyncSummary} summary
 * @returns {string[]}
 */
function formatSourceRows(summary) {
  const rows = [
    ...summary.synced.map(item => formatRow(item, 'synced')),
    ...summary.failed.map(item => formatRow(item, 'failed')),
    ...summary.skipped.map(item => formatRow(item, 'skipped')),
  ]

  if (rows.length === 0) {
    return ['| _none_ | - | 0 | - | - |']
  }

  return rows
}

/**
 * @param {SummaryItem} item
 * @param {string} status
 * @returns {string}
 */
function formatRow(item, status) {
  return `| ${escapeTableCell(item.id)} | ${status} | ${item.skillCount ?? 0} | ${formatCommit(item.commit)} | ${escapeTableCell(item.message ?? '')} |`
}

/**
 * @param {string | null | undefined} commit
 * @returns {string}
 */
function formatCommit(commit) {
  if (!commit) {
    return '-'
  }

  return commit.slice(0, 12)
}

/**
 * @param {SyncSummary} summary
 * @returns {string[]}
 */
function formatCleanupLines(summary) {
  const lines = []

  if (summary.staleRemoved.length > 0) {
    lines.push(`- Removed stale generated directories: ${summary.staleRemoved.join(', ')}`)
  }

  if (summary.stalePlanned.length > 0) {
    lines.push(`- Dry-run would remove stale generated directories: ${summary.stalePlanned.join(', ')}`)
  }

  if (summary.unknownDirs.length > 0) {
    lines.push(`- Unknown directories left untouched: ${summary.unknownDirs.join(', ')}`)
  }

  if (lines.length === 0) {
    lines.push('- No cleanup actions.')
  }

  return lines
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function escapeTableCell(value) {
  return String(value).replaceAll('|', '\\|').replaceAll('\n', '<br>')
}
