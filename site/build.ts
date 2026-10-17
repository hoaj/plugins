// Builds the catalog (hoaj.github.io/plugins): one self-contained index.html listing the plugins
// that live in this repo, plus .nojekyll for GitHub Pages (and CNAME when CUSTOM_DOMAIN is set).
//
//   bun site/build.ts [--status <status.json>]   (from the repo root; writes site/dist/)
//
// Source of truth is .claude-plugin/marketplace.json. Only entries whose `source` is a string
// ("./plugins/...") are listed; they contribute their .claude-plugin/plugin.json (version, skills)
// and prompts and the hero demo from site/extra.json. A skill folder with an install.sh is a site CLI and gets the
// MCP-server snippet. Design: site/DESIGN.md.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

export const REPO = "hoaj/plugins";
export const SITE_URL_DEFAULT = "https://hoaj.github.io/plugins/";
export const GENERATOR_URL = "https://github.com/hoaj/site-cli-creator";
export const SITE_REQUEST_URL = "https://github.com/hoaj/plugins/issues/new?labels=site-request&title=Site-%C3%B8nske%3A%20";

export interface CliCommand {
  command: string;
  does: string;
}

export interface CliSkill {
  name: string;
  commands: CliCommand[];
}

export interface Demo {
  prompt: string;
  command: string;
  answer: string;
}

export interface Plugin {
  name: string;
  description: string;
  category?: string;
  version?: string;
  /** Repo the plugin lives in ("owner/name"). */
  repo: string;
  /** Folder of the plugin inside `repo`. */
  path: string;
  /** Example prompts from site/extra.json. */
  prompts?: string[];
  /** Conversation for the hero visual, from site/extra.json. */
  demo?: Demo;
  cliSkills: CliSkill[];
  /** Drift-check runs per CLI skill, oldest first. Absent when there is no status file. */
  status?: Record<string, StatusRun[]>;
}

export interface SiteData {
  marketplace: string;
  description?: string;
  plugins: Plugin[];
  /** `updated` from the status file. */
  statusUpdated?: string;
  /** Canonical URL of the page; defaults to SITE_URL_DEFAULT. */
  siteUrl?: string;
}

export const RESULTS = ["ok", "drift", "error", "session", "no-session", "network", "install"] as const;
export type RunResult = (typeof RESULTS)[number];

export interface StatusRun {
  at: string;
  result: RunResult;
  version?: string;
  run?: string;
  issues?: number[];
  detail?: string;
}

/** status.json on the `status` branch, written by the daily drift-check workflow. */
export interface StatusFile {
  updated?: string;
  plugins?: Record<string, { skills?: Record<string, { runs?: StatusRun[] }> }>;
}

interface MarketplaceEntry {
  name: string;
  source: string | { source: string; url?: string; repo?: string; path?: string };
  description?: string;
  homepage?: string;
  category?: string;
}

interface Marketplace {
  name: string;
  metadata?: { description?: string };
  plugins: MarketplaceEntry[];
}

function readJson<T>(file: string): T {
  return JSON.parse(readFileSync(file, "utf8")) as T;
}

function readJsonIfExists<T>(file: string): T | undefined {
  return existsSync(file) ? readJson<T>(file) : undefined;
}

