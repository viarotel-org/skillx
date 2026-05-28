import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { it } from 'vitest'
import { ConfigValidationError, validateConfigDocument, validateRelativePath, validateSourceId } from '../scripts/skills-sync/config.mjs'
import {
  acquireSyncLock,
  copyDirectory,
  discoverSkillDirs,
  filterSkillDirs,
  getStaleManagedIds,
  listUnknownSkillDirs,
  pathExists,
  planSkillTargets,
  readManifest,
  resolveInside,
} from '../scripts/skills-sync/fs.mjs'
import { createSummary, writeSummaryFiles } from '../scripts/skills-sync/summary.mjs'

const execFileAsync = promisify(execFile)

it('validates a minimal skills source config', () => {
  const config = validateConfigDocument({
    version: 1,
    sources: [
      {
        id: 'anthropic',
        location: 'https://github.com/anthropics/skills.git',
      },
    ],
  })

  assert.equal(config.sources.length, 1)
  assert.equal(config.sources[0].type, 'remote')
  assert.equal(config.sources[0].location, 'https://github.com/anthropics/skills.git')
  assert.equal(config.sources[0].branch, 'main')
  assert.equal(config.sources[0].path, 'skills')
  assert.equal(config.sources[0].mode, 'flat')
  assert.equal(config.sources[0].enabled, true)
  assert.equal(config.sources[0].preserveOnFailure, false)
  assert.deepEqual(config.sources[0].includes, [])
  assert.deepEqual(config.sources[0].excludes, [])
})

it('can import the sync orchestrator without executing the CLI', async () => {
  const syncScriptUrl = pathToFileURL(path.resolve('scripts/sync-skills.mjs'))
  syncScriptUrl.searchParams.set('testImport', String(Date.now()))

  const syncModule = await import(syncScriptUrl.href)

  assert.equal(typeof syncModule.syncSkills, 'function')
  assert.equal(typeof syncModule.parseArgs, 'function')
})

it('normalizes clone timeout and retry settings', () => {
  const config = validateConfigDocument({
    version: 1,
    defaults: {
      cloneTimeoutMs: 600000,
      cloneMaxAttempts: 4,
    },
    sources: [
      {
        id: 'openai',
        location: 'https://github.com/openai/skills.git',
        cloneTimeoutMs: 900000,
        cloneMaxAttempts: 2,
      },
    ],
  })

  assert.equal(config.defaults.cloneTimeoutMs, 600000)
  assert.equal(config.defaults.cloneMaxAttempts, 4)
  assert.equal(config.sources[0].cloneTimeoutMs, 900000)
  assert.equal(config.sources[0].cloneMaxAttempts, 2)
})

it('normalizes source concurrency settings', () => {
  const config = validateConfigDocument({
    version: 1,
    defaults: {
      sourceConcurrency: 2,
    },
    sources: [
      {
        id: 'openai',
        location: 'https://github.com/openai/skills.git',
      },
    ],
  })

  assert.equal(config.defaults.sourceConcurrency, 2)
})

it('rejects invalid clone timeout and retry settings', () => {
  assert.throws(() => validateConfigDocument({
    version: 1,
    defaults: {
      cloneTimeoutMs: 0,
      cloneMaxAttempts: 0,
    },
    sources: [
      {
        id: 'openai',
        location: 'https://github.com/openai/skills.git',
      },
    ],
  }), ConfigValidationError)

  assert.throws(() => validateConfigDocument({
    version: 1,
    sources: [
      {
        id: 'openai',
        location: 'https://github.com/openai/skills.git',
        cloneTimeoutMs: 1.5,
        cloneMaxAttempts: 'three',
      },
    ],
  }), ConfigValidationError)
})

it('rejects invalid source concurrency settings', () => {
  assert.throws(() => validateConfigDocument({
    version: 1,
    defaults: {
      sourceConcurrency: 0,
    },
    sources: [
      {
        id: 'openai',
        location: 'https://github.com/openai/skills.git',
      },
    ],
  }), ConfigValidationError)
})

it('validates remote and local source locations', () => {
  const config = validateConfigDocument({
    version: 1,
    sources: [
      {
        id: 'openai',
        type: 'remote',
        location: 'https://github.com/openai/skills.git',
      },
      {
        id: 'skillx',
        type: 'local',
        location: 'skillx',
        path: '.',
      },
    ],
  })

  assert.equal(config.sources[0].type, 'remote')
  assert.equal(config.sources[0].location, 'https://github.com/openai/skills.git')
  assert.equal(config.sources[1].type, 'local')
  assert.equal(config.sources[1].location, 'skillx')
  assert.equal(config.sources[1].path, '.')
})

