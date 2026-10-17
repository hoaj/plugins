// Builds agentplugins.dk: one self-contained index.html listing every plugin in the hoaj
// marketplace, plus CNAME and .nojekyll for GitHub Pages.
//
//   bun site/build.ts            (from the repo root; writes site/dist/)
//
// Source of truth is .claude-plugin/marketplace.json. Local plugins (string source) also
// contribute their .claude-plugin/plugin.json (version, skills). A skill folder with an
// install.sh is a site CLI and gets the MCP-server snippet. Adding a plugin to the
// marketplace and rebuilding is the only step to list it.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

export const REPO = "hoaj/plugins";
export const DOMAIN = "agentplugins.dk";
export const GENERATOR_URL = "https://github.com/hoaj/site-cli-creator";

export type Kind = "site-cli" | "generator" | "local" | "external";

export interface CliCommand {
  command: string;
  does: string;
}

export interface CliSkill {
  name: string;
  commands: CliCommand[];
}

export interface Plugin {
  name: string;
  description: string;
  category?: string;
  kind: Kind;
  local: boolean;
  version?: string;
  /** Repo the plugin lives in ("owner/name"). */
  repo: string;
  /** Folder of the plugin inside `repo`. */
  path: string;
  homepage?: string;
  /** Repo whose marketplace Cursor installs it from. */
  cursorMarketplace: string;
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

/** "https://github.com/a/b.git" or "a/b" -> "a/b". */
export function normalizeRepo(ref: string): string {
  return ref
    .replace(/^https?:\/\/github\.com\//, "")
    .replace(/^git@github\.com:/, "")
    .replace(/\.git$/, "")
    .replace(/\/+$/, "");
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
  const copilot = readJsonIfExists<Marketplace>(join(root, ".github/plugin/marketplace.json"));
  const cursor = readJsonIfExists<Marketplace>(join(root, ".cursor-plugin/marketplace.json"));
  const inCursor = new Set((cursor?.plugins ?? []).map((p) => p.name));

  const plugins = claude.plugins.map((entry): Plugin => {
    const base = {
      name: entry.name,
      description: entry.description ?? "",
      category: entry.category,
      homepage: entry.homepage,
    };

    if (typeof entry.source === "string") {
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
      return {
        ...base,
        description: base.description || manifest?.description || "",
        kind: entry.name === "site-cli-creator" ? "generator" : cliSkills.length ? "site-cli" : "local",
        local: true,
        version: manifest?.version,
        repo: REPO,
        path,
        cursorMarketplace: REPO,
        cliSkills,
      };
    }

    const copilotSource = copilot?.plugins.find((p) => p.name === entry.name)?.source;
    const repoRef =
      entry.source.url ??
      entry.source.repo ??
      (typeof copilotSource === "object" ? (copilotSource.repo ?? copilotSource.url) : undefined) ??
      REPO;
    const repo = normalizeRepo(repoRef);
    return {
      ...base,
      kind: entry.name === "site-cli-creator" ? "generator" : "external",
      local: false,
      repo,
      path: (entry.source.path ?? "").replace(/^\.\//, "").replace(/\/+$/, ""),
      cursorMarketplace: inCursor.has(entry.name) ? REPO : repo,
      cliSkills: [],
    };
  });

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
  const body = opts.shell
    ? lines.map((l) => `<span class="ln">${esc(l)}</span>`).join("\n")
    : esc(text);
  const aria = opts.label ? ` aria-label="${esc(opts.label)}"` : "";
  return `<div class="cmd${opts.shell ? " sh" : ""}"><pre tabindex="0"${aria}><code>${body}</code></pre><button type="button" class="copy" hidden>Kopiér</button></div>`;
}

const KIND_LABEL: Record<Kind, string> = {
  "site-cli": "Site-CLI",
  generator: "Generator",
  local: "Plugin",
  external: "Eksternt",
};

const KIND_NOTE: Record<Kind, string> = {
  "site-cli": "CLI til ét website. Den samme fil er også en lokal MCP-server.",
  generator: "Laver nye site-CLI-plugins ud fra de kald, et website selv laver.",
  local: "Plugin i dette repo.",
  external: "Bor i sit eget repo og installeres derfra.",
};

function githubTree(repo: string, path: string): string {
  return `https://github.com/${repo}${path ? `/tree/main/${path}` : ""}`;
}

function installTabs(p: Plugin, marketplace: string): string {
  const id = slug(p.name);
  const ref = `${p.name}@${marketplace}`;
  const external = p.cursorMarketplace !== REPO;
  const clients = [
    {
      key: "claude",
      label: "Claude Code",
      body:
        `<p class="step">Tilføj markedspladsen én gang, og installér så pluginnet:</p>` +
        cmd(`/plugin marketplace add ${REPO}`, { label: "Claude Code: tilføj markedsplads" }) +
        cmd(`/plugin install ${ref}`, { label: `Claude Code: installér ${p.name}` }),
    },
    {
      key: "copilot",
      label: "Copilot CLI",
      body:
        `<p class="step">I din terminal:</p>` +
        cmd(`copilot plugin marketplace add ${REPO}\ncopilot plugin install ${ref}`, {
          shell: true,
          label: `Copilot CLI: installér ${p.name}`,
        }),
    },
    {
      key: "cursor",
      label: "Cursor",
      body:
        `<p class="step"><span class="path">Settings → Plugins → Add marketplace</span>, indsæt repoet og installér <strong>${esc(p.name)}</strong>:</p>` +
        cmd(p.cursorMarketplace, { label: `Cursor: markedsplads for ${p.name}` }) +
        (external
          ? `<p class="hint">Cursor henter dette plugin fra dets eget repo, ikke fra ${esc(REPO)}.</p>`
          : ""),
    },
  ];

  const tabs = clients
    .map(
      (c, i) =>
        `<button type="button" role="tab" id="t-${id}-${c.key}" aria-controls="p-${id}-${c.key}" aria-selected="${i === 0}" tabindex="${i === 0 ? 0 : -1}" data-client="${c.key}">${c.label}</button>`,
    )
    .join("");
  const panels = clients
    .map(
      (c) =>
        `<div class="panel" role="tabpanel" id="p-${id}-${c.key}" aria-labelledby="t-${id}-${c.key}" data-client="${c.key}"><h4 class="panel-h">${c.label}</h4>${c.body}</div>`,
    )
    .join("");
  return `<div class="install" data-tabs><h3 class="mini">Installér</h3><div class="tablist" role="tablist" aria-label="Klient for ${esc(p.name)}">${tabs}</div>${panels}</div>`;
}

function mcpSection(p: Plugin, skill: CliSkill): string {
  const rel = `${p.path}/skills/${skill.name}`;
  const bin = `/sti/til/plugins/${rel}/bin/${skill.name}`;
  const json = JSON.stringify({ mcpServers: { [skill.name]: { command: bin, args: ["mcp"] } } }, null, 2);
  return `<details class="mcp">
<summary><span>Brug som MCP-server</span><span class="sum-note">${esc(skill.name)} mcp · stdio</span></summary>
<div class="mcp-body">
<ol class="steps">
<li><p>Hent binæren. Scriptet downloader over HTTPS, så du behøver ikke GitHub CLI:</p>${cmd(
    `git clone https://github.com/${REPO}\ncd plugins\nbash ${rel}/install.sh`,
    { shell: true, label: `Hent ${skill.name}-binæren` },
  )}</li>
<li><p>Tilføj serveren i din MCP-klients konfiguration. Ret <code>/sti/til/plugins</code> til mappen, du klonede til:</p>${cmd(json, {
    label: `MCP-konfiguration for ${skill.name}`,
  })}</li>
<li><p>Eller i Claude Code, med én kommando:</p>${cmd(`claude mcp add ${skill.name} -- ${bin} mcp`, {
    shell: true,
    label: `Claude Code: tilføj ${skill.name} som MCP-server`,
  })}</li>
</ol>
<p class="hint">På Windows hedder filen <code>bin/${esc(skill.name)}.exe</code>. Login og session bliver på din egen maskine.</p>
</div>
</details>`;
}

function commandList(skill: CliSkill): string {
  if (!skill.commands.length) return "";
  const items = skill.commands
    .map((c) => `<li><code>${esc(c.command)}</code><span>${esc(c.does)}</span></li>`)
    .join("");
  return `<div class="commands"><h3 class="mini">Kommandoer</h3><ul>${items}</ul></div>`;
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
  drift: "Drift fundet",
  unstable: "Ustabil",
  stable: "Stabil",
  new: "Ny",
  unchecked: "Endnu ikke tjekket",
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
const fmtDateTime = new Intl.DateTimeFormat("da-DK", { dateStyle: "medium", timeStyle: "short", timeZone: TZ });

function date(iso: string, withTime = false): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return (withTime ? fmtDateTime : fmtDate).format(d);
}

function explain(h: HealthSummary): string {
  switch (h.health) {
    case "drift":
      return h.failing?.result === "error"
        ? "Seneste tjek fejlede. Nogle kommandoer virker måske ikke, før det er undersøgt."
        : "Sitet har ændret sig. Nogle kommandoer virker måske ikke, før pluginnet er rettet.";
    case "unstable":
      return `Virker nu, men tjekket har fundet drift eller fejl inden for de seneste ${WINDOW} tjek.`;
    case "stable":
      return "De seneste daglige tjek er gået igennem uden fejl.";
    case "new":
      return "For få tjek endnu til at sige noget om stabiliteten.";
    case "unchecked":
      return "Det daglige tjek har ikke kørt for dette plugin endnu.";
  }
}

function mark(r: StatusRun): string {
  const label = `${date(r.at)}: ${RESULT_LABEL[r.result]}`;
  return `<li class="m r-${r.result}" title="${esc(label)}"><span class="sr">${esc(label)}</span></li>`;
}

function statusBlock(p: Plugin): string {
  if (!p.cliSkills.length) return "";
  const h = pluginHealth(p.status);
  const multi = p.cliSkills.length > 1;
  const strips = p.cliSkills
    .map((s) => {
      const runs = (p.status?.[s.name] ?? []).slice(-STRIP);
      if (!runs.length) return "";
      return `<div class="strip-row">${multi ? `<span class="strip-skill">${esc(s.name)}</span>` : ""}<ol class="strip" aria-label="De seneste ${runs.length} tjek af ${esc(s.name)}, ældste først">${runs.map(mark).join("")}</ol></div>`;
    })
    .join("");
  const meta: string[] = [];
  if (h.latest) {
    const when = `<time datetime="${esc(h.latest.at)}">${esc(date(h.latest.at, true))}</time>`;
    meta.push(`Sidst tjekket ${h.latest.run ? `<a href="${esc(h.latest.run)}">${when}</a>` : when}`);
  }
  if (h.failing?.result === "drift" && h.failing.issues?.length) {
    meta.push(
      h.failing.issues
        .map((n) => `<a href="https://github.com/${REPO}/issues/${encodeURIComponent(String(n))}">#${esc(String(n))}</a>`)
        .join(" "),
    );
  }
  meta.push(
    `<a href="https://github.com/${REPO}/issues?q=is%3Aopen+label%3Adrift+label%3A${encodeURIComponent(p.name)}">Åbne drift-issues</a>`,
  );
  return `<div class="status h-${h.health}">
<h3 class="mini">Dagligt tjek</h3>
<p class="status-head"><span class="hbadge">${HEALTH_LABEL[h.health]}</span><span class="status-text">${explain(h)}</span></p>
${h.notes.map((n) => `<p class="status-note">${esc(n)}</p>`).join("")}
${strips}
<p class="status-meta">${meta.join('<span aria-hidden="true"> · </span>')}</p>
</div>`;
}

