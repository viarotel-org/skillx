import { Buffer } from 'node:buffer'
import { spawn } from 'node:child_process'
import process from 'node:process'

export class GitCommandError extends Error {
  constructor(message, details = {}) {
    super(message)
    this.name = 'GitCommandError'
    this.command = details.command ?? ''
    this.exitCode = details.exitCode ?? null
    this.stderr = details.stderr ?? ''
  }
}

export async function cloneSource(source, destinationPath, options = {}) {
  const args = [
    'clone',
    '--depth',
    '1',
    '--single-branch',
    '--branch',
    source.branch,
    source.location,
    destinationPath,
  ]

  await runGit(args, {
    cwd: options.cwd ?? process.cwd(),
    timeoutMs: options.timeoutMs ?? source.cloneTimeoutMs ?? 300000,
  })
}

export async function getHeadCommit(repoPath) {
  const result = await runGit(['rev-parse', 'HEAD'], { cwd: repoPath })
  return result.stdout.trim()
}

export function classifyGitError(error) {
  if (error instanceof Error && error.message.includes('Source path') && error.message.includes('does not exist')) {
    return 'source_path_missing'
  }

  if (!(error instanceof GitCommandError)) {
    return 'git_error'
  }

  const stderr = error.stderr.toLowerCase()
  if (stderr.includes('repository not found')) {
    return 'repository_not_found'
  }

  if (stderr.includes('remote branch') && stderr.includes('not found')) {
    return 'branch_not_found'
  }

  if (stderr.includes('permission denied') || stderr.includes('authentication failed')) {
    return 'permission_denied'
  }

  if (stderr.includes('could not resolve host')
    || stderr.includes('failed to connect')
    || stderr.includes('ssl_error')
    || stderr.includes('network')
    || stderr.includes('unable to access')) {
    return 'network_error'
  }

  return 'clone_failed'
}

export function formatCommandError(error) {
  if (error instanceof GitCommandError && error.stderr.trim().length > 0) {
    return error.stderr.trim().split('\n').slice(-3).join(' ')
  }

  if (error instanceof Error) {
    return error.message
  }

  return String(error)
}

async function runGit(args, options = {}) {
  return new Promise((resolve, reject) => {
    const childProcess = spawn('git', args, {
      cwd: options.cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    const stdoutChunks = []
    const stderrChunks = []
    const timeout = options.timeoutMs
      ? setTimeout(() => {
          childProcess.kill('SIGTERM')
        }, options.timeoutMs)
      : null

    childProcess.stdout.on('data', chunk => stdoutChunks.push(chunk))
    childProcess.stderr.on('data', chunk => stderrChunks.push(chunk))
    childProcess.on('error', (error) => {
      if (timeout) {
        clearTimeout(timeout)
      }
      reject(error)
    })
    childProcess.on('close', (exitCode) => {
      if (timeout) {
        clearTimeout(timeout)
      }

      const stdout = Buffer.concat(stdoutChunks).toString('utf8')
      const stderr = Buffer.concat(stderrChunks).toString('utf8')

      if (exitCode === 0) {
        resolve({ stdout, stderr })
        return
      }

      reject(new GitCommandError(`git ${args.join(' ')} failed with exit code ${exitCode}`, {
        command: `git ${args.join(' ')}`,
        exitCode,
        stderr,
      }))
    })
  })
}
