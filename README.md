# skillx

[![Sync Skills](https://github.com/viarotel/skillx/actions/workflows/sync-skills.yml/badge.svg)](https://github.com/viarotel/skillx/actions/workflows/sync-skills.yml)

A predictable hub for local and subscribed AI agent skills.

`skillx` keeps hand-maintained local skills and subscribed remote skills in one repository. It validates a YAML source list, clones configured repositories, discovers every directory containing `SKILL.md`, filters the discovered skills, then writes managed copies into `skills/` with a manifest and run summary.

## Features

- Local skill storage can be subscribed from repository-relative directories.
- Remote skill subscriptions from Git repositories.
- Recursive `SKILL.md` discovery, including dot-prefixed directories such as `.curated/`.
- `flat` and `nested` output modes for generated skill directories.
- Include and exclude glob filters per source.
- Optional content-hash deduplication across sources, with source order deciding the winner.
- Conservative cleanup based on `.skills-sync/manifest.json`.
- Dry-run support for validating clones, filters, and target paths before writing generated skills.
- Symlink sync from `skills/` into one or more agent runtime directories for multi-environment reuse.
- GitHub Actions automation for post-commit skill sync and release automation.

## Tech Stack

- Node.js `>=20`
- pnpm `10.32.1`
- ECMAScript modules
- YAML parsing with `yaml`
- Glob matching with `minimatch`
- Testing with Vitest
- Linting with ESLint and `@antfu/eslint-config`
- Release automation with release-please

## How It Works

```txt
skills-sources.yaml
        |
        v
scripts/sync-skills.mjs
        |
    +-- clone enabled sources into .skills-sync/tmp/ with bounded concurrency
        +-- discover directories containing SKILL.md
        +-- apply includes/excludes filters
        +-- plan generated targets with flat or nested mode
    +-- stage planned copies and skip symlinks by default
        +-- atomically replace managed directories in skills/
        +-- write .skills-sync/manifest.json and run summaries
```

      ```txt
      skills/
        |
        v
      scripts/link-skills.mjs
        |
          +-- scan top-level generated skills once
        +-- build one task per skill and target directory
        +-- process the queue with bounded concurrency
        +-- create, skip, warn, or repair symlinks independently
      ```

The sync process plans all enabled sources before writing generated output, then commits planned copies into `skills/`. It removes only generated directories that were previously recorded in the manifest and are no longer active. Unknown directories and protected ids are left untouched. Symlinks from subscribed repositories are skipped and reported in the sync summary instead of being copied into generated skills.

      The link process never copies skill content. It creates `<target>/<skill-name> -> <repo>/skills/<skill-name>` directory symlinks for top-level generated skills so multiple agent runtimes can reuse the same generated skill set.

## Getting Started

Install dependencies:

```sh
pnpm install
```

Validate the subscription configuration:

```sh
pnpm validate
```

Preview a sync without changing generated skill directories:

```sh
pnpm sync:dry-run
```

Run a real sync:

```sh
pnpm sync
```

Link generated skills into agent runtime directories:

```sh
pnpm run sync:link -- --targets ~/.agents/skills,../other-agents/skills
```

Run tests and linting:

```sh
pnpm test
pnpm lint
```

`pnpm sync:dry-run` still clones remote repositories, so it requires network access and may take longer than pure local validation.

## Configuration

Skill subscriptions are configured in `skills-sources.yaml`.

```yaml
version: 1

defaults:
  branch: main
  path: skills
  mode: flat
  enabled: true
  preserveOnFailure: false
  cloneTimeoutMs: 300000
  cloneMaxAttempts: 3
  sourceConcurrency: 3
  includes: []
  excludes: []

deduplicate: true

sources:
  - id: skillx
    type: local
    location: skillx
    path: .

  - id: openai
    type: remote
    location: https://github.com/openai/skills.git
    branch: main
    path: skills
```

### Deduplicate

`deduplicate` is a top-level switch that removes duplicate skills across all configured sources.

```yaml
deduplicate: true
```

Or the explicit object form:

```yaml
deduplicate:
  enabled: true
  strategy: content-hash
```

Rules:

- Deduplication is disabled by default for backward compatibility.
- Only the bytes of `SKILL.md` are compared.
- Names, source ids, directory paths, and generated target ids do not affect duplicate detection.
- Source priority follows the `sources` array order in `skills-sources.yaml`.
- When two skills have identical `SKILL.md` content, the first source wins and later duplicates are skipped.
- When deduplication is disabled, behavior is unchanged and all selected skills are generated.

### Source Fields

| Field | Required | Description |
| --- | --- | --- |
| `id` | Yes | Source id. Must use lowercase kebab-case letters and numbers, and must not match a protected id. |
| `type` | No | Source type, either `remote` or `local`. Defaults to `remote`. |
| `location` | Yes | For `remote`, a Git URL passed to `git clone`. For `local`, a repository-relative source directory. |
| `branch` | No | Branch to clone for remote sources. Defaults to `main`. Ignored by local sources. |
| `path` | No | Directory inside the source location that contains skills. Defaults to `skills`. Use `.` when the source location itself is a skill root. |
| `mode` | No | `flat` writes each discovered skill as its own generated directory. `nested` keeps skills grouped under `skills/<source-id>/`. |
| `enabled` | No | Disabled sources are skipped. Defaults to `true`. |
| `preserveOnFailure` | No | Keeps the previous manifest entry and generated targets when a source fails. Defaults to `false`, so stale generated skills are removed unless preservation is explicitly enabled. |
| `cloneTimeoutMs` | No | Git clone timeout in milliseconds. Defaults to `300000`. |
| `cloneMaxAttempts` | No | Maximum clone attempts for retryable Git failures. Defaults to `3`. |
| `sourceConcurrency` | No | Maximum number of sources planned concurrently. Defaults to `3`. |
| `includes` | No | Relative glob patterns for selected skill paths. Empty means include all discovered skills. |
| `excludes` | No | Relative glob patterns to remove from the selected set. Excludes take precedence over includes. |

Top-level fields:

| Field | Required | Description |
| --- | --- | --- |
| `deduplicate` | No | Global deduplication config. Accepts `true`, `false`, or `{ enabled, strategy }`. The only supported strategy is `content-hash`. |

### Link Targets

`pnpm run sync:link` scans top-level generated directories in `skills/` once and links every skill into one or more target directories. Each operation is independent, so a failure in one target does not roll back or block the others.

Target resolution priority:

1. `--targets <paths>` CLI option.
2. `AGENTS_DIRS` environment variable.
3. `agents.config.ts`, `agents.config.js`, or `agents.config.json` in the repository root.
4. `$HOME/.agents`.

Targets can be comma-separated strings or string arrays. `~` expands to the current home directory, relative paths resolve from the repository root, and duplicate absolute paths are removed.

```js
// agents.config.js
export default {
  link: {
    targets: ['~/.agents/skills', '../other-agents/skills'],
    concurrency: 48,
  },
}
```

The config may also use top-level `targets` and `concurrency`; nested `link` values take precedence when present. Link concurrency defaults to `48` and must be an integer from `1` to `64`.

Link behavior is idempotent:

- Existing correct symlinks are skipped.
- Missing symlinks are created.
- Existing wrong symlinks are repaired only with `--force`; otherwise they are reported as warnings.
- Existing non-symlink paths are never overwritten, even with `--force`.
- `--dry-run` reports planned creates or repairs without changing the filesystem.

macOS and Linux create directory symlinks directly. On Windows, the command attempts a real directory symlink and reports a clear error if Developer Mode or administrator privileges are required; it does not silently fall back to copying.

### Output Modes

This repository uses `flat` as its configured default in `skills-sources.yaml`, so generated skill paths are source-of-truth snapshots of the subscribed repositories. Skills removed upstream are removed from generated output on the next successful sync.

In `flat` mode, discovered skill paths are slugged into separate target ids:

```txt
openai + .curated/aspnet-core -> skills/openai-curated-aspnet-core
openai + .                    -> skills/openai
```

In `nested` mode, all selected skills stay under the source id:

```txt
openai + .curated/aspnet-core -> skills/openai/.curated/aspnet-core
openai + .                    -> skills/openai
```

Flat mode checks for generated target collisions after slugging and fails fast when two source paths would map to the same target id.

When deduplication is enabled, flat or nested mode keeps only the first skill whose `SKILL.md` content hash appears in the configured source order.

### Local Sources And Protected Inputs

Source ids no longer need `local-` or `remote-` prefixes. Use `type` to describe where a source comes from, and keep directory names focused on the skill collection name. This repository keeps hand-maintained local source inputs under `skillx/` and subscribes to that whole tree as a single local source. Generated output still goes to `skills/`:

```txt
skillx/
  escrcpy/
    SKILL.md
  viarotel/
    SKILL.md

skills/
  skillx-escrcpy/
    SKILL.md
  skillx-viarotel/
    SKILL.md
```

The validator always includes the default protected id `subscribe`. Additional `protectedIds` can be configured for generated directories that must never be removed as stale output, and source ids matching those patterns are rejected.

## Project Structure

```txt
.
├── .github/workflows/       # Unified sync and release automation
├── .skills-sync/            # Generated manifest, summaries, and temporary sync workspace
├── scripts/
│   ├── link-skills.mjs      # Symlink generated skills into agent runtime directories
│   ├── sync-skills.mjs      # Main sync command
│   ├── validate-skills-config.mjs
│   └── skills-sync/         # Config, filesystem, git, logging, and summary helpers
├── skillx/                  # Hand-maintained local source inputs
├── skills/                  # Generated skill outputs
├── tests/                   # Vitest coverage for config and sync planning logic
├── skills-sources.yaml      # Subscription source list
├── release-please-config.json
└── package.json
```

## Generated Files

`pnpm sync` writes these generated files:

- `.skills-sync/manifest.json`: managed source metadata, commits, target ids, selected skill paths, and per-skill content hashes for deduplication and preserved-source recovery.
- `.skills-sync/summary.md`: human-readable sync report.
- `.skills-sync/summary.json`: machine-readable sync report.

Temporary clone and staging data is created under `.skills-sync/tmp/` and cleaned after each run unless `--keep-temp` is used.

## Commands

| Command | Description |
| --- | --- |
| `pnpm validate` | Validate `skills-sources.yaml`. |
| `pnpm sync:dry-run` | Clone enabled sources and validate the sync plan without changing generated skill directories or the manifest. |
| `pnpm sync` | Sync enabled sources into `skills/` and write generated metadata. |
| `pnpm run sync:link` | Link every top-level generated skill under `skills/` into one or more agent runtime directories. |
| `pnpm test` | Run the Vitest test suite. |
| `pnpm lint` | Run ESLint. Remote generated skills are ignored by lint config. |
| `pnpm lint:fix` | Run ESLint with automatic fixes. |

Additional sync options are available through the script:

```sh
pnpm sync -- --config ./skills-sources.yaml --verbose
pnpm sync -- --dry-run --keep-temp
pnpm run sync:link -- --dry-run --targets ~/.agents/skills --verbose
pnpm run sync:link -- --targets ~/.agents/skills,../other-agents/skills --force
```

`validate-skills-config.mjs` supports `--config` for validating an alternate YAML file.

## Testing

The test suite focuses on the sync contract:

- Config defaults and validation errors.
- Source id and protected id validation.
- Safe relative path validation.
- Recursive skill discovery.
- Include and exclude filtering.
- Flat and nested target planning.
- Content-hash deduplication, disabled behavior parity, and preserved-source dedup recovery.
- Link target resolution, idempotent symlink handling, forced repair, and target-level failure isolation.
- Stale generated directory detection.
- Unknown directory reporting.
- Path traversal prevention.

Run it with:

```sh
pnpm test
```

## GitHub Actions

### Sync Skills

`.github/workflows/sync-skills.yml` runs on manual dispatch and on pushes to `main` that touch `skills-sources.yaml` or files under `skillx/`. It installs dependencies, validates the source config, runs tests and linting, runs `pnpm sync`, uploads the sync summary artifact, and commits changed `skills/` content plus `.skills-sync/manifest.json` back to the default branch.

After a successful sync job, the same workflow runs release-please only when `pnpm sync` actually changed `skills/` content or `.skills-sync/manifest.json`. Generated-only sync commits still do not retrigger the workflow because the push trigger is limited to `skills-sources.yaml` and `skillx/**`. Sync commits use `chore: sync skills subscriptions`, and release behavior is configured in `release-please-config.json` so those chore commits still create or update the release PR, changelog, and tag flow for the root Node package.

## Contributing

1. Keep hand-maintained local source inputs under `skillx/<name>/`; generated copies are written to `skills/`.
2. Add or modify local and remote subscriptions in `skills-sources.yaml` with `type` and `location`.
3. Run `pnpm validate` before syncing.
4. Use `pnpm sync:dry-run` when changing filters, paths, modes, or source ids.
5. Run `pnpm test` for changes to sync behavior.
6. Run `pnpm lint` before opening a pull request or pushing shared changes.

Source ids and generated directory names should stay lowercase kebab-case. Avoid editing generated skill directories by hand; update the local source directory, source repository, or subscription filters instead.

## License

Apache-2.0. See `LICENSE` for details.