/** The intro's one-line summary, or "" when no plugin has CLI skills. */
function statusSummary(data: SiteData): string {
  const tracked = data.plugins.filter((p) => p.cliSkills.length);
  if (!tracked.length) return "";
  const withStatus = tracked.filter((p) => p.status);
  if (!withStatus.length) {
    return `<p class="hero-status"><span class="hs-label">Status</span><span>Det daglige tjek har ikke kørt endnu.</span></p>`;
  }
  const stable = tracked.filter((p) => pluginHealth(p.status).health === "stable").length;
  const lastAt =
    data.statusUpdated ??
    withStatus
      .flatMap((p) => Object.values(p.status ?? {}).flat())
      .map((r) => r.at)
      .sort()
      .pop();
  const when = lastAt ? ` · sidst tjekket ${esc(date(lastAt))}` : "";
  return `<p class="hero-status"><span class="hs-label">Status</span><span><a href="#plugins">${stable} af ${tracked.length} plugins kører stabilt</a>${when}</span></p>`;
}

function legend(data: SiteData): string {
  if (!data.plugins.some((p) => p.status)) return "";
  const item = (cls: string, text: string) =>
    `<li><span class="m ${cls}" aria-hidden="true"></span>${text}</li>`;
  return `<ul class="legend" aria-label="Forklaring til dagligt tjek">${item("r-ok", "OK")}${item("r-drift", "Drift")}${item("r-error", "Fejl i tjekket")}${item("r-network", "Ikke tjekket")}</ul>`;
}

