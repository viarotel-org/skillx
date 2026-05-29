# AGENTS.md

## Project Snapshot

`skillx` is a Node.js ESM repository for maintaining local AI agent skills and syncing subscribed remote skills into `skills/`. Link to [README.md](README.md) for the full sync flow, config reference, generated files, GitHub Actions, and contribution notes.

## Commands

- Install with `pnpm install`; this repo targets Node.js `>=20` and pnpm `10.32.1`.
- Run `pnpm validate` after editing [skills-sources.yaml](skills-sources.yaml).
- Run `pnpm test` for sync behavior changes.
- Run `pnpm lint` before finalizing JavaScript or Markdown changes.
- Use `pnpm sync:dry-run` when changing source filters, paths, modes, or ids. It still clones remote repositories, so expect network dependency and slower runs.
- Run `pnpm sync` only when you intentionally want to update generated skills and `.skills-sync` metadata.

## Architecture Map

- [scripts/sync-skills.mjs](scripts/sync-skills.mjs): main sync orchestrator and CLI argument handling.
- [scripts/validate-skills-config.mjs](scripts/validate-skills-config.mjs): validation CLI for the YAML source list.
- [scripts/skills-sync/config.mjs](scripts/skills-sync/config.mjs): config loading, defaults, source id validation, protected id validation, and safe relative path checks.
- [scripts/skills-sync/fs.mjs](scripts/skills-sync/fs.mjs): `SKILL.md` discovery, glob filtering, flat/nested target planning, manifest reads/writes, safe filesystem operations, and generated directory cleanup.
- [scripts/skills-sync/git.mjs](scripts/skills-sync/git.mjs): clone and commit helpers plus Git error classification.
- [scripts/skills-sync/summary.mjs](scripts/skills-sync/summary.mjs): `.skills-sync/summary.*` output.
- [tests/skills-sync.test.mjs](tests/skills-sync.test.mjs): Vitest coverage for config validation, path safety, discovery, filtering, planning, and cleanup behavior.

## Project Conventions

- Keep source ids and generated directory ids lowercase kebab-case.
- Source ids do not need `local-` or `remote-` prefixes; use `type: local|remote` and `location` in [skills-sources.yaml](skills-sources.yaml) to express where content comes from.
- Keep hand-maintained local source inputs under `skillx/<name>/`; subscribe to them through the single local `skillx` source and write generated copies to `skills/skillx-*`.
- Do not hand-edit generated skill directories. Change the local source directory, upstream repository, or subscription filters instead.
- Treat `.skills-sync/manifest.json` as the cleanup contract for generated directories. Unknown or protected skill directories should be left untouched.
- Preserve path traversal defenses: config paths and filters must remain relative, use forward slashes, and avoid `.` or `..` segments except the source path value `.`.
- `includes` and `excludes` are relative skill path globs; excludes take precedence over includes.
- `cloneTimeoutMs` and `cloneMaxAttempts` can be set in defaults or per source to tune Git clone resilience.
- `sourceConcurrency` controls how many enabled sources are planned concurrently before generated directories are written.
- This repository configures `mode: flat` by default; upstream removals should be reflected by stale generated target cleanup on the next sync.
- `preserveOnFailure` defaults to `false`; only set it to `true` when intentionally keeping previous generated output for failed sources.
- Symlinks from subscribed sources are skipped during copy and reported in `.skills-sync/summary.*`.
- `mode: flat` slugs discovered skill paths into separate target ids and must fail on collisions; `mode: nested` keeps selected skills grouped under the source id.
- ESLint should ignore generated skill outputs; do not use generated directories as a place for source changes.

## When Editing

- Prefer focused changes in the existing module boundary instead of moving sync responsibilities across files.
- Add or update tests in [tests/skills-sync.test.mjs](tests/skills-sync.test.mjs) for behavior changes in config parsing, discovery, filtering, target planning, manifest handling, or cleanup.
- Validate YAML changes with `pnpm validate` before running sync commands.
- The sync workflow runs on manual dispatch and on pushes to `main` that change `skills-sources.yaml` or files under `skillx/`, runs `pnpm test` and `pnpm lint`, commits generated sync changes with `chore: sync skills subscriptions`, and only runs release-please when the sync step actually changed generated output.
- Avoid duplicating README content here; link to [README.md](README.md) for details that are already documented.