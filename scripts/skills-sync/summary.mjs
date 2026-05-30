import { mkdir, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

const WRITE_STEP_SUMMARY_VALUE = '1'

/**
 * @typedef {object} DeduplicatedSummaryItem
 * @property {string} source
 * @property {string} path
 * @property {string} target
 * @property {string} duplicateOfSource
 * @property {string} duplicateOfPath
 */

/**
 * @typedef {object} SummaryItem
 * @property {string} id
 * @property {string} [type]
 * @property {string} [location]
 * @property {string} [branch]
 * @property {string} [path]
 * @property {string} [status]
 * @property {number} [skillCount]
 * @property {string | null} [commit]
 * @property {string} [message]
 * @property {{ path: string, target: string, reason?: string }[]} [skippedSymlinks]
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
 * @property {{ source: string, path: string, target: string, reason?: string }[]} skippedSymlinks
 * @property {DeduplicatedSummaryItem[]} deduplicated
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
    skippedSymlinks: [],
    deduplicated: [],
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
    `- Deduplicated: ${summary.deduplicated.length}`,
    `- Stale removed: ${summary.staleRemoved.length}`,
    '',
    '## Sources',
    '',
    '| Source | Status | Skills | Commit | Message |',
    '| --- | --- | ---: | --- | --- |',
    ...formatSourceRows(summary),
    '',
    '## Deduplication',
    '',
    ...formatDeduplicationLines(summary),
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

  const markdownSummary = formatSummaryMarkdown(summary)
  await writeFileAtomic(path.join(summaryDirectory, 'summary.md'), markdownSummary)
  await writeFileAtomic(path.join(summaryDirectory, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`)

  if (process.env.SKILLX_WRITE_STEP_SUMMARY === WRITE_STEP_SUMMARY_VALUE && process.env.GITHUB_STEP_SUMMARY) {
    await writeFileAtomic(process.env.GITHUB_STEP_SUMMARY, markdownSummary)
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

  if (summary.skippedSymlinks.length > 0) {
    lines.push(`- Skipped unsafe symlinks: ${summary.skippedSymlinks.map(formatSkippedSymlink).join(', ')}`)
  }

  if (lines.length === 0) {
    lines.push('- No cleanup actions.')
  }

  return lines
}

/**
 * @param {{ source: string, path: string, target: string, reason?: string }} item
 * @returns {string}
 */
function formatSkippedSymlink(item) {
  const reason = item.reason ? ` (${item.reason})` : ''
  return `${item.source}/${item.path} -> ${item.target}${reason}`
}

/**
 * @param {SyncSummary} summary
 * @returns {string[]}
 */
function formatDeduplicationLines(summary) {
  if (summary.deduplicated.length === 0) {
    return ['- No duplicate skills removed.']
  }

  return summary.deduplicated.map(item => `- Dropped ${item.source}/${item.path} (${item.target}) because it matches ${item.duplicateOfSource}/${item.duplicateOfPath}.`)
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function escapeTableCell(value) {
  return String(value).replaceAll('|', '\\|').replaceAll('\n', '<br>')
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