function card(p: Plugin, marketplace: string): string {
  const id = slug(p.name);
  const source = githubTree(p.repo, p.path);
  const links = [`<a href="${esc(source)}">Kildekode</a>`];
  if (p.local) {
    links.push(
      `<a href="https://github.com/${REPO}/issues?q=is%3Aopen+label%3A${encodeURIComponent(p.name)}">Åbne issues</a>`,
    );
  }
  if (p.homepage && p.homepage !== source) links.push(`<a href="${esc(p.homepage)}">Hjemmeside</a>`);

  const meta = [
    `<span class="badge k-${p.kind}">${KIND_LABEL[p.kind]}</span>`,
    p.version ? `<span class="ver">v${esc(p.version)}</span>` : "",
    p.category ? `<span class="cat">${esc(p.category)}</span>` : "",
    !p.local ? `<span class="cat">${esc(p.repo)}</span>` : "",
  ]
    .filter(Boolean)
    .join("");

  return `<article class="card" id="${id}" aria-labelledby="h-${id}">
<div class="card-main">
<div class="meta">${meta}</div>
<h2 id="h-${id}"><a class="anchor" href="#${id}">${esc(p.name)}</a></h2>
<p class="desc">${esc(p.description)}</p>
<p class="kind-note">${KIND_NOTE[p.kind]}</p>
${statusBlock(p)}
${p.cliSkills.map(commandList).join("")}
<p class="links">${links.join("")}</p>
</div>
<div class="card-side">
${installTabs(p, marketplace)}
${p.cliSkills.map((s) => mcpSection(p, s)).join("")}
</div>
</article>`;
}

