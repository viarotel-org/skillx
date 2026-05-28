# skillx

[![Sync Skills](https://github.com/viarotel/skillx/actions/workflows/sync-skills.yml/badge.svg)](https://github.com/viarotel/skillx/actions/workflows/sync-skills.yml)
[![Release](https://github.com/viarotel/skillx/actions/workflows/release.yml/badge.svg)](https://github.com/viarotel/skillx/actions/workflows/release.yml)

A predictable hub for local and subscribed AI agent skills.

`skillx` keeps hand-maintained local skills and subscribed remote skills in one repository. It validates a YAML source list, clones configured repositories, discovers every directory containing `SKILL.md`, filters the discovered skills, then writes managed copies into `skills/` with a manifest and run summary.

## Features

- Local skill storage under protected directory ids such as `local-*`.
- Remote skill subscriptions from Git repositories.
- Recursive `SKILL.md` discovery, including dot-prefixed directories such as `.curated/`.
- `flat` and `nested` output modes for generated skill directories.
- Include and exclude glob filters per source.
- Conservative cleanup based on `.skills-sync/manifest.json`.
- Dry-run support for validating clones, filters, and target paths before writing generated skills.
- GitHub Actions automation for scheduled skill sync and release automation.

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

The sync process plans all enabled sources before writing generated output, then commits planned copies into `skills/`. It removes only generated directories that were previously recorded in the manifest and are no longer active. Unknown directories and protected ids are left untouched. Symlinks from subscribed repositories are skipped and reported in the sync summary instead of being copied into generated skills.

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

protectedIds:
  - 'local-*'

sources:
  - id: remote-openai
    url: https://github.com/openai/skills.git
    branch: main
    path: skills
```

### Source Fields

| Field | Required | Description |
| --- | --- | --- |
| `id` | Yes | Source id. Must use lowercase kebab-case letters and numbers, and must not match a protected id. |
| `url` | Yes | Git repository URL passed to `git clone`. |
| `branch` | No | Branch to clone. Defaults to `main`. |
| `path` | No | Directory inside the source repository that contains skills. Defaults to `skills`. Use `.` for repository root. |
| `mode` | No | `flat` writes each discovered skill as its own generated directory. `nested` keeps skills grouped under `skills/<source-id>/`. |
| `enabled` | No | Disabled sources are skipped. Defaults to `true`. |
| `preserveOnFailure` | No | Keeps the previous manifest entry and generated targets when a source fails. Defaults to `false`, so stale generated skills are removed unless preservation is explicitly enabled. |
| `cloneTimeoutMs` | No | Git clone timeout in milliseconds. Defaults to `300000`. |
| `cloneMaxAttempts` | No | Maximum clone attempts for retryable Git failures. Defaults to `3`. |
| `sourceConcurrency` | No | Maximum number of sources planned concurrently. Defaults to `3`. |
| `includes` | No | Relative glob patterns for selected skill paths. Empty means include all discovered skills. |
| `excludes` | No | Relative glob patterns to remove from the selected set. Excludes take precedence over includes. |

### Output Modes

This repository uses `flat` as its configured default in `skills-sources.yaml`, so generated skill paths are source-of-truth snapshots of the subscribed repositories. Skills removed upstream are removed from generated output on the next successful sync.

In `flat` mode, discovered skill paths are slugged into separate target ids:

```txt
remote-openai + .curated/aspnet-core -> skills/remote-openai-curated-aspnet-core
remote-openai + .                    -> skills/remote-openai
```

In `nested` mode, all selected skills stay under the source id:

```txt
remote-openai + .curated/aspnet-core -> skills/remote-openai/.curated/aspnet-core
remote-openai + .                    -> skills/remote-openai
```

Flat mode checks for generated target collisions after slugging and fails fast when two source paths would map to the same target id.

### Protected Local Skills

The validator always includes default protected ids for `local-*` and `subscribe`, and this repository explicitly protects `local-*`. Use that pattern for hand-maintained skills:

```txt
skills/
  local-escrcpy/
    SKILL.md
  local-viarotel/
    SKILL.md
```

Protected directories are not removed as stale generated output, and source ids matching those patterns are rejected.

## Project Structure

```txt
.
├── .github/workflows/       # Scheduled sync and release automation
├── .skills-sync/            # Generated manifest, summaries, and temporary sync workspace
├── scripts/
│   ├── sync-skills.mjs      # Main sync command
│   ├── validate-skills-config.mjs
│   └── skills-sync/         # Config, filesystem, git, logging, and summary helpers
├── skills/                  # Local and generated skills
├── tests/                   # Vitest coverage for config and sync planning logic
├── skills-sources.yaml      # Subscription source list
├── release-please-config.json
└── package.json
```

## Generated Files

`pnpm sync` writes these generated files:

- `.skills-sync/manifest.json`: managed source metadata, commits, target ids, and selected skill paths.
- `.skills-sync/summary.md`: human-readable sync report.
- `.skills-sync/summary.json`: machine-readable sync report.

Temporary clone and staging data is created under `.skills-sync/tmp/` and cleaned after each run unless `--keep-temp` is used.

## Commands

| Command | Description |
| --- | --- |
| `pnpm validate` | Validate `skills-sources.yaml`. |
| `pnpm sync:dry-run` | Clone enabled sources and validate the sync plan without changing generated skill directories or the manifest. |
| `pnpm sync` | Sync enabled sources into `skills/` and write generated metadata. |
| `pnpm test` | Run the Vitest test suite. |
| `pnpm lint` | Run ESLint. Remote generated skills are ignored by lint config. |
| `pnpm lint:fix` | Run ESLint with automatic fixes. |

Additional sync options are available through the script:

```sh
pnpm sync -- --config ./skills-sources.yaml --verbose
pnpm sync -- --dry-run --keep-temp
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
- Stale generated directory detection.
- Unknown directory reporting.
- Path traversal prevention.

Run it with:

```sh
pnpm test
```

## GitHub Actions

### Sync Skills

`.github/workflows/sync-skills.yml` runs manually and on the daily UTC cron schedule `17 3 * * *`. It installs dependencies, validates the source config, runs tests and linting, runs `pnpm sync`, uploads the sync summary artifact, and commits changed `skills/` content plus `.skills-sync/manifest.json` back to the default branch.

When a sync changes tracked generated output, the workflow also runs release-please so release metadata can follow the subscription update. The standalone release workflow continues to handle normal pushes and manual release runs.

### Release

`.github/workflows/release.yml` runs release-please on pushes to `main` and on manual dispatch. Release behavior is configured in `release-please-config.json` for the Node package at the repository root.

## Contributing

1. Keep local skills under protected ids such as `skills/local-<name>/`.
2. Add or modify remote subscriptions in `skills-sources.yaml`.
3. Run `pnpm validate` before syncing.
4. Use `pnpm sync:dry-run` when changing filters, paths, modes, or source ids.
5. Run `pnpm test` for changes to sync behavior.
6. Run `pnpm lint` before opening a pull request or pushing shared changes.

Source ids and generated directory names should stay lowercase kebab-case. Avoid editing generated remote skill directories by hand; update the source repository or the subscription filters instead.

## License

Apache-2.0. See `LICENSE` for details.