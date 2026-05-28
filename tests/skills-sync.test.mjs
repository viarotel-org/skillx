import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { it } from 'vitest'
import { ConfigValidationError, validateConfigDocument, validateRelativePath, validateSourceId } from '../scripts/skills-sync/config.mjs'
import {
  acquireSyncLock,
  discoverSkillDirs,
  filterSkillDirs,
  getStaleManagedIds,
  listUnknownSkillDirs,
  pathExists,
  planSkillTargets,
  readManifest,
  resolveInside,
} from '../scripts/skills-sync/fs.mjs'

const execFileAsync = promisify(execFile)

it('validates a minimal skills source config', () => {
  const config = validateConfigDocument({
    version: 1,
    sources: [
      {
        id: 'anthropic',
        url: 'https://github.com/anthropics/skills.git',
      },
    ],
  })

  assert.equal(config.sources.length, 1)
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
        url: 'https://github.com/openai/skills.git',
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
        url: 'https://github.com/openai/skills.git',
      },
    ],
  }), ConfigValidationError)

  assert.throws(() => validateConfigDocument({
    version: 1,
    sources: [
      {
        id: 'openai',
        url: 'https://github.com/openai/skills.git',
        cloneTimeoutMs: 1.5,
        cloneMaxAttempts: 'three',
      },
    ],
  }), ConfigValidationError)
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
        url: 'https://github.com/openai/skills.git',
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
        url: 'https://github.com/openai/skills.git',
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
  assert.equal(validateSourceId('local-escrcpy', ['local-*']), 'Source id "local-escrcpy" is protected and cannot be generated.')
})

it('validates protected id patterns in config', () => {
  const config = validateConfigDocument({
    version: 1,
    protectedIds: ['local-*'],
    sources: [
      {
        id: 'remote-openai',
        url: 'https://github.com/openai/skills.git',
      },
    ],
  })

  assert.ok(config.protectedIds.includes('local-*'))
})

it('rejects unsafe protected id patterns in config', () => {
  assert.throws(() => validateConfigDocument({
    version: 1,
    protectedIds: ['local/**'],
    sources: [
      {
        id: 'remote-openai',
        url: 'https://github.com/openai/skills.git',
      },
    ],
  }), ConfigValidationError)

  assert.throws(() => validateConfigDocument({
    version: 1,
    protectedIds: ['*'],
    sources: [
      {
        id: 'remote-openai',
        url: 'https://github.com/openai/skills.git',
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
        url: 'https://github.com/openai/skills.git',
      },
      {
        id: 'openai',
        url: 'https://github.com/example/skills.git',
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
      'local': {
        targets: ['local-escrcpy', 'local-viarotel'],
      },
      'remote-openai': {
        targets: ['remote-openai-imagegen'],
      },
    },
  }, [], ['local-*'])

  assert.deepEqual(staleManagedIds, ['remote-openai-imagegen'])
})

it('does not report unknown skill dirs matching protected patterns', async () => {
  const rootPath = await mkdtemp(path.join(tmpdir(), 'skillx-test-'))

  try {
    await mkdir(path.join(rootPath, 'skills', 'local-escrcpy'), { recursive: true })
    await mkdir(path.join(rootPath, 'skills', 'local-viarotel'), { recursive: true })
    await mkdir(path.join(rootPath, 'skills', 'remote-old'), { recursive: true })

    const unknownSkillDirs = await listUnknownSkillDirs(rootPath, [], ['local-*'])

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
    await writeFile(path.join(rootPath, 'skills-sources.yaml'), [
      'version: 1',
      'sources:',
      '  - id: remote-fixture',
      `    url: ${sourceRepoPath}`,
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

  const flatTargets = planSkillTargets({ id: 'remote-openai', mode: 'flat' }, skills)
  const nestedTargets = planSkillTargets({ id: 'remote-openai', mode: 'nested' }, skills)

  assert.deepEqual(flatTargets.map(target => target.targetId), [
    'remote-openai-curated-aspnet-core',
    'remote-openai',
  ])
  assert.deepEqual(nestedTargets.map(target => target.targetId), ['remote-openai', 'remote-openai'])
  assert.deepEqual(nestedTargets.map(target => target.nestedPath), ['.curated/aspnet-core', '.'])
})

it('rejects flat target collisions after slugging', () => {
  assert.throws(() => planSkillTargets({ id: 'remote-openai', mode: 'flat' }, [
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

async function createGitRepo(repoPath) {
  await execFileAsync('git', ['init', '-b', 'main'], { cwd: repoPath })
  await writeFile(path.join(repoPath, 'README.md'), '# Fixture\n', 'utf8')
  await execFileAsync('git', ['add', 'README.md'], { cwd: repoPath })
  await execFileAsync('git', ['-c', 'user.name=skillx-test', '-c', 'user.email=skillx-test@example.com', 'commit', '-m', 'test fixture'], { cwd: repoPath })
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