export function render(data: SiteData): string {
  const nav = data.plugins.map((p) => `<li><a href="#${slug(p.name)}">${esc(p.name)}</a></li>`).join("");
  const cards = data.plugins.map((p) => card(p, data.marketplace)).join("\n");
  const count = data.plugins.length;
  const metaDesc =
    "Plugins til Claude Code, GitHub Copilot CLI og Cursor, der lader din AI-agent bruge websites for dig, som dig, på din egen maskine.";

  return `<!doctype html>
<html lang="da">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>agentplugins.dk</title>
<meta name="description" content="${esc(metaDesc)}">
<meta property="og:title" content="agentplugins.dk">
<meta property="og:description" content="${esc(metaDesc)}">
<meta property="og:url" content="https://${DOMAIN}/">
<meta name="color-scheme" content="light dark">
<link rel="canonical" href="https://${DOMAIN}/">
<link rel="icon" href="data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="#121614"/><path d="M9 11l6 5-6 5" stroke="#d6f05a" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="M17 22h7" stroke="#d6f05a" stroke-width="3" stroke-linecap="round"/></svg>`,
  )}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,600;12..96,800&family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:ital,wght@0,400;0,500;0,600;1,400&display=swap">
<style>${CSS}</style>
</head>
<body>
<a class="skip" href="#plugins">Spring til plugins</a>
<header class="top">
<div class="wrap top-row">
<a class="wordmark" href="/"><span class="prompt" aria-hidden="true">&gt;_</span>agentplugins<span class="tld">.dk</span></a>
<nav aria-label="Eksterne links"><a href="https://github.com/${REPO}">GitHub</a></nav>
</div>
</header>
<main>
<section class="hero wrap" aria-labelledby="hero-h">
<p class="eyebrow">Plugins til Claude Code, GitHub Copilot CLI og Cursor</p>
<h1 id="hero-h">Lad din AI-agent klare ting på <mark>websites</mark> for dig.</h1>
<p class="lede">Hvert plugin pakker ét website ind i en lille CLI, som din agent kører på din egen maskine, logget ind som dig. Den samme fil er også en lokal MCP-server, så du kan bruge den fra andre klienter.</p>
${statusSummary(data)}
<ul class="points">
<li><h2>Kører hos dig</h2><p>CLI’en kører lokalt, og dit login bliver på din egen maskine. Der står ingen server imellem dig og sitet.</p></li>
<li><h2>Siger til, når sitet ændrer sig</h2><p>Hvis et website ændrer sig, stopper CLI’en i stedet for at gætte. Med dit OK rapporterer den ændringen, så den bliver rettet.</p></li>
<li><h2>Skill eller MCP-server</h2><p>Installér pluginnet i din agent, eller tilslut binæren som MCP-server med <code>&lt;navn&gt; mcp</code>.</p></li>
</ul>
</section>

<section id="plugins" class="plugins wrap" aria-labelledby="plugins-h" tabindex="-1">
<div class="section-head">
<h2 id="plugins-h">Plugins <span class="count">${count}</span></h2>
<p>Alle ligger i markedspladsen <code>${esc(data.marketplace)}</code> på <a href="https://github.com/${REPO}">${esc(REPO)}</a>.</p>
</div>
<div class="subhead"><ul class="jump" aria-label="Gå til plugin">${nav}</ul>${legend(data)}</div>
${cards}
</section>