it('rejects old url-only sources and invalid locations', () => {
  assert.throws(() => validateConfigDocument({
    version: 1,
    sources: [
      {
        id: 'openai',
        url: 'https://github.com/openai/skills.git',
      },
    ],
  }), ConfigValidationError)

  assert.throws(() => validateConfigDocument({
    version: 1,
    sources: [
      {
        id: 'local-source',
        type: 'local',
        location: '../skills',
      },
    ],
  }), ConfigValidationError)

  assert.throws(() => validateConfigDocument({
    version: 1,
    sources: [
      {
        id: 'remote-source',
        type: 'remote',
        location: 'skillx/local-source',
      },
    ],
  }), ConfigValidationError)
})

it('runs async work with a stable order and a concurrency limit', async () => {
  const syncScriptUrl = pathToFileURL(path.resolve('scripts/sync-skills.mjs'))
  syncScriptUrl.searchParams.set('concurrencyTest', String(Date.now()))
  const { mapWithConcurrency } = await import(syncScriptUrl.href)
  let activeCount = 0
  let maxActiveCount = 0

  const results = await mapWithConcurrency([1, 2, 3, 4], 2, async (value) => {
    activeCount += 1
    maxActiveCount = Math.max(maxActiveCount, activeCount)
    await new Promise(resolve => setTimeout(resolve, 5 - value))
    activeCount -= 1

    return value * 2
  })

  assert.deepEqual(results, [2, 4, 6, 8])
  assert.equal(maxActiveCount, 2)
})

it('validates source mode and skill filters', () => {
  const config = validateConfigDocument({
    version: 1,
    defaults: {
      mode: 'nested',
      includes: ['.curated/**'],
      excludes: ['.curated/legacy'],
    },
    sources: [
      {
        id: 'openai',
        location: 'https://github.com/openai/skills.git',
        mode: 'flat',
        includes: ['.curated/aspnet-core'],
        excludes: ['.curated/**/draft'],
      },
    ],
  })

  assert.equal(config.defaults.mode, 'nested')
  assert.deepEqual(config.defaults.includes, ['.curated/**'])
  assert.deepEqual(config.defaults.excludes, ['.curated/legacy'])
  assert.equal(config.sources[0].mode, 'flat')
  assert.deepEqual(config.sources[0].includes, ['.curated/aspnet-core'])
  assert.deepEqual(config.sources[0].excludes, ['.curated/**/draft'])
})

it('rejects invalid modes and unsafe skill filters', () => {
  assert.throws(() => validateConfigDocument({
    version: 1,
    sources: [
      {
        id: 'openai',
        location: 'https://github.com/openai/skills.git',
        mode: 'wide',
        includes: ['/absolute'],
        excludes: ['../escape'],
      },
    ],
  }), ConfigValidationError)
})

it('rejects protected source ids', () => {
  assert.equal(validateSourceId('local', ['local']), 'Source id "local" is protected and cannot be generated.')
})

it('rejects source ids matching protected id patterns', () => {
  assert.equal(validateSourceId('reserved-escrcpy', ['reserved-*']), 'Source id "reserved-escrcpy" is protected and cannot be generated.')
})

it('validates protected id patterns in config', () => {
  const config = validateConfigDocument({
    version: 1,
    protectedIds: ['reserved-*'],
    sources: [
      {
        id: 'openai',
        location: 'https://github.com/openai/skills.git',
      },
    ],
  })

  assert.ok(config.protectedIds.includes('reserved-*'))
})

it('rejects unsafe protected id patterns in config', () => {
  assert.throws(() => validateConfigDocument({
    version: 1,
    protectedIds: ['reserved/**'],
    sources: [
      {
        id: 'openai',
        location: 'https://github.com/openai/skills.git',
      },
    ],
  }), ConfigValidationError)

  assert.throws(() => validateConfigDocument({
    version: 1,
    protectedIds: ['*'],
    sources: [
      {
        id: 'openai',
        location: 'https://github.com/openai/skills.git',
      },
    ],
  }), ConfigValidationError)
})

