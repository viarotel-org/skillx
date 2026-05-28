import assert from 'node:assert/strict'
import { it } from 'vitest'
import { ConfigValidationError, validateConfigDocument, validateRelativePath, validateSourceId } from '../scripts/skills-sync/config.mjs'
import { getStaleManagedIds, resolveInside } from '../scripts/skills-sync/fs.mjs'

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
  assert.equal(config.sources[0].enabled, true)
})

it('rejects protected source ids', () => {
  assert.equal(validateSourceId('local', ['local']), 'Source id "local" is protected and cannot be generated.')
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

it('prevents resolved paths from escaping root', () => {
  assert.throws(() => resolveInside('/repo', '..', 'outside'), /escapes root/)
})
