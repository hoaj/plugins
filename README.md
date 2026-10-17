# hoaj/plugins

Plugins for coding agents (**Claude Code**, **GitHub Copilot CLI**, **Cursor**), and the `hoaj` marketplace that lists them. Most are made with [site-cli-creator](https://github.com/hoaj/site-cli-creator): each wraps one website as a small CLI that your agent runs for you, signed in as you, on your own machine. The same binary is also a local MCP server. When the site changes, the plugin notices and, once you agree, files an issue here so it gets fixed.

Browse them at **[agentplugins.dk](https://agentplugins.dk)**.

## Install

Add the marketplace once, then install any plugin from it.

### Claude Code

```
/plugin marketplace add hoaj/plugins
/plugin install logbuy@hoaj
```

### GitHub Copilot CLI

```
copilot plugin marketplace add hoaj/plugins
copilot plugin install logbuy@hoaj
```

### Cursor

Settings → Plugins → Add marketplace → `hoaj/plugins`, then install a plugin. Cursor lists only the plugins in this repo; install site-cli-creator from `hoaj/site-cli-creator` and BankMCP from `noskillish/bankmcp`.

The CLI binaries download over HTTPS from this repo's public releases the first time your agent uses a skill. No GitHub account is needed; the GitHub CLI is only used to report a problem.

## Plugins

| Plugin | Lives in | What it does |
|--------|----------|--------------|
| [logbuy](./plugins/logbuy) | here | Find deals on Visma LogBuy (mylogbuy.com): search products, show a deal, browse categories. Also an MCP server (`logbuy mcp`) |
| [site-cli-creator](https://github.com/hoaj/site-cli-creator) | hoaj/site-cli-creator | The generator: turn the calls a website makes into a plugin like the ones here |
| [bank](https://github.com/noskillish/bankmcp) | noskillish/bankmcp | BankMCP: read-only access to your own bank accounts over PSD2, self-hosted |

## Report a problem

Ask your agent to "report this": each plugin has a `<plugin>-feedback` skill that drafts an issue from the error (shapes only, never your data), shows it to you, and files it here with the plugin's label only when you say yes. Issues per plugin: filter by its label, e.g. [`logbuy`](https://github.com/hoaj/plugins/issues?q=is%3Aopen+label%3Alogbuy).

## Daily drift check

Every morning `.github/workflows/drift-check.yml` installs each CLI skill's released binary and runs its read-only `check` against the live site (never `--writes`). Drift opens an issue titled with the Fingerprint, the same title the plugin's Feedback skill uses, so a user's report and the daily check never file the same Drift twice. A failing check opens a `bug` issue, and an expired CI session opens a `ci-session` issue. Every result is kept in `status.json` on the `status` branch, and [agentplugins.dk](https://agentplugins.dk) shows it as each plugin's status: Stabil, Ustabil or Drift fundet.

A skill with a login is checked only when its session is stored as the repo secret `SESSION_<PLUGIN>_<SKILL>`. After `bin/<skill> login` on your machine:

```sh
gh secret set SESSION_LOGBUY_LOGBUY --repo hoaj/plugins < ~/.logbuy/session.json
```

The secret is the maintainer's own signed-in session. Workflows on `main` can read it, and pull requests from forks cannot. Only store sessions for accounts whose daily read-only use you are fine with. When the session expires, the check opens a `ci-session` issue that says how to renew it.

## Adding a plugin

Generate it with site-cli-creator into `plugins/<plugin>/`. Each plugin owns its code, tests and version and shares nothing with the others:

- `plugins/<plugin>/`: the plugin, with its four manifests, `generated.json`, skills, scripts and tests.
- `.github/workflows/<plugin>-ci.yml` and `<plugin>-release.yml`, filtered to `plugins/<plugin>/**`. Merging a version bump to `main` builds the binaries and publishes the release `<plugin>-vX.Y.Z`.
- A line in each marketplace file (`.claude-plugin/`, `.github/plugin/`, `.cursor-plugin/marketplace.json`) and a row in the table above. The catalog site rebuilds from the marketplace on every merge.
- An issue label named after the plugin.

A plugin from another repo gets a marketplace line only: `git-subdir` (Claude Code) or `github` with `path` (Copilot CLI).

## License

MIT, unless a plugin's folder says otherwise.