it('rejects duplicate source ids', () => {
  assert.throws(() => validateConfigDocument({
    version: 1,
    sources: [
      {
        id: 'openai',
        location: 'https://github.com/openai/skills.git',
      },
      {
        id: 'openai',
        location: 'https://github.com/example/skills.git',
      },
    ],
  }), ConfigValidationError)
})

it('rejects unsafe source paths', () => {
  assert.equal(validateRelativePath('../skills'), 'Source path "../skills" must not contain empty, dot, or parent segments.')
  assert.equal(validateRelativePath('/skills'), 'Source path "/skills" must be relative.')
  assert.equal(validateRelativePath('packages//skills'), 'Source path "packages//skills" must not contain empty, dot, or parent segments.')
  assert.equal(validateRelativePath('.'), null)
})

it('computes stale managed ids from manifest without protected ids', () => {
  const staleManagedIds = getStaleManagedIds({
    version: 1,
    sources: {
      anthropic: {},
      local: {},
      openai: {},
    },
  }, ['openai'], ['local'])

  assert.deepEqual(staleManagedIds, ['anthropic'])
})

it('computes stale managed ids from flat manifest targets', () => {
  const staleManagedIds = getStaleManagedIds({
    version: 2,
    sources: {
      'remote-openai': {
        targets: ['remote-openai-curated-aspnet-core', 'remote-openai-curated-python'],
      },
      'remote-anthropic': {
        targets: ['remote-anthropic'],
      },
    },
  }, ['remote-openai-curated-aspnet-core'], [])

  assert.deepEqual(staleManagedIds, ['remote-anthropic', 'remote-openai-curated-python'])
})

it('does not mark managed ids matching protected patterns as stale', () => {
  const staleManagedIds = getStaleManagedIds({
    version: 2,
    sources: {
      'reserved': {
        targets: ['reserved-escrcpy', 'reserved-viarotel'],
      },
      'remote-openai': {
        targets: ['remote-openai-imagegen'],
      },
    },
  }, [], ['reserved-*'])

  assert.deepEqual(staleManagedIds, ['remote-openai-imagegen'])
})

it('does not report unknown skill dirs matching protected patterns', async () => {
  const rootPath = await mkdtemp(path.join(tmpdir(), 'skillx-test-'))

  try {
    await mkdir(path.join(rootPath, 'skills', 'reserved-escrcpy'), { recursive: true })
    await mkdir(path.join(rootPath, 'skills', 'reserved-viarotel'), { recursive: true })
    await mkdir(path.join(rootPath, 'skills', 'remote-old'), { recursive: true })

    const unknownSkillDirs = await listUnknownSkillDirs(rootPath, [], ['reserved-*'])

    assert.deepEqual(unknownSkillDirs, ['remote-old'])
  }
  finally {
    await rm(rootPath, { recursive: true, force: true })
  }
})

it('prevents concurrent sync runs with a repository lock', async () => {
  const rootPath = await mkdtemp(path.join(tmpdir(), 'skillx-test-'))

  try {
    const releaseLock = await acquireSyncLock(rootPath)

    await assert.rejects(() => acquireSyncLock(rootPath), /already running/)

    await releaseLock()

    const releaseSecondLock = await acquireSyncLock(rootPath)
    await releaseSecondLock()
  }
  finally {
    await rm(rootPath, { recursive: true, force: true })
  }
})

it('reports corrupted manifests with recovery guidance', async () => {
  const rootPath = await mkdtemp(path.join(tmpdir(), 'skillx-test-'))

  try {
    await mkdir(path.join(rootPath, '.skills-sync'), { recursive: true })
    await writeFile(path.join(rootPath, '.skills-sync', 'manifest.json'), '{ invalid json', 'utf8')

    await assert.rejects(() => readManifest(rootPath), /Manifest parse failed.*pnpm sync:dry-run/s)
  }
  finally {
    await rm(rootPath, { recursive: true, force: true })
  }
})