/** Rows of the `<!-- commands:start -->` table in a CLI skill's SKILL.md. */
export function parseCommands(skillMd: string): CliCommand[] {
  const block = skillMd.match(/<!-- commands:start -->([\s\S]*?)<!-- commands:end -->/);
  if (!block) return [];
  const rows: CliCommand[] = [];
  for (const line of block[1].split("\n")) {
    const t = line.trim();
    if (!t.startsWith("|") || /^\|\s*-/.test(t) || /^\|\s*Command\s*\|/.test(t)) continue;
    const cells = t.slice(1, t.endsWith("|") ? -1 : undefined).split("|").map((c) => c.trim());
    if (cells.length < 2) continue;
    const command = cells[0].replace(/`/g, "");
    const does = cells[cells.length - 1];
    if (command) rows.push({ command, does });
  }
  return rows;
}

/**
 * Reads a status file. A missing or unreadable file means no status (the site still builds);
 * runs with an unknown `result` are dropped and the rest are sorted oldest first.
 */
export function loadStatus(file: string | undefined): StatusFile | undefined {
  if (!file || !existsSync(file)) return undefined;
  let raw: StatusFile;
  try {
    raw = readJson<StatusFile>(file);
  } catch (e) {
    console.warn(`site/build.ts: ignoring status file ${file}: ${(e as Error).message}`);
    return undefined;
  }
  if (!raw || typeof raw !== "object") return undefined;
  const plugins: NonNullable<StatusFile["plugins"]> = {};
  for (const [name, p] of Object.entries(raw.plugins ?? {})) {
    const skills: Record<string, { runs: StatusRun[] }> = {};
    for (const [skill, s] of Object.entries(p?.skills ?? {})) {
      const runs = (Array.isArray(s?.runs) ? s.runs : [])
        .filter((r) => r && typeof r.at === "string" && (RESULTS as readonly string[]).includes(r.result))
        .sort((a, b) => a.at.localeCompare(b.at));
      skills[skill] = { runs };
    }
    plugins[name] = { skills };
  }
  return { updated: typeof raw.updated === "string" ? raw.updated : undefined, plugins };
}

/** Reads the marketplace files and local plugin manifests under `root`, plus an optional status file. */
export function loadData(root: string, opts: { statusFile?: string } = {}): SiteData {
  const data = loadMarketplace(root);
  const status = loadStatus(opts.statusFile);
  if (!status) return data;
  for (const p of data.plugins) {
    if (!p.cliSkills.length) continue;
    const skills = status.plugins?.[p.name]?.skills ?? {};
    p.status = Object.fromEntries(p.cliSkills.map((s) => [s.name, skills[s.name]?.runs ?? []]));
  }
  return { ...data, statusUpdated: status.updated };
}

function loadMarketplace(root: string): SiteData {
  const claude = readJson<Marketplace>(join(root, ".claude-plugin/marketplace.json"));
  const extra = readJsonIfExists<Record<string, { prompts?: string[]; demo?: Partial<Demo> }>>(join(root, "site/extra.json")) ?? {};

  const plugins: Plugin[] = [];
  for (const entry of claude.plugins) {
    if (typeof entry.source !== "string") continue; // plugins from other repos are not listed
    const path = entry.source.replace(/^\.\//, "").replace(/\/+$/, "");
    const dir = join(root, path);
    const manifest = readJsonIfExists<{ version?: string; description?: string; skills?: string[] }>(
      join(dir, ".claude-plugin/plugin.json"),
    );
    const cliSkills: CliSkill[] = [];
    for (const rel of manifest?.skills ?? []) {
      const skillDir = join(dir, rel);
      if (!existsSync(join(skillDir, "install.sh"))) continue;
      const name = rel.replace(/\/+$/, "").split("/").pop()!;
      const md = join(skillDir, "SKILL.md");
      cliSkills.push({ name, commands: existsSync(md) ? parseCommands(readFileSync(md, "utf8")) : [] });
    }
    const prompts = extra[entry.name]?.prompts?.filter((t) => typeof t === "string" && t.trim());
    const d = extra[entry.name]?.demo;
    const demo = d && [d.prompt, d.command, d.answer].every((t) => typeof t === "string" && t.trim()) ? (d as Demo) : undefined;
    plugins.push({
      name: entry.name,
      description: entry.description || manifest?.description || "",
      category: entry.category,
      version: manifest?.version,
      repo: REPO,
      path,
      prompts: prompts?.length ? prompts : undefined,
      demo,
      cliSkills,
    });
  }

  return { marketplace: claude.name, description: claude.metadata?.description, plugins };
}



// ---------------------------------------------------------------------------------------
// Rendering (pure)

export function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

/** A command block with a copy button. `shell` puts a "$" prompt (not copied) on each line. */
function cmd(text: string, opts: { shell?: boolean; label?: string } = {}): string {
  const lines = text.split("\n");
  const body = opts.shell ? lines.map((l) => `<span class="ln">${esc(l)}</span>`).join("\n") : esc(text);
  const aria = opts.label ? ` aria-label="${esc(opts.label)}"` : "";
  return `<div class="cmd${opts.shell ? " sh" : ""}${lines.length > 1 ? " multi" : ""}"><pre tabindex="0"${aria}><code>${body}</code></pre><button type="button" class="copy" hidden>Kopiér</button></div>`;
}

function githubTree(repo: string, path: string): string {
  return `https://github.com/${repo}${path ? `/tree/main/${path}` : ""}`;
}

function mcpBody(p: Plugin, skill: CliSkill): string {
  const rel = `${p.path}/skills/${skill.name}`;
  const bin = `/sti/til/plugins/${rel}/bin/${skill.name}`;
  const json = JSON.stringify({ mcpServers: { [skill.name]: { command: bin, args: ["mcp"] } } }, null, 2);
  return (
    `<p class="lbl">Hent binæren</p>` +
    cmd(`git clone https://github.com/${REPO}\ncd plugins\nbash ${rel}/install.sh`, {
      shell: true,
      label: `Hent ${skill.name}-binæren`,
    }) +
    `<p class="lbl">MCP-konfiguration</p>` +
    cmd(json, { label: `MCP-konfiguration for ${skill.name}` }) +
    `<p class="lbl">Eller i Claude Code</p>` +
    cmd(`claude mcp add ${skill.name} -- ${bin} mcp`, { shell: true, label: `Claude Code: tilføj ${skill.name} som MCP-server` }) +
    `<p class="hint">Ret <code>/sti/til/plugins</code> til din klon. På Windows hedder filen <code>${esc(skill.name)}.exe</code>.</p>`
  );
}

function commandList(skill: CliSkill): string {
  return `<ul class="cmds">${skill.commands
    .map((c) => `<li><code>${esc(c.command)}</code><span>${esc(c.does)}</span></li>`)
    .join("")}</ul>`;
}

function promptChips(p: Plugin): string {
  if (!p.prompts?.length) return "";
  return `<ul class="prompts" aria-label="Eksempler på spørgsmål">${p.prompts
    .slice(0, 3)
    .map((t) => `<li>${esc(t)}</li>`)
    .join("")}</ul>`;
}

// ---------------------------------------------------------------------------------------
// Drift-check status

export type Health = "drift" | "unstable" | "stable" | "new" | "unchecked";

/** Results that say something about the site; the others mean the check did not run. */
const COUNTED: ReadonlySet<RunResult> = new Set(["ok", "drift", "error"]);
const BAD: ReadonlySet<RunResult> = new Set(["drift", "error"]);
const WINDOW = 14;
const STRIP = 30;

export const HEALTH_LABEL: Record<Health, string> = {
  drift: "Drift",
  unstable: "Ustabil",
  stable: "Stabil",
  new: "Ny",
  unchecked: "Ikke tjekket",
};

const NOT_CHECKED: Partial<Record<RunResult, string>> = {
  session: "Ikke tjekket i dag: CI-sessionen er udløbet",
  "no-session": "Ikke tjekket i dag: ingen CI-session sat op",
  install: "Ikke tjekket i dag: binæren kunne ikke hentes",
  network: "Ikke tjekket i dag: sitet svarede ikke",
};

const RESULT_LABEL: Record<RunResult, string> = {
  ok: "OK",
  drift: "drift",
  error: "fejl i tjekket",
  session: "ikke tjekket (CI-sessionen var udløbet)",
  "no-session": "ikke tjekket (ingen CI-session)",
  network: "ikke tjekket (sitet svarede ikke)",
  install: "ikke tjekket (binæren kunne ikke hentes)",
};

export interface HealthSummary {
  health: Health;
  /** The counted run behind a "drift" badge. */
  failing?: StatusRun;
  /** Most recent run of any kind, across skills. */
  latest?: StatusRun;
  /** Muted "not checked today" notes. */
  notes: string[];
}

/**
 * Badge rule over a plugin's CLI skills, counting only ok/drift/error: the latest counted
 * run of a skill is drift/error -> drift; any drift/error in a skill's last 14 counted runs
 * -> unstable; every skill that has counted runs has at least 3, all ok -> stable;
 * otherwise new. No counted runs at all -> unchecked.
 */
export function pluginHealth(status: Record<string, StatusRun[]> | undefined): HealthSummary {
  const skills = Object.entries(status ?? {});
  const all = skills.flatMap(([, runs]) => runs).sort((a, b) => a.at.localeCompare(b.at));
  const notes = [
    ...new Set(
      skills.flatMap(([name, runs]) => {
        const note = runs.length ? NOT_CHECKED[runs[runs.length - 1].result] : undefined;
        return note ? [skills.length > 1 ? `${name}: ${note}` : note] : [];
      }),
    ),
  ];
  const latest = all[all.length - 1];
  const counted = skills.map(([, runs]) => runs.filter((r) => COUNTED.has(r.result)));
  if (!counted.some((c) => c.length)) return { health: "unchecked", latest, notes };

  for (const c of counted) {
    const last = c[c.length - 1];
    if (last && BAD.has(last.result)) return { health: "drift", failing: last, latest, notes };
  }
  if (counted.some((c) => c.slice(-WINDOW).some((r) => BAD.has(r.result)))) {
    return { health: "unstable", latest, notes };
  }
  const stable = counted.every((c) => c.length === 0 || c.length >= 3);
  return { health: stable ? "stable" : "new", latest, notes };
}

const TZ = "Europe/Copenhagen";
const fmtDate = new Intl.DateTimeFormat("da-DK", { day: "numeric", month: "short", year: "numeric", timeZone: TZ });

function date(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : fmtDate.format(d);
}

const MONTHS = ["jan.", "feb.", "mar.", "apr.", "maj", "jun.", "jul.", "aug.", "sep.", "okt.", "nov.", "dec."];

/** "18. okt. 06:19" in Danish time, no year. */
function shortStamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", { timeZone: TZ, day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit", hour12: false })
      .formatToParts(d)
      .map((x) => [x.type, x.value]),
  );
  const hour = parts.hour === "24" ? "00" : parts.hour;
  return `${parts.day}. ${MONTHS[Number(parts.month) - 1]} ${hour}:${parts.minute}`;
}