<section class="diy wrap" aria-labelledby="diy-h">
<div>
<h2 id="diy-h">Lav dit eget</h2>
<p>Mangler du et website? Med <a href="${GENERATOR_URL}">site-cli-creator</a> laver din agent et nyt plugin ud fra de kald, sitet selv laver i browseren: en CLI-skill, en lokal MCP-server, Drift-tjek og en feedback-skill, der rapporterer fejl.</p>
</div>
<p class="diy-link"><a class="btn" href="${GENERATOR_URL}">hoaj/site-cli-creator</a></p>
</section>
</main>
<footer class="foot wrap">
<p>Lavet af <a href="https://github.com/hoaj">hoaj</a>. Plugins logger ind som dig, med dine egne loginoplysninger, og gemmer dem kun på din maskine. Brug dem kun på dine egne konti.</p>
<p><a href="https://github.com/${REPO}/issues">Fejl eller ønsker? Opret en issue</a></p>
</footer>
<div id="live" class="sr" aria-live="polite"></div>
<script>${JS}</script>
</body>
</html>
`;
}

const CSS = `
:root{
  --bg:#f1f2ee;--surface:#fbfcf9;--ink:#121614;--muted:#535b56;--line:#d3d8cf;--line-strong:#a9b1a6;
  --accent:#1c6a44;--accent-ink:#fff;--mark:#d6f05a;--mark-ink:#121614;
  --code-bg:#151a17;--code-ink:#e4eae2;--code-muted:#7f8b83;--code-line:#151a17;
  --k-site:#1c6a44;--k-gen:#8a4b0f;--k-ext:#3d4a8c;
  --ok:#1b7a45;--warn:#9a5a00;--bad:#b42318;--neutral:#626b65;
  --radius:10px;--shadow:0 1px 0 rgba(18,22,20,.04),0 8px 24px -16px rgba(18,22,20,.25);
  --f-head:"Bricolage Grotesque",ui-sans-serif,system-ui,sans-serif;
  --f-body:"IBM Plex Sans",ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;
  --f-mono:"IBM Plex Mono",ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
}
@media (prefers-color-scheme:dark){:root{
  --bg:#0d100e;--surface:#141916;--ink:#e6ebe4;--muted:#9ba59e;--line:#27302b;--line-strong:#3c4842;
  --accent:#7ed3a0;--accent-ink:#0d100e;--mark:#c8e24c;--mark-ink:#0d100e;
  --code-bg:#090b0a;--code-ink:#dfe6dd;--code-muted:#6f7b73;--code-line:#27302b;
  --k-site:#7ed3a0;--k-gen:#f0b46e;--k-ext:#a9b6f5;
  --ok:#6fd49a;--warn:#f2b259;--bad:#ff8b7d;--neutral:#9ba59e;
  --shadow:none;
}}
*,*::before,*::after{box-sizing:border-box}
html{-webkit-text-size-adjust:100%;scroll-padding-top:1rem}
body{margin:0;background:var(--bg);color:var(--ink);font:400 1rem/1.6 var(--f-body);overflow-x:hidden}
img,svg{max-width:100%}
a{color:var(--accent);text-underline-offset:.18em;text-decoration-thickness:1px}
a:hover{text-decoration-thickness:2px}
:focus-visible{outline:3px solid var(--accent);outline-offset:2px;border-radius:4px}
code{font-family:var(--f-mono);font-size:.9em}
p code,li>p code,.points code,.section-head code{background:color-mix(in srgb,var(--ink) 7%,transparent);padding:.05em .3em;border-radius:4px}
.wrap{width:min(1080px,100% - 2rem);margin-inline:auto}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.skip{position:absolute;left:1rem;top:-3rem;background:var(--ink);color:var(--bg);padding:.5rem .8rem;border-radius:6px;z-index:10}
.skip:focus{top:1rem}

.top{border-bottom:1px solid var(--line)}
.top-row{display:flex;align-items:center;justify-content:space-between;gap:1rem;padding-block:.9rem}
.wordmark{font:500 1rem/1 var(--f-mono);color:var(--ink);text-decoration:none;letter-spacing:-.01em;display:inline-flex;align-items:center;gap:.5rem}
.wordmark .prompt{background:var(--ink);color:var(--mark);padding:.25rem .35rem;border-radius:5px;font-size:.8rem}
.wordmark .tld{color:var(--muted)}
.top nav a{font-weight:500;color:var(--ink)}

