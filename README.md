# Skills

A predictable hub for local and subscribed AI agent skills.

## Directory Layout

```txt
skills/
  local/          # Local skills maintained in this repository. Never overwritten.
  anthropic/      # Generated from the anthropic source.
  openai/         # Generated from the openai source.
  ...
```

`skills/local` is protected. The sync script never removes or overwrites it.

`skills/subscribe` is no longer used. Remote sources are synced into `skills/<id>` instead, which avoids cross-repository skill name conflicts by design.

## Configure Sources

Edit [config/skills-sources.yaml](config/skills-sources.yaml) to add or disable sources.

```yaml
sources:
  - id: example
    url: https://github.com/example/skills.git
    branch: main
    path: skills
    enabled: true
```

Fields:

- `id`: Required. Generates `skills/<id>`. Must use kebab-case and must not be `local` or `subscribe`.
- `url`: Required. Git repository URL.
- `branch`: Optional. Defaults to `main`.
- `path`: Optional. Directory inside the remote repository that contains skills. Defaults to `skills`. Use `.` when the repository root is the skills directory.
- `enabled`: Optional. Defaults to `true`.
- `preserveOnFailure`: Optional. Defaults to `true`, so a temporary network or clone failure does not delete the last synced copy.

## Local Usage

Install dependencies:

```sh
pnpm install
```

Validate the configuration:

```sh
pnpm validate
```

Preview a sync without changing generated directories:

```sh
pnpm sync:dry-run
```

Run a real sync:

```sh
pnpm sync
```

The sync process writes a run summary to `.skills-sync/summary.md` and records managed generated directories in `.skills-sync/manifest.json`.

## Cleanup Safety

The sync script is intentionally conservative:

- It only removes generated directories that were previously recorded in `.skills-sync/manifest.json` and are no longer present in the config.
- It never removes protected ids from `protectedIds`.
- If no manifest exists, unknown directories under `skills/` are left untouched and reported in the logs.
- A single source failure does not stop the remaining sources from syncing.

## GitHub Actions

[.github/workflows/sync-skills.yml](.github/workflows/sync-skills.yml) supports:

- Manual runs with `workflow_dispatch`.
- Scheduled runs every day at 03:17 Asia/Shanghai time.
- Automatic creation or update of a `chore/sync-skills` pull request when generated skills change.

The workflow uses minimal token permissions:

- `contents: write` to push the sync branch.
- `pull-requests: write` to create or update the PR.

## Conflict Handling

Earlier aggregate-directory designs needed `overwrite`, `skip`, or `rename` for same-name skills. This repository uses source namespaces instead:

```txt
skills/anthropic/same-skill-name
skills/openai/same-skill-name
```

That keeps each source isolated and makes sync results deterministic. Configuration conflicts such as duplicate ids, protected ids, or unsafe paths fail validation before any sync work starts.