function mark(r: StatusRun): string {
  const label = `${date(r.at)}: ${RESULT_LABEL[r.result]}`;
  return `<li class="m r-${r.result}" title="${esc(label)}"><span class="sr">${esc(label)}</span></li>`;
}

/** Top right of the card: dot + word + strip, and a faint line with version and last check. */
function statusBlock(p: Plugin): string {
  const ver = p.version ? `<span class="ver">v${esc(p.version)}</span>` : "";
  if (!p.cliSkills.length) return ver ? `<div class="status"><p class="smeta">${ver}</p></div>` : "";
  const h = pluginHealth(p.status);
  const multi = p.cliSkills.length > 1;
  const strips = p.cliSkills
    .map((s) => {
      const runs = (p.status?.[s.name] ?? []).slice(-STRIP);
      if (!runs.length) return "";
      const name = multi ? `<span class="sk">${esc(s.name)}</span>` : "";
      return `<div class="strip-row">${name}<ol class="strip" aria-label="De seneste ${runs.length} tjek af ${esc(s.name)}, ældste først">${runs.map(mark).join("")}</ol></div>`;
    })
    .join("");
  const meta: string[] = [];
  if (ver) meta.push(ver);
  if (h.latest) {
    const when = `tjekket <time datetime="${esc(h.latest.at)}">${esc(shortStamp(h.latest.at))}</time>`;
    meta.push(h.latest.run ? `<a href="${esc(h.latest.run)}">${when}</a>` : when);
  }
  if (h.failing?.result === "drift" && h.failing.issues?.length) {
    meta.push(
      h.failing.issues
        .map((n) => `<a href="https://github.com/${REPO}/issues/${encodeURIComponent(String(n))}">#${esc(String(n))}</a>`)
        .join(" "),
    );
  }
  const note = h.notes.join(". ");
  const title = note ? ` title="${esc(note)}"` : "";
  return `<div class="status h-${h.health}"${title}>
<div class="srow"><span class="dot" aria-hidden="true"></span><span class="sword">${HEALTH_LABEL[h.health]}</span>${strips}</div>
${note ? `<span class="sr">${esc(note)}</span>` : ""}
<p class="smeta">${meta.join('<span aria-hidden="true"> · </span>')}</p>
</div>`;
}