.hero{padding-block:clamp(2.5rem,7vw,5rem) clamp(2rem,5vw,3.5rem)}
.eyebrow{font:500 .8rem/1.4 var(--f-mono);color:var(--muted);margin:0 0 1rem;text-transform:uppercase;letter-spacing:.06em}
h1,h2,h3{font-family:var(--f-head);line-height:1.08;letter-spacing:-.02em;margin:0}
h1{font-weight:800;font-size:clamp(2.1rem,6.4vw,4.1rem);max-width:17ch;text-wrap:balance}
mark{background:linear-gradient(transparent 58%,var(--mark) 58%,var(--mark) 92%,transparent 92%);color:inherit;padding-inline:.05em}
.lede{font-size:clamp(1.05rem,2.1vw,1.25rem);max-width:58ch;margin:1.4rem 0 0;color:var(--ink)}
.points{list-style:none;padding:0;margin:clamp(2rem,5vw,3rem) 0 0;display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,15rem),1fr));gap:1.25rem 2rem}
.points li{border-top:2px solid var(--ink);padding-top:.9rem}
.points h2{font-size:1.15rem;font-weight:600;margin-bottom:.4rem;letter-spacing:-.01em}
.points p{margin:0;color:var(--muted)}

.plugins{padding-block:2rem 3rem;outline:none}
.section-head{display:flex;flex-wrap:wrap;align-items:baseline;justify-content:space-between;gap:.5rem 2rem;border-bottom:1px solid var(--line);padding-bottom:1rem}
.section-head h2{font-size:clamp(1.6rem,3.5vw,2.2rem);font-weight:800}
.section-head p{margin:0;color:var(--muted)}
.count{font:500 .9rem/1 var(--f-mono);vertical-align:.45em;color:var(--muted);margin-left:.2rem}
.jump{list-style:none;display:flex;flex-wrap:wrap;gap:.5rem;padding:0;margin:1rem 0 1.5rem}
.jump a{display:inline-block;font:500 .85rem/1 var(--f-mono);padding:.45rem .65rem;border:1px solid var(--line-strong);border-radius:999px;color:var(--ink);text-decoration:none}
.jump a:hover{border-color:var(--ink)}

.card{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.15fr);gap:1.5rem 2.5rem;background:var(--surface);border:1px solid var(--line);border-radius:var(--radius);box-shadow:var(--shadow);padding:clamp(1.1rem,3vw,2rem);margin-bottom:1.25rem}
.card>*{min-width:0}
@media (max-width:860px){.card{grid-template-columns:minmax(0,1fr)}}
.meta{display:flex;flex-wrap:wrap;gap:.4rem;align-items:center;margin-bottom:.7rem}
.badge,.ver,.cat{font:500 .75rem/1 var(--f-mono);padding:.35rem .5rem;border-radius:5px;white-space:nowrap}
.badge{color:var(--surface);background:var(--k-site)}
.badge.k-generator{background:var(--k-gen)}
.badge.k-external,.badge.k-local{background:var(--k-ext)}
.ver{background:var(--mark);color:var(--mark-ink)}
.cat{border:1px solid var(--line-strong);color:var(--muted);max-width:100%;overflow:hidden;text-overflow:ellipsis}
.card h2{font-size:clamp(1.6rem,4vw,2.1rem);font-weight:800}
.anchor{color:inherit;text-decoration:none}
.anchor:hover{text-decoration:underline;text-decoration-thickness:2px}
.desc{margin:.6rem 0 0;font-size:1.05rem}
.kind-note{margin:.5rem 0 0;color:var(--muted);font-size:.95rem}
.mini{font:600 .75rem/1.2 var(--f-mono);text-transform:uppercase;letter-spacing:.07em;color:var(--muted);margin:0 0 .6rem}
.commands{margin-top:1.25rem}
.commands ul{list-style:none;padding:0;margin:0;border-top:1px solid var(--line)}
.commands li{display:grid;gap:.15rem;padding:.55rem 0;border-bottom:1px solid var(--line)}
.commands li code{font-size:.85rem;font-weight:500;overflow-wrap:anywhere}
.commands li span{color:var(--muted);font-size:.92rem}
.links{display:flex;flex-wrap:wrap;gap:.4rem 1.25rem;margin:1.25rem 0 0;font-weight:500}