it('removes previously managed targets when a source no longer exposes its skills path', async () => {
  const rootPath = await mkdtemp(path.join(tmpdir(), 'skillx-test-'))
  const sourceRepoPath = await mkdtemp(path.join(tmpdir(), 'skillx-source-'))

  try {
    await createGitRepo(sourceRepoPath)
    const sourceLocation = pathToFileURL(sourceRepoPath).href
    await writeFile(path.join(rootPath, 'skills-sources.yaml'), [
      'version: 1',
      'sources:',
      '  - id: fixture',
      '    type: remote',
      `    location: ${sourceLocation}`,
      '    branch: main',
      '    path: missing-skills',
      '    preserveOnFailure: false',
      '',
    ].join('\n'), 'utf8')
    await mkdir(path.join(rootPath, '.skills-sync'), { recursive: true })
    await writeFile(path.join(rootPath, '.skills-sync', 'manifest.json'), `${JSON.stringify({
      version: 2,
      sources: {
        'remote-fixture': {
          targets: ['remote-fixture-old-skill'],
        },
      },
    }, null, 2)}\n`, 'utf8')
    await mkdir(path.join(rootPath, 'skills', 'remote-fixture-old-skill'), { recursive: true })

    const syncScriptUrl = pathToFileURL(path.resolve('scripts/sync-skills.mjs'))
    syncScriptUrl.searchParams.set('sourceTruthTest', String(Date.now()))
    const { syncSkills } = await import(syncScriptUrl.href)

    await syncSkills({ cwd: rootPath }, createSilentLogger())

    const manifest = await readManifest(rootPath)
    assert.deepEqual(manifest?.sources, {})
    assert.equal(await pathExists(path.join(rootPath, 'skills', 'remote-fixture-old-skill')), false)
  }
  finally {
    await rm(rootPath, { recursive: true, force: true })
    await rm(sourceRepoPath, { recursive: true, force: true })
  }
})

it('syncs a local git fixture idempotently and removes skills deleted upstream', async () => {
  const rootPath = await mkdtemp(path.join(tmpdir(), 'skillx-test-'))
  const sourceRepoPath = await mkdtemp(path.join(tmpdir(), 'skillx-source-'))

  try {
    await createGitRepo(sourceRepoPath, {
      'skills/alpha/SKILL.md': '# Alpha',
      'skills/beta/SKILL.md': '# Beta',
    })
    await writeSourceConfig(rootPath, sourceRepoPath)

    const syncScriptUrl = pathToFileURL(path.resolve('scripts/sync-skills.mjs'))
    syncScriptUrl.searchParams.set('fixtureSyncTest', String(Date.now()))
    const { syncSkills } = await import(syncScriptUrl.href)

    await syncSkills({ cwd: rootPath }, createSilentLogger())

    assert.equal(await pathExists(path.join(rootPath, 'skills', 'fixture-alpha', 'SKILL.md')), true)
    assert.equal(await pathExists(path.join(rootPath, 'skills', 'fixture-beta', 'SKILL.md')), true)

    await rm(path.join(sourceRepoPath, 'skills', 'beta'), { recursive: true, force: true })
    await commitAll(sourceRepoPath, 'remove beta skill')
    await syncSkills({ cwd: rootPath }, createSilentLogger())

    const manifestAfterRemoval = await readManifest(rootPath)
    assert.deepEqual(manifestAfterRemoval?.sources.fixture.targets, ['fixture-alpha'])
    assert.equal(manifestAfterRemoval?.sources.fixture.type, 'remote')
    assert.equal(manifestAfterRemoval?.sources.fixture.location, pathToFileURL(sourceRepoPath).href)
    assert.equal(await pathExists(path.join(rootPath, 'skills', 'fixture-alpha', 'SKILL.md')), true)
    assert.equal(await pathExists(path.join(rootPath, 'skills', 'fixture-beta')), false)

    const manifestSnapshot = JSON.stringify(manifestAfterRemoval)
    await syncSkills({ cwd: rootPath }, createSilentLogger())

    assert.equal(JSON.stringify(await readManifest(rootPath)), manifestSnapshot)
  }
  finally {
    await rm(rootPath, { recursive: true, force: true })
    await rm(sourceRepoPath, { recursive: true, force: true })
  }
})