// ---------------------------------------------------------------------------------------
// Icons (24px, 1.5px stroke, currentColor)

const svg = (inner: string, size = 24, extra = "") =>
  `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"${extra}>${inner}</svg>`;

const ICONS = {
  lock: svg(`<rect x="5" y="11" width="14" height="9.5" rx="2.5"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/><path d="M12 15v2"/>`),
  shapes: svg(`<rect x="3.5" y="4" width="7" height="7" rx="1.5"/><circle cx="17" cy="7.5" r="3.5"/><path d="M4 20l3.5-6 3.5 6z"/><path d="M14.5 17h6"/>`),
  check: svg(`<circle cx="12" cy="12" r="8.5"/><path d="M8.5 12.3l2.5 2.5 4.7-5"/>`),
  github: svg(`<path d="M7 17l-4-5 4-5"/><path d="M17 7l4 5-4 5"/><path d="M14 5l-4 14"/>`, 16),
};

// ---------------------------------------------------------------------------------------
// Sections

function plugin(p: Plugin, marketplace: string): string {
  const id = slug(p.name);
  const ref = `${p.name}@${marketplace}`;
  const mono = esc(p.name.slice(0, 2).toLowerCase());

  const commands = p.cliSkills.flatMap((s) => (s.commands.length ? [s] : []));
  const nCommands = commands.reduce((n, s) => n + s.commands.length, 0);
  const disclosures = [
    nCommands
      ? `<details class="d"><summary>Kommandoer (${nCommands})</summary><div class="d-body">${commands.map(commandList).join("")}</div></details>`
      : "",
    `<details class="d"><summary>Andre klienter</summary><div class="d-body">` +
      `<p class="lbl">Copilot CLI</p>` +
      cmd(`copilot plugin marketplace add ${REPO}\ncopilot plugin install ${ref}`, { shell: true, label: `Copilot CLI: installér ${p.name}` }) +
      `<p class="lbl">Cursor · Settings → Plugins → Add marketplace</p>` +
      cmd(REPO, { label: `Cursor: markedsplads for ${p.name}` }) +
      `</div></details>`,
    ...p.cliSkills.map(
      (s) => `<details class="d"><summary>Som MCP-server</summary><div class="d-body">${mcpBody(p, s)}</div></details>`,
    ),
  ].join("\n");

  return `<article class="plugin" id="${id}" aria-labelledby="h-${id}">
<div class="p-head">
<span class="mono-tile" aria-hidden="true">${mono}</span>
<div class="p-id"><h3 id="h-${id}"><a class="anchor" href="#${id}">${esc(p.name)}</a></h3><p class="desc">${esc(p.description)}</p></div>
${statusBlock(p)}
</div>
${promptChips(p)}
<div class="install">
${cmd(`/plugin install ${ref}`, { label: `Claude Code: installér ${p.name}` })}
<p class="hint">Efter <code>marketplace add</code> ovenfor.</p>
</div>
<div class="more">
${disclosures}
<a class="ext" href="${esc(githubTree(p.repo, p.path))}">Kilde ↗</a>
<a class="ext" href="https://github.com/${REPO}/issues?q=is%3Aopen+label%3A${encodeURIComponent(p.name)}">Issues ↗</a>
</div>
</article>`;
}

