# Catalog site: design

The catalog of the plugins in this repo, served by GitHub Pages at **https://hoaj.github.io/plugins/** (later agentplugins.dk). `site/build.ts` renders it from the marketplace files, each plugin's manifest and SKILL.md, the optional `site/extra.json` and the daily drift check's `status.json`.

## Principles

- **Minimal.** Black, white and greys. No accent colour. Colour appears in exactly one place: the small status marks (green, amber, red), because there it carries meaning.
- **Show, don't tell.** One picture explains the idea: an agent conversation in which a question becomes a plugin command and an answer. Everything else is short labels, not paragraphs. No sentence on the page is longer than about 15 words; no block of prose has more than two sentences.
- **Details on demand.** Commands, other clients and MCP setup sit in collapsed `<details>`; the page at rest shows name, one line, status and one install command.
- **Only this repo's plugins** are listed (marketplace entries with a `./plugins/...` source). Today: logbuy. The generator appears once, as a link in the footer row.
- **Danish** for the page's own words; plugin descriptions and command summaries stay as their source writes them.

## Page, top to bottom

1. **Header:** wordmark `hoaj/plugins` (mono, 15px) linking to `./`; "GitHub" link on the right. Thin bottom hairline. Not sticky.
2. **Hero** (two columns ≥ 900px, stacked below):
   - Left: headline "Din AI-agent, på dine websites." (one line on desktop if it fits, ≤ 2 lines). Under it one muted line: "Plugins til Claude Code, Copilot CLI og Cursor." Then the install command block (`/plugin marketplace add hoaj/plugins`) with a copy button, nothing else.
   - Right: **the visual** (below).
3. **Plugins** — a small mono label "Plugins · 1", then one card per plugin.
4. **Three facts** in one row (stacked on phones), each an inline SVG line icon (24px, 1.5px stroke, `currentColor`) plus at most five words:
   - lock icon: "Login bliver hos dig"
   - shapes icon: "Kun former, aldrig data"
   - check-in-circle icon: "Rapporterer kun med dit ja"
5. **Footer row:** left "Mangler et website? **Foreslå det** · **Lav dit eget**" (links: `https://github.com/hoaj/plugins/issues/new?labels=site-request&title=Site-%C3%B8nske%3A%20` and `https://github.com/hoaj/site-cli-creator`); right "MIT · GitHub". A second, smaller muted line: "Brug kun plugins på dine egne konti."

## The visual (hero, right column)

A static, pure-HTML/CSS illustration of a terminal-style agent session, inside a rounded panel (`--panel` background, 1px `--line` border, 12px radius, no shadow). Monospace, 13–14px. Three rows, each with a fixed-width left gutter label in `--faint`:

```
du       Er der LogBuy-rabat på høretelefoner?
agent    ▸ logbuy deal search "høretelefoner"
         ┌──────────────────────────────┐
         │ ███████████      ██ %       │   ← skeleton rows: grey bars, no real data
         │ ████████         ███ %      │
         │ █████████████    ██ %       │
         └──────────────────────────────┘
agent    3 tilbud fundet.
```

- The three texts come from the first listed plugin's `demo` in `site/extra.json`: `{ "prompt": "Er der LogBuy-rabat på høretelefoner?", "command": "logbuy deal search \"høretelefoner\"", "answer": "3 tilbud fundet." }`. Without a `demo`, the visual is left out and the hero is one column.
- The result rows are deliberately abstract (rounded grey bars of varying width, `--line` colour, a short darker bar for the percentage). They suggest "results" without showing any site's real data.
- Subtle motion only if `prefers-reduced-motion` is not set: the three rows fade in once, 150ms apart; the page is complete at rest (initial state visible, animation only from opacity .4 to 1).

## Plugin card

A single bordered card (`--line`, 12px radius, white/`--panel`), padding 28px desktop / 20px phone. Layout, desktop:

```
┌────────────────────────────────────────────────────────────────────┐
│ [lb]  logbuy                      ● Stabil  ▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮ │
│       Find deals on Visma LogBuy…                       v0.6.0   │
│                                                                    │
│  "Er der LogBuy-rabat på høretelefoner?"   "Hvilke kategorier…"   │  ← prompts as light chips
│                                                                    │
│  ┌ /plugin install logbuy@hoaj ─────────────────────── Kopiér ┐   │
│                                                                    │
│  ▸ Kommandoer (4)   ▸ Andre klienter   ▸ Som MCP-server   Kilde ↗ │
└────────────────────────────────────────────────────────────────────┘
```