it('syncs a local project directory and removes local skills deleted from the source', async () => {
  const rootPath = await mkdtemp(path.join(tmpdir(), 'skillx-test-'))

  try {
    await mkdir(path.join(rootPath, 'skillx', 'alpha'), { recursive: true })
    await mkdir(path.join(rootPath, 'skillx', 'beta'), { recursive: true })
    await writeFile(path.join(rootPath, 'skillx', 'alpha', 'SKILL.md'), '# Alpha\n', 'utf8')
    await writeFile(path.join(rootPath, 'skillx', 'beta', 'SKILL.md'), '# Beta\n', 'utf8')
    await writeFile(path.join(rootPath, 'skills-sources.yaml'), [
      'version: 1',
      'sources:',
      '  - id: skillx',
      '    type: local',
      '    location: skillx',
      '    path: .',
      '',
    ].join('\n'), 'utf8')

    const syncScriptUrl = pathToFileURL(path.resolve('scripts/sync-skills.mjs'))
    syncScriptUrl.searchParams.set('localSourceTest', String(Date.now()))
    const { syncSkills } = await import(syncScriptUrl.href)

    await syncSkills({ cwd: rootPath }, createSilentLogger())

    assert.equal(await pathExists(path.join(rootPath, 'skills', 'skillx-alpha', 'SKILL.md')), true)
    assert.equal(await pathExists(path.join(rootPath, 'skills', 'skillx-beta', 'SKILL.md')), true)

    await rm(path.join(rootPath, 'skillx', 'beta'), { recursive: true, force: true })
    await syncSkills({ cwd: rootPath }, createSilentLogger())

    const manifestAfterRemoval = await readManifest(rootPath)
    assert.deepEqual(manifestAfterRemoval?.sources.skillx.targets, ['skillx-alpha'])
    assert.equal(manifestAfterRemoval?.sources.skillx.type, 'local')
    assert.equal(manifestAfterRemoval?.sources.skillx.location, 'skillx')
    assert.equal(manifestAfterRemoval?.sources.skillx.commit, null)
    assert.equal(await pathExists(path.join(rootPath, 'skills', 'skillx-alpha', 'SKILL.md')), true)
    assert.equal(await pathExists(path.join(rootPath, 'skills', 'skillx-beta')), false)
    assert.equal(await pathExists(path.join(rootPath, 'skillx', 'alpha', 'SKILL.md')), true)
  }
  finally {
    await rm(rootPath, { recursive: true, force: true })
  }
})

it('skips symlinks when copying skills and reports skipped paths', async () => {
  const sourcePath = await mkdtemp(path.join(tmpdir(), 'skillx-source-'))
  const targetPath = await mkdtemp(path.join(tmpdir(), 'skillx-target-'))
  const skippedSymlinks = []

  try {
    await writeFile(path.join(sourcePath, 'SKILL.md'), '# Skill\n', 'utf8')
    await symlink('/tmp/outside-skillx-target', path.join(sourcePath, 'outside-link'))

    await copyDirectory(sourcePath, path.join(targetPath, 'copied'), { skippedSymlinks })

    assert.equal(await readFile(path.join(targetPath, 'copied', 'SKILL.md'), 'utf8'), '# Skill\n')
    assert.equal(await pathExists(path.join(targetPath, 'copied', 'outside-link')), false)
    assert.deepEqual(skippedSymlinks, [{ path: 'outside-link', target: '/tmp/outside-skillx-target' }])
  }
  finally {
    await rm(sourcePath, { recursive: true, force: true })
    await rm(targetPath, { recursive: true, force: true })
  }
})

it('writes GitHub step summaries only when explicitly enabled', async () => {
  const rootPath = await mkdtemp(path.join(tmpdir(), 'skillx-test-'))
  const stepSummaryPath = path.join(rootPath, 'step-summary.md')
  const previousStepSummary = process.env.GITHUB_STEP_SUMMARY
  const previousWriteStepSummary = process.env.SKILLX_WRITE_STEP_SUMMARY

  try {
    process.env.GITHUB_STEP_SUMMARY = stepSummaryPath
    delete process.env.SKILLX_WRITE_STEP_SUMMARY

    const summary = createSummary({ configPath: 'skills-sources.yaml' })
    summary.totalSources = 1

    await writeSummaryFiles(rootPath, summary)

    assert.equal(await pathExists(stepSummaryPath), false)

    process.env.SKILLX_WRITE_STEP_SUMMARY = '1'
    await writeSummaryFiles(rootPath, summary)

    assert.equal(await pathExists(stepSummaryPath), true)
  }
  finally {
    restoreEnvValue('GITHUB_STEP_SUMMARY', previousStepSummary)
    restoreEnvValue('SKILLX_WRITE_STEP_SUMMARY', previousWriteStepSummary)
    await rm(rootPath, { recursive: true, force: true })
  }
})

it('prevents resolved paths from escaping root', () => {
  assert.throws(() => resolveInside('/repo', '..', 'outside'), /escapes root/)
})