/** The hero picture: a question becomes a plugin command and an answer. Pure HTML/CSS. */
function visual(d: Demo): string {
  const rows = [
    ["55%", "18px"],
    ["40%", "28px"],
    ["66%", "18px"],
  ]
    .map(([w, pct]) => `<div class="sk-row"><span class="bar" style="width:${w}"></span><span class="pct" style="width:${pct}"></span></div>`)
    .join("");
  return `<figure class="term" aria-label="Eksempel på en samtale med en agent">
<div class="row"><span class="who">du</span><span class="say">${esc(d.prompt)}</span></div>
<div class="row"><span class="who">agent</span><div class="say"><span class="run"><span aria-hidden="true">▸ </span>${esc(d.command)}</span><div class="res" aria-hidden="true">${rows}</div></div></div>
<div class="row"><span class="who">agent</span><span class="say">${esc(d.answer)}</span></div>
</figure>`;
}

const FAVICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="#0A0A0B"/><path d="M9 11l6 5-6 5" stroke="#fff" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="M17 22h7" stroke="#fff" stroke-width="3" stroke-linecap="round"/></svg>`;

export function render(data: SiteData): string {
  const siteUrl = data.siteUrl ?? SITE_URL_DEFAULT;
  const plugins = data.plugins;
  const demo = plugins.find((p) => p.demo)?.demo;
  const metaDesc = "Plugins til Claude Code, Copilot CLI og Cursor, der lader din AI-agent bruge websites for dig.";
  const title = "hoaj/plugins";

  return `<!doctype html>
<html lang="da">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(metaDesc)}">
<meta property="og:type" content="website">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(metaDesc)}">
<meta property="og:url" content="${esc(siteUrl)}">
<meta name="color-scheme" content="light dark">
<link rel="canonical" href="${esc(siteUrl)}">
<link rel="icon" href="data:image/svg+xml,${encodeURIComponent(FAVICON)}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600&family=Geist+Mono:wght@400;500&display=swap">
<style>${CSS}</style>
</head>
<body>
<a class="skip" href="#plugins">Spring til plugins</a>
<header class="top">
<div class="wrap top-row">
<a class="wordmark" href="./">hoaj/plugins</a>
<a class="gh" href="https://github.com/${REPO}">GitHub</a>
</div>
</header>
<main>
<section class="hero wrap${demo ? "" : " one"}" aria-labelledby="hero-h">
<div class="hero-text">
<h1 id="hero-h">Din AI-agent, på dine websites.</h1>
<p class="sub">Plugins til Claude Code, Copilot CLI og Cursor.</p>
${cmd(`/plugin marketplace add ${REPO}`, { label: "Tilføj markedspladsen i Claude Code" })}
</div>
${demo ? visual(demo) : ""}
</section>

<section id="plugins" class="plugins wrap" aria-labelledby="plugins-h" tabindex="-1">
<h2 id="plugins-h" class="label">Plugins · ${plugins.length}</h2>
${plugins.map((p) => plugin(p, data.marketplace)).join("\n")}
</section>