- **Monogram tile:** 40px square, 10px radius, `--ink` background, `--paper` text, the plugin's first two letters in mono.
- **Status, top right:** a 8px dot plus one word (Stabil / Ustabil / Drift / Ny / Ikke tjekket) and the 30-run strip as thin bars (3×14px, 2px gap) in the status colours; muted tooltips (`title`) and visually hidden text per bar "<dato>: <resultat>". Under it, in `--faint` 12px: "tjekket 18. okt. 06:19" linking to the run. The muted "Ikke tjekket i dag: …" note becomes the bar's tooltip and the visually hidden text, not visible prose. No legend on the page; the word next to the dot is the legend. Keep the existing `pluginHealth` rules.
- **Prompts:** up to three, as quiet chips (`--chip` background, 999px radius, 13px), not copyable.
- **Install:** one command block for Claude Code (`/plugin install <name>@hoaj`), dark in both themes, copy button. The marketplace-add step is already in the hero; add a 12px `--faint` hint under the block: "Efter `marketplace add` ovenfor."
- **Disclosure row** (`<details>` each, summary styled as a text button with a chevron):
  - "Kommandoer (n)": the command table (mono name, muted summary), compact rows.
  - "Andre klienter": Copilot CLI and Cursor commands as two small labelled command blocks (no tabs; tabs and their localStorage go away).
  - "Som MCP-server": the clone + `install.sh` + JSON + `claude mcp add` blocks, as today.
  - Then plain links: "Kilde ↗", "Issues ↗".
- Phone: status moves under the name; prompts wrap; the disclosure row wraps.

## Visual system

- **Type:** Geist (400, 500, 600) for everything; Geist Mono (400, 500) for wordmark, commands, chips' code and the visual. Google Fonts; fallbacks `system-ui, -apple-system, "Segoe UI", sans-serif` / `ui-monospace, "SF Mono", Menlo, monospace`. Sizes: 13 / 15 / 17 / 22 / 48 (hero; 34 on phones). Headline weight 600, letter-spacing -0.02em, `text-wrap: balance`. Body 15/1.55.
- **Tokens** (light / dark):
  - `--paper` #FFFFFF / #0A0A0B
  - `--panel` #FAFAFA / #111113
  - `--ink` #0A0A0B / #F2F2F3
  - `--muted` #5E5E66 / #A1A1AA
  - `--faint` #8E8E96 / #6B6B73
  - `--line` #E7E7EA / #232327
  - `--chip` #F2F2F4 / #1A1A1D
  - `--code-bg` #0A0A0B / #000000, `--code-ink` #F2F2F3, `--code-faint` #8E8E96
  - status only: `--ok` #16A34A / #22C55E, `--warn` #D97706 / #F59E0B, `--bad` #DC2626 / #F87171, `--none` = `--line`
  - Dark via `prefers-color-scheme` guarded by `:root:not([data-theme="light"])`, repeated under `:root[data-theme="dark"]`; `body { background: var(--paper) }`.
- **Links:** `--ink`, underline 1px with 3px offset; hover underline thickens. Focus: 2px `--ink` outline, 2px offset.
- **Buttons:** copy buttons are small ghost buttons in the code block (`--code-faint` text, 1px border of 20% `--code-ink`), "Kopiér" → "Kopieret" for 1.5s, announced via `aria-live`.
- **Spacing:** 8px grid; sections 96px apart on desktop, 64px on phones; content max width 1040px; side gutter `max(20px, env(safe-area-inset-left/right))`. No horizontal page scroll at 360px; code blocks scroll inside themselves.
- No gradients, no shadows, no emoji, no numbered steps, no centred body text.

## Data and build (unchanged unless stated)

- `site/extra.json`: `{ "<plugin>": { "prompts": [...], "demo": { "prompt", "command", "answer" } } }`.
- Relative links only (the site lives under `/plugins/`); `SITE_URL` sets canonical and `og:url`; `CNAME` only when `CUSTOM_DOMAIN` is set.
- Title "hoaj/plugins"; meta description "Plugins til Claude Code, Copilot CLI og Cursor, der lader din AI-agent bruge websites for dig."; inline SVG favicon of the monogram style (`>_` in a black rounded square).
- One self-contained `index.html`, `render()` pure and tested, `bun site/build.ts [--status <file>]`, no npm dependencies.
