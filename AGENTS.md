# AGENTS.md

This repo is the `hoaj` marketplace for coding-agent plugins and the home of the plugins made with [site-cli-creator](https://github.com/hoaj/site-cli-creator). Each plugin wraps one website as a compiled Bun CLI (also an MCP server) that agents run as the user. Around them: a catalog site and a daily drift check. The generator itself lives in hoaj/site-cli-creator, not here.

Terms (Task, Capture, Operation, Contract, Drift, Fingerprint, Feedback skill) mean exactly what they mean in the generator's [CONTEXT.md](https://github.com/hoaj/site-cli-creator/blob/main/CONTEXT.md).

## Where things are

| Path | What |
|---|---|
| `plugins/<plugin>/` | One plugin, self-contained: manifests, `generated.json`, `skills/` (the CLI skill, `<plugin>-feedback`, `<plugin>-deploy`), `scripts/`, `tests/`, its own `package.json` and version |
| `.claude-plugin/`, `.github/plugin/`, `.cursor-plugin/marketplace.json` | The `hoaj` marketplace, one file per agent host |
| `.github/workflows/<plugin>-ci.yml`, `<plugin>-release.yml` | Per-plugin CI and release, path-filtered to `plugins/<plugin>/**` |
| `site/` | The catalog at https://hoaj.github.io/plugins/, built by `site/build.ts`; `site/DESIGN.md` is its spec |
| `status/check.ts`, `.github/workflows/drift-check.yml` | The daily drift check; history in `status.json` on the `status` branch |

## What to reach for

- **A plugin's code changes** (a Drift or bug issue, a new Task, another site or login, a new plugin): use the `site-cli-creator` skill (install `site-cli-creator@hoaj`). Its modes are `fix`, `add-task`, `add-skill`, and `new --into <this repo>` for a new plugin. Operations, Contracts, commands and `site.ts` are generated and checked against Captures; change them through the skill, with `check --writes` green at the end.
- **A problem in the generator or the Starter code** a plugin was made from: the `site-cli-creator-feedback` skill files it on hoaj/site-cli-creator.
- **The catalog page:** edit `site/DESIGN.md` first when the look or structure changes, then `site/build.ts`. Keep it minimal: colour only in status marks.
- **The drift check or a CI session expiring:** `status/check.ts` and the README's "Daily drift check" section.
- **Listing an external plugin:** add it to all three marketplace files. Claude Code needs the full HTTPS URL (`url`, or `git-subdir` with a `path`); the `owner/repo` shorthand clones over SSH and fails for most users.

## Rules the code does not show

- **Plugins share nothing.** Never import across `plugins/`; each plugin owns every file the generator copied into it.
- **Every change under `plugins/<plugin>/` bumps that plugin's version** with `bun run bump <patch|minor|major>` in its folder. CI fails a PR whose version is not above `main`'s. Merging to `main` builds the five binaries and publishes `<plugin>-vX.Y.Z` (never the repo's "Latest").
- **Tags, labels and issues carry the plugin's name:** tags `<plugin>-vX.Y.Z`, labels `<plugin>` and `fixed-in:<plugin>-vX.Y.Z`. A Drift issue's title is the Fingerprint, exactly, so the Feedback skill and the daily check never file the same Drift twice.
- **Shapes, never values.** No real site data in the repo, issues or PRs: no names, ids, amounts, tokens, cookies or sessions. CI sessions live only in the secrets `SESSION_<PLUGIN>_<SKILL>`, set by the maintainer.
- **Read-only against live sites.** The daily check runs `check` without `--writes`; tests use fakes.

## Checks

Run each plugin's tests in its own folder (`cd plugins/<plugin> && bun install --frozen-lockfile && bun test`); a `bun test` at the root picks up every plugin's tests without their dependencies. The site and drift check: `bun test ./site ./status` from the root (the `./` keeps `site` from matching a plugin's `site.test.ts`). Lint workflows with `actionlint`.