<section class="wrap" aria-label="Tre løfter">
<ul class="facts">
<li>${ICONS.lock}<span>Login bliver hos dig</span></li>
<li>${ICONS.shapes}<span>Kun former, aldrig data</span></li>
<li>${ICONS.check}<span>Rapporterer kun med dit ja</span></li>
</ul>
</section>
</main>
<footer class="foot wrap">
<div class="foot-row">
<p>Mangler et website? <a href="${esc(SITE_REQUEST_URL)}">Foreslå det</a> · <a href="${GENERATOR_URL}">Lav dit eget</a></p>
<p>MIT · <a href="https://github.com/${REPO}">GitHub</a></p>
</div>
<p class="fine">Brug kun plugins på dine egne konti.</p>
</footer>
<div id="live" class="sr" aria-live="polite"></div>
<script>${JS}</script>
</body>
</html>
`;
}

const CSS = `
:root{
  --paper:#FFFFFF;--panel:#FAFAFA;--ink:#0A0A0B;--muted:#5E5E66;--faint:#8E8E96;--line:#E7E7EA;--chip:#F2F2F4;
  --code-bg:#0A0A0B;--code-ink:#F2F2F3;--code-faint:#8E8E96;
  --ok:#16A34A;--warn:#D97706;--bad:#DC2626;--none:var(--line);
  --sans:"Geist",system-ui,-apple-system,"Segoe UI",sans-serif;
  --mono:"Geist Mono",ui-monospace,"SF Mono",Menlo,monospace;
}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){
  --paper:#0A0A0B;--panel:#111113;--ink:#F2F2F3;--muted:#A1A1AA;--faint:#6B6B73;--line:#232327;--chip:#1A1A1D;
  --code-bg:#000000;--code-ink:#F2F2F3;--code-faint:#8E8E96;
  --ok:#22C55E;--warn:#F59E0B;--bad:#F87171;
}}
:root[data-theme="dark"]{
  --paper:#0A0A0B;--panel:#111113;--ink:#F2F2F3;--muted:#A1A1AA;--faint:#6B6B73;--line:#232327;--chip:#1A1A1D;
  --code-bg:#000000;--code-ink:#F2F2F3;--code-faint:#8E8E96;
  --ok:#22C55E;--warn:#F59E0B;--bad:#F87171;
}
*,*::before,*::after{box-sizing:border-box}
html{-webkit-text-size-adjust:100%;scroll-padding-top:24px}
body{margin:0;background:var(--paper);color:var(--ink);font:400 15px/1.55 var(--sans)}
a{color:var(--ink);text-decoration:underline;text-decoration-thickness:1px;text-underline-offset:3px}
a:hover{text-decoration-thickness:2px}
:focus-visible{outline:2px solid var(--ink);outline-offset:2px;border-radius:4px}
h1,h2,h3,p,figure,ul{margin:0}
ul{padding:0;list-style:none}
code{font-family:var(--mono);font-size:.92em}
.wrap{width:min(1040px,100% - 2*max(20px,env(safe-area-inset-left),env(safe-area-inset-right)));margin-inline:auto}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.skip{position:absolute;left:16px;top:-60px;background:var(--ink);color:var(--paper);padding:8px 14px;border-radius:6px;z-index:20}
.skip:focus{top:12px}

.top{border-bottom:1px solid var(--line)}
.top-row{display:flex;align-items:center;justify-content:space-between;gap:16px;min-height:56px}
.wordmark{font:500 15px/1 var(--mono);text-decoration:none}
.gh{font-size:13px;color:var(--muted);text-decoration:none}
.gh:hover{color:var(--ink)}

.hero{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.05fr);gap:56px;align-items:center;padding-block:80px 0}
.hero.one{grid-template-columns:minmax(0,1fr)}
.hero-text{display:grid;gap:16px;justify-items:start;align-content:center;min-width:0}
.hero-text .cmd{width:100%;max-width:440px;margin-top:8px}
h1{font-size:48px;line-height:1.08;font-weight:600;letter-spacing:-.02em;text-wrap:balance}
.sub{font-size:17px;color:var(--muted)}

.term{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:24px;display:grid;gap:16px;font:400 13px/1.6 var(--mono);min-width:0}
.term .row{display:grid;grid-template-columns:48px minmax(0,1fr);gap:12px}
.who{color:var(--faint)}
.say{overflow-wrap:anywhere;min-width:0}
.run{font-weight:500}
.res{margin-top:12px;border:1px solid var(--line);border-radius:8px;background:var(--paper);padding:14px 16px;display:grid;gap:12px}
.sk-row{display:flex;align-items:center;justify-content:space-between;gap:16px}
.bar,.pct{display:block;height:10px;border-radius:5px}
.bar{background:var(--line)}
.pct{background:var(--faint);opacity:.55}
@media (prefers-reduced-motion:no-preference){
  .term .row{animation:rise .6s ease-out both}
  .term .row:nth-child(2){animation-delay:.15s}
  .term .row:nth-child(3){animation-delay:.3s}
}
@keyframes rise{from{opacity:.4}to{opacity:1}}