.tablist{display:none;gap:.25rem;border-bottom:1px solid var(--line);margin-bottom:.9rem;overflow-x:auto}
.js .tablist{display:flex}
.tablist button{font:500 .9rem/1 var(--f-body);color:var(--muted);background:none;border:0;border-bottom:2px solid transparent;padding:.6rem .7rem .7rem;margin-bottom:-1px;cursor:pointer;white-space:nowrap;border-radius:4px 4px 0 0}
.tablist button:hover{color:var(--ink)}
.tablist button[aria-selected=true]{color:var(--ink);border-bottom-color:var(--accent)}
.panel+.panel{margin-top:1.25rem}
.js .panel+.panel{margin-top:0}
.panel-h{font:600 .9rem/1.2 var(--f-body);margin:0 0 .4rem}
.js .panel-h{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
.step{margin:0 0 .5rem;font-size:.95rem}
.path{font-family:var(--f-mono);font-size:.85em}
.hint{margin:.6rem 0 0;color:var(--muted);font-size:.88rem}

.cmd{position:relative;margin:0 0 .5rem}
.cmd pre{margin:0;background:var(--code-bg);color:var(--code-ink);border:1px solid var(--code-line);border-radius:8px;padding:.75rem 5.5rem .75rem .9rem;overflow-x:auto;font:400 .85rem/1.55 var(--f-mono);tab-size:2}
.cmd pre code{font-size:inherit;background:none;padding:0}
.cmd.sh .ln::before{content:"$ ";color:var(--code-muted);user-select:none;-webkit-user-select:none}
.copy{position:absolute;top:.45rem;right:.45rem;font:500 .75rem/1 var(--f-body);color:var(--code-ink);background:color-mix(in srgb,var(--code-ink) 10%,var(--code-bg));border:1px solid color-mix(in srgb,var(--code-ink) 22%,transparent);border-radius:6px;padding:.4rem .6rem;cursor:pointer}
.copy:hover{background:color-mix(in srgb,var(--code-ink) 18%,var(--code-bg))}
.copy:focus-visible{outline-color:var(--mark)}
.copy.ok{background:var(--mark);color:var(--mark-ink);border-color:var(--mark)}

.hero-status{display:flex;flex-wrap:wrap;align-items:baseline;gap:.25rem .75rem;margin:1.25rem 0 0;font-size:.95rem}
.hs-label{font:600 .75rem/1.2 var(--f-mono);text-transform:uppercase;letter-spacing:.07em;color:var(--muted)}
.subhead{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:.5rem 1.5rem;margin:1rem 0 1.5rem}
.subhead .jump{margin:0}
.legend{list-style:none;display:flex;flex-wrap:wrap;gap:.35rem 1rem;padding:0;margin:0;font-size:.82rem;color:var(--muted)}
.legend li{display:inline-flex;align-items:center;gap:.4rem}
.legend .m{width:8px;flex:none}

.status{--h:var(--neutral);margin-top:1.25rem;border-left:3px solid var(--h);padding:.1rem 0 .1rem .9rem}
.status.h-drift{--h:var(--bad)}
.status.h-unstable{--h:var(--warn)}
.status.h-stable{--h:var(--ok)}
.status-head{display:flex;flex-wrap:wrap;align-items:baseline;gap:.35rem .6rem;margin:0}
.hbadge{font:600 .78rem/1 var(--f-body);color:var(--h);border:1.5px solid var(--h);background:color-mix(in srgb,var(--h) 12%,transparent);padding:.3rem .5rem;border-radius:999px;white-space:nowrap}
.status-text{font-size:.93rem}
.status-note{margin:.4rem 0 0;color:var(--muted);font-size:.88rem;font-style:italic}
.strip-row{display:flex;align-items:center;gap:.6rem;margin-top:.65rem;min-width:0}
.strip-skill{font:500 .75rem/1 var(--f-mono);color:var(--muted);flex:none}
.strip{list-style:none;display:flex;align-items:flex-end;gap:3px;padding:0;margin:0;height:22px;min-width:0;flex:1}
.m{display:inline-block;flex:0 1 8px;min-width:4px;height:22px;border-radius:2px;background:var(--ok);position:relative}
.m.r-drift{background:repeating-linear-gradient(45deg,var(--bad) 0 2px,transparent 2px 4px);box-shadow:inset 0 0 0 1.5px var(--bad)}
.m.r-error{background:repeating-linear-gradient(0deg,var(--warn) 0 2px,transparent 2px 4px);box-shadow:inset 0 0 0 1.5px var(--warn)}
.m.r-session,.m.r-no-session,.m.r-network,.m.r-install{height:9px;background:transparent;box-shadow:inset 0 0 0 1.5px var(--neutral)}
.status-meta{margin:.6rem 0 0;font-size:.85rem;color:var(--muted)}

.mcp{margin-top:1.25rem;border:1px solid var(--line-strong);border-radius:8px}
.mcp summary{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:baseline;gap:.25rem 1rem;padding:.75rem .9rem;cursor:pointer;font-weight:600;list-style:none;border-radius:8px}
.mcp summary::-webkit-details-marker{display:none}
.mcp summary>span:first-child::before{content:"+";display:inline-block;width:1.1em;font-family:var(--f-mono);color:var(--accent)}
.mcp[open] summary>span:first-child::before{content:"−"}
.sum-note{font:400 .8rem/1.2 var(--f-mono);color:var(--muted)}
.mcp-body{padding:0 .9rem .9rem}
.steps{margin:0;padding-left:1.25rem}
.steps li{padding-left:.25rem;margin-bottom:.9rem}
.steps li::marker{font-family:var(--f-mono);color:var(--muted)}
.steps p{margin:0 0 .45rem;font-size:.95rem}

.diy{display:grid;grid-template-columns:minmax(0,1.6fr) minmax(0,1fr);gap:1.25rem 2.5rem;align-items:end;border-top:2px solid var(--ink);padding-block:2rem 2.5rem;margin-top:1rem}
@media (max-width:760px){.diy{grid-template-columns:minmax(0,1fr)}}
.diy h2{font-size:clamp(1.6rem,3.5vw,2.2rem);font-weight:800;margin-bottom:.6rem}
.diy p{margin:0;max-width:60ch}
.diy-link{justify-self:start}
@media (min-width:761px){.diy-link{justify-self:end}}
.btn{display:inline-block;font:500 .95rem/1 var(--f-mono);background:var(--ink);color:var(--bg);text-decoration:none;padding:.85rem 1.1rem;border-radius:8px;overflow-wrap:anywhere}
.btn:hover{background:var(--accent);color:var(--accent-ink)}
.foot{border-top:1px solid var(--line);padding-block:1.5rem 3rem;color:var(--muted);font-size:.9rem;display:flex;flex-wrap:wrap;justify-content:space-between;gap:.5rem 2rem}
.foot p{margin:0;max-width:62ch}

@media (prefers-reduced-motion:no-preference){
  html{scroll-behavior:smooth}
  .copy,.jump a,.btn,.tablist button{transition:background-color .15s,color .15s,border-color .15s}
}
@media (max-width:420px){
  .cmd pre{padding-right:.9rem;padding-top:2.4rem}
  .wrap{width:calc(100% - 2rem)}
}
`;

const JS = `
(function(){
  var root=document.documentElement;root.classList.add("js");
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
        clearTimeout(btn._t);btn._t=setTimeout(function(){btn.textContent="Kopiér";btn.classList.remove("ok")},2000);
      });
    });
  });

  var KEY="agentplugins.client",groups=[].slice.call(document.querySelectorAll("[data-tabs]"));
  function show(client,focusGroup){
    groups.forEach(function(g){
      var tabs=[].slice.call(g.querySelectorAll('[role=tab]'));
      if(!tabs.some(function(t){return t.dataset.client===client}))return;
      tabs.forEach(function(t){var on=t.dataset.client===client;t.setAttribute("aria-selected",on);t.tabIndex=on?0:-1;if(on&&g===focusGroup)t.focus()});
      g.querySelectorAll('[role=tabpanel]').forEach(function(p){p.hidden=p.dataset.client!==client});
    });
  }
  groups.forEach(function(g){
    var tabs=[].slice.call(g.querySelectorAll('[role=tab]'));
    tabs.forEach(function(t,i){
      t.addEventListener("click",function(){show(t.dataset.client);try{localStorage.setItem(KEY,t.dataset.client)}catch(e){}});
      t.addEventListener("keydown",function(e){
        var j=e.key==="ArrowRight"?i+1:e.key==="ArrowLeft"?i-1:e.key==="Home"?0:e.key==="End"?tabs.length-1:null;
        if(j===null)return;e.preventDefault();var n=tabs[(j+tabs.length)%tabs.length];
        show(n.dataset.client,g);try{localStorage.setItem(KEY,n.dataset.client)}catch(e2){}
      });
    });
  });
  var saved=null;try{saved=localStorage.getItem(KEY)}catch(e){}
  show(saved||"claude");
})();
`;

/** Loads data from `root`, renders, and writes index.html, CNAME and .nojekyll to `outDir`. */
export function build(root: string, outDir: string, opts: { statusFile?: string } = {}): string {
  const html = render(loadData(root, opts));
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "index.html"), html);
  writeFileSync(join(outDir, "CNAME"), `${DOMAIN}\n`);
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
  const html = build(root, out, { statusFile });
  const status = statusFile && existsSync(statusFile) ? `status from ${statusFile}` : "no status file";
  console.log(`wrote ${out}/index.html (${(html.length / 1024).toFixed(1)} KB), CNAME, .nojekyll; ${status}`);
}