it('discovers deeply nested skills in dot-prefixed directories', async () => {
  const sourcePath = await createTempSkillTree({
    '.curated/aspnet-core/SKILL.md': '# ASP.NET Core',
    '.curated/python/SKILL.md': '# Python',
    '.git/hooks/SKILL.md': '# Ignored',
    'plain/SKILL.md': '# Plain',
  })

  try {
    const skills = await discoverSkillDirs(sourcePath)

    assert.deepEqual(skills.map(skill => skill.relativePath), [
      '.curated/aspnet-core',
      '.curated/python',
      'plain',
    ])
  }
  finally {
    await rm(sourcePath, { recursive: true, force: true })
  }
})

it('filters discovered skills with excludes taking precedence', () => {
  const skills = [
    { relativePath: '.curated/aspnet-core' },
    { relativePath: '.curated/python' },
    { relativePath: 'experimental/draft' },
  ]

  const selectedSkills = filterSkillDirs(skills, {
    includes: ['.curated/**', 'experimental/**'],
    excludes: ['.curated/python', '**/draft'],
  })

  assert.deepEqual(selectedSkills.map(skill => skill.relativePath), ['.curated/aspnet-core'])
})

it('plans flat and nested skill targets', () => {
  const skills = [
    { absolutePath: '/repo/skills/.curated/aspnet-core', relativePath: '.curated/aspnet-core' },
    { absolutePath: '/repo/skills/root', relativePath: '.' },
  ]

  const flatTargets = planSkillTargets({ id: 'openai', mode: 'flat' }, skills)
  const nestedTargets = planSkillTargets({ id: 'openai', mode: 'nested' }, skills)

  assert.deepEqual(flatTargets.map(target => target.targetId), [
    'openai-curated-aspnet-core',
    'openai',
  ])
  assert.deepEqual(nestedTargets.map(target => target.targetId), ['openai', 'openai'])
  assert.deepEqual(nestedTargets.map(target => target.nestedPath), ['.curated/aspnet-core', '.'])
})

it('rejects flat target collisions after slugging', () => {
  assert.throws(() => planSkillTargets({ id: 'openai', mode: 'flat' }, [
    { absolutePath: '/repo/skills/.curated/aspnet-core', relativePath: '.curated/aspnet-core' },
    { absolutePath: '/repo/skills/curated/aspnet-core', relativePath: 'curated/aspnet-core' },
  ]), /target collision/)
})

async function createTempSkillTree(files) {
  const rootPath = await mkdtemp(path.join(tmpdir(), 'skillx-test-'))

  await Promise.all(Object.entries(files).map(async ([relativeFilePath, content]) => {
    const absoluteFilePath = path.join(rootPath, ...relativeFilePath.split('/'))
    await mkdir(path.dirname(absoluteFilePath), { recursive: true })
    await writeFile(absoluteFilePath, `${content}\n`, 'utf8')
  }))

  return rootPath
}

async function createGitRepo(repoPath, files = {}) {
  await execFileAsync('git', ['init', '-b', 'main'], { cwd: repoPath })
  await writeFile(path.join(repoPath, 'README.md'), '# Fixture\n', 'utf8')

  await Promise.all(Object.entries(files).map(async ([relativeFilePath, content]) => {
    const absoluteFilePath = path.join(repoPath, ...relativeFilePath.split('/'))
    await mkdir(path.dirname(absoluteFilePath), { recursive: true })
    await writeFile(absoluteFilePath, `${content}\n`, 'utf8')
  }))

  await commitAll(repoPath, 'test fixture')
}

async function commitAll(repoPath, message) {
  await execFileAsync('git', ['add', '-A'], { cwd: repoPath })
  await execFileAsync('git', ['-c', 'user.name=skillx-test', '-c', 'user.email=skillx-test@example.com', 'commit', '-m', message], { cwd: repoPath })
}

async function writeSourceConfig(rootPath, sourceRepoPath) {
  const sourceLocation = pathToFileURL(sourceRepoPath).href

  await writeFile(path.join(rootPath, 'skills-sources.yaml'), [
    'version: 1',
    'defaults:',
    '  sourceConcurrency: 2',
    'sources:',
    '  - id: fixture',
    '    type: remote',
    `    location: ${sourceLocation}`,
    '    branch: main',
    '    path: skills',
    '',
  ].join('\n'), 'utf8')
}

function createSilentLogger() {
  return {
    info() {},
    success() {},
    warn() {},
    error() {},
    debug() {},
    group() {},
    groupEnd() {},
  }
}

function restoreEnvValue(name, value) {
  if (value === undefined) {
    delete process.env[name]
    return
  }

  process.env[name] = value
}