.plugins{margin-top:96px}
.label{font:400 13px/1 var(--mono);color:var(--muted);margin-bottom:16px}
.plugin{border:1px solid var(--line);border-radius:12px;background:var(--paper);padding:28px;display:grid;grid-template-columns:minmax(0,1fr);gap:24px;min-width:0}
.p-head{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:4px 16px;align-items:start}
.mono-tile{width:40px;height:40px;border-radius:10px;background:var(--ink);color:var(--paper);display:flex;align-items:center;justify-content:center;font:500 15px/1 var(--mono)}
.p-id{display:grid;gap:2px;min-width:0}
.p-id h3{font-size:22px;line-height:1.2;font-weight:600;letter-spacing:-.01em}
.anchor{text-decoration:none}
.desc{color:var(--muted);max-width:60ch}

.status{display:grid;gap:6px;justify-items:end;text-align:right;min-width:0}
.srow{display:flex;align-items:center;gap:10px;flex-wrap:wrap;justify-content:flex-end}
.dot{width:8px;height:8px;border-radius:50%;box-shadow:inset 0 0 0 1.5px var(--faint);flex:none}
.sword{font-weight:500;font-size:15px}
.h-stable .dot{background:var(--ok);box-shadow:none}
.h-unstable .dot{background:var(--warn);box-shadow:none}
.h-drift .dot{background:var(--bad);box-shadow:none}
.strip-row{display:flex;align-items:center;gap:8px}
.sk{font:400 13px/1 var(--mono);color:var(--faint)}
.strip{display:flex;gap:2px;padding:0;margin:0;list-style:none}
.m{display:block;width:3px;height:14px;border-radius:1px;background:var(--none)}
.m.r-ok{background:var(--ok)}
.m.r-drift{background:var(--bad)}
.m.r-error{background:var(--warn)}
.smeta{font-size:12px;color:var(--faint)}
.smeta a{color:var(--faint)}
.smeta a:hover{color:var(--ink)}

.prompts{display:flex;flex-wrap:wrap;gap:8px}
.prompts li{background:var(--chip);border-radius:999px;padding:6px 14px;font-size:13px;line-height:1.4;color:var(--muted)}
.prompts li::before{content:"\\201C"}
.prompts li::after{content:"\\201D"}

.install{display:grid;gap:8px}
.hint{font-size:12px;color:var(--faint)}
.lbl{font-size:12px;color:var(--faint);margin:12px 0 6px}
.lbl:first-child{margin-top:0}

.cmd{position:relative;min-width:0}
.cmd pre{margin:0;background:var(--code-bg);color:var(--code-ink);border-radius:8px;padding:14px 88px 14px 16px;overflow-x:auto;font:400 13px/1.6 var(--mono);tab-size:2}
.cmd pre code{font-size:inherit}
.cmd.sh .ln::before{content:"$ ";color:var(--code-faint);user-select:none;-webkit-user-select:none}
.copy{position:absolute;top:50%;right:8px;transform:translateY(-50%);font:400 12px/1 var(--sans);color:var(--code-faint);background:transparent;border:1px solid rgba(242,242,243,.2);border-radius:6px;padding:6px 10px;cursor:pointer}
.copy:hover,.copy.ok{color:var(--code-ink)}
.copy:focus-visible{outline-color:var(--code-ink)}
.cmd.multi .copy{top:8px;transform:none}

.more{display:flex;flex-wrap:wrap;align-items:center;gap:4px 4px}
.d{order:0}
.d[open]{order:2;flex-basis:100%;min-width:0}
.d summary{display:inline-flex;align-items:center;gap:6px;list-style:none;cursor:pointer;font-size:14px;font-weight:500;color:var(--muted);padding:8px 10px;margin-left:-10px;border-radius:8px}
.d summary::-webkit-details-marker{display:none}
.d summary::before{content:"";width:6px;height:6px;border-right:1.5px solid currentColor;border-bottom:1.5px solid currentColor;transform:rotate(-45deg);transition:transform .15s}
.d[open] summary::before{transform:rotate(45deg)}
.d summary:hover,.d[open] summary{color:var(--ink)}
.d-body{padding:8px 0 4px}
.ext{order:1;font-size:14px;color:var(--muted);text-decoration:none;padding:8px 10px}
.ext:hover{color:var(--ink);text-decoration:underline}
.ext:first-of-type{margin-left:auto}
.cmds li{display:grid;grid-template-columns:minmax(180px,max-content) minmax(0,1fr);gap:4px 24px;padding:8px 0;border-top:1px solid var(--line);font-size:13px}
.cmds li:last-child{border-bottom:1px solid var(--line)}
.cmds code{font-weight:500;overflow-wrap:anywhere}
.cmds span{color:var(--muted)}

.facts{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:24px;margin-top:96px}
.facts li{display:flex;align-items:center;gap:12px}
.facts svg{flex:none}

