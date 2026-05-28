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
- Keep hand-maintained skills under protected ids such as `skills/local-<name>/`; `local-*` is protected in [skills-sources.yaml](skills-sources.yaml).
- Do not hand-edit generated remote skill directories (`skills/remote-*/**`). Change the upstream source or subscription filters instead.
- Treat `.skills-sync/manifest.json` as the cleanup contract for generated directories. Unknown or protected skill directories should be left untouched.
- Preserve path traversal defenses: config paths and filters must remain relative, use forward slashes, and avoid `.` or `..` segments except the source path value `.`.
- `includes` and `excludes` are relative skill path globs; excludes take precedence over includes.
- `mode: flat` slugs discovered skill paths into separate target ids and must fail on collisions; `mode: nested` keeps selected skills grouped under the source id.
- ESLint ignores `skills/remote-*/**`; do not use that as a place for source changes.

## When Editing

- Prefer focused changes in the existing module boundary instead of moving sync responsibilities across files.
- Add or update tests in [tests/skills-sync.test.mjs](tests/skills-sync.test.mjs) for behavior changes in config parsing, discovery, filtering, target planning, manifest handling, or cleanup.
- Validate YAML changes with `pnpm validate` before running sync commands.
- Avoid duplicating README content here; link to [README.md](README.md) for details that are already documented.