import process from 'node:process'

export function createLogger(options = {}) {
  const isGithubActions = options.isGithubActions ?? process.env.GITHUB_ACTIONS === 'true'
  const verbose = options.verbose ?? false

  return {
    info(message) {
      writeLine(process.stdout, `[info] ${message}`)
    },
    success(message) {
      writeLine(process.stdout, `[ok] ${message}`)
    },
    warn(message) {
      if (isGithubActions) {
        writeLine(process.stdout, `::warning::${escapeWorkflowCommand(message)}`)
      }
      else {
        writeLine(process.stderr, `[warn] ${message}`)
      }
    },
    error(message) {
      if (isGithubActions) {
        writeLine(process.stdout, `::error::${escapeWorkflowCommand(message)}`)
      }
      else {
        writeLine(process.stderr, `[error] ${message}`)
      }
    },
    debug(message) {
      if (verbose) {
        writeLine(process.stdout, `[debug] ${message}`)
      }
    },
    group(message) {
      if (isGithubActions) {
        writeLine(process.stdout, `::group::${escapeWorkflowCommand(message)}`)
      }
      else {
        writeLine(process.stdout, `[group] ${message}`)
      }
    },
    groupEnd() {
      if (isGithubActions) {
        writeLine(process.stdout, '::endgroup::')
      }
    },
  }
}

function writeLine(stream, message) {
  stream.write(`${message}\n`)
}

function escapeWorkflowCommand(message) {
  return String(message)
    .replaceAll('%', '%25')
    .replaceAll('\r', '%0D')
    .replaceAll('\n', '%0A')
}