.foot{margin-top:96px;border-top:1px solid var(--line);padding-block:24px 48px;display:grid;gap:8px;font-size:13px}
.foot-row{display:flex;flex-wrap:wrap;justify-content:space-between;gap:8px 24px}
.foot a{color:var(--ink)}
.fine{font-size:12px;color:var(--faint)}

@media (max-width:899px){
  .hero{grid-template-columns:minmax(0,1fr);gap:40px;padding-top:48px}
  h1{font-size:34px}
}
@media (max-width:640px){
  .plugins,.facts,.foot{margin-top:64px}
  .plugin{padding:20px}
  .p-head{grid-template-columns:auto minmax(0,1fr)}
  .status{grid-column:1/-1;justify-items:start;text-align:left;margin-top:12px}
  .srow{justify-content:flex-start}
  .facts{grid-template-columns:minmax(0,1fr);gap:16px}
  .term{padding:16px}
  .term .row{grid-template-columns:44px minmax(0,1fr);gap:8px}
  .cmds li{grid-template-columns:minmax(0,1fr)}
  .cmd pre{padding:14px 16px 48px}
  .cmd .copy,.cmd.multi .copy{top:auto;bottom:8px;transform:none}
}
`;

const JS = `
(function(){
  var live=document.getElementById("live");
  function say(t){if(live){live.textContent="";setTimeout(function(){live.textContent=t},30)}}
  function fallbackCopy(text){
    try{
      var ta=document.createElement("textarea");ta.value=text;ta.setAttribute("readonly","");
      ta.style.position="fixed";ta.style.top="-1000px";document.body.appendChild(ta);ta.select();
      var ok=document.execCommand("copy");document.body.removeChild(ta);return ok;
    }catch(e){return false}
  }
  function selectCode(el){
    try{var r=document.createRange();r.selectNodeContents(el);var s=window.getSelection();s.removeAllRanges();s.addRange(r)}catch(e){}
  }
  function copy(text){
    if(navigator.clipboard&&window.isSecureContext){
      return navigator.clipboard.writeText(text).then(function(){return true},function(){return fallbackCopy(text)});
    }
    return Promise.resolve(fallbackCopy(text));
  }
  document.querySelectorAll(".cmd").forEach(function(box){
    var btn=box.querySelector(".copy"),code=box.querySelector("code");if(!btn||!code)return;
    btn.hidden=false;
    btn.addEventListener("click",function(){
      copy(code.textContent).then(function(ok){
        if(ok){btn.textContent="Kopieret";btn.classList.add("ok");say("Kopieret til udklipsholderen")}
        else{selectCode(code);btn.textContent="Tryk Ctrl/⌘+C";say("Teksten er markeret. Tryk Ctrl+C eller Cmd+C for at kopiere")}
        clearTimeout(btn._t);btn._t=setTimeout(function(){btn.textContent="Kopiér";btn.classList.remove("ok")},1500);
      });
    });
  });
})();
`;

/**
 * Loads data from `root`, renders, and writes index.html and .nojekyll to `outDir`, plus a CNAME
 * when `opts.customDomain` is set.
 */
export function build(
  root: string,
  outDir: string,
  opts: { statusFile?: string; siteUrl?: string; customDomain?: string } = {},
): string {
  const data = loadData(root, opts);
  const html = render({ ...data, siteUrl: opts.siteUrl || SITE_URL_DEFAULT });
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "index.html"), html);
  if (opts.customDomain) writeFileSync(join(outDir, "CNAME"), `${opts.customDomain}\n`);
  writeFileSync(join(outDir, ".nojekyll"), "");
  return html;
}

/** `--status <file>` or `--status=<file>`, else env STATUS_FILE. */
export function statusFileArg(argv: string[], env: Record<string, string | undefined>): string | undefined {
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--status") return argv[i + 1];
    if (argv[i].startsWith("--status=")) return argv[i].slice("--status=".length);
  }
  return env.STATUS_FILE || undefined;
}

if (import.meta.main) {
  const root = resolve(import.meta.dir, "..");
  const out = join(root, "site/dist");
  const arg = statusFileArg(Bun.argv.slice(2), process.env);
  const statusFile = arg ? resolve(arg) : undefined;
  const customDomain = process.env.CUSTOM_DOMAIN || undefined;
  const html = build(root, out, { statusFile, siteUrl: process.env.SITE_URL || undefined, customDomain });
  const status = statusFile && existsSync(statusFile) ? `status from ${statusFile}` : "no status file";
  console.log(
    `wrote ${out}/index.html (${(html.length / 1024).toFixed(1)} KB)${customDomain ? `, CNAME ${customDomain}` : ""}, .nojekyll; ${status}`,
  );
}
