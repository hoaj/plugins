import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  build,
  loadData,
  parseCommands,
  pluginHealth,
  render,
  statusFileArg,
  GENERATOR_URL,
  SITE_REQUEST_URL,
  SITE_URL_DEFAULT,
  type Plugin,
  type SiteData,
  type StatusRun,
} from "./build";

const ROOT = resolve(import.meta.dir, "..");

const demo: Plugin = {
  name: "demo",
  description: "Demo site CLI.",
  category: "shopping",
  version: "1.2.3",
  repo: "hoaj/plugins",
  path: "plugins/demo",
  prompts: ["Vis mig demoen.", "Hvad kan demo?"],
  cliSkills: [{ name: "demo", commands: [{ command: "demo item list", does: "Lists items" }] }],
};

const data: SiteData = { marketplace: "hoaj", plugins: [demo] };

/** The HTML from the opening tag of the plugin article with `id` to its </article>. */
function articleOf(html: string, id: string): string {
  const start = html.indexOf(`<article class="plugin" id="${id}"`);
  expect(start).toBeGreaterThan(-1);
  return html.slice(start, html.indexOf("</article>", start));
}

describe("render", () => {
  test("only plugins that live in this repo become cards; the generator is a footer link only", () => {
    const real = loadData(ROOT);
    const html = render(real);
    const market = JSON.parse(readFileSync(join(ROOT, ".claude-plugin/marketplace.json"), "utf8"));
    const local = market.plugins.filter((p: { source: unknown }) => typeof p.source === "string");
    expect(real.plugins.map((p) => p.name)).toEqual(local.map((p: { name: string }) => p.name));
    expect(html.match(/<article /g)?.length).toBe(local.length);
    expect(html).toContain('<article class="plugin" id="logbuy"');
    expect(html).not.toContain('id="site-cli-creator"');
    expect(html).not.toContain('id="bank"');
    expect(html).not.toContain("noskillish/bankmcp");
    const foot = html.slice(html.indexOf('<footer class="foot'));
    expect(foot).toContain(`<a href="${GENERATOR_URL}">Lav dit eget</a>`);
    expect(html.split(GENERATOR_URL).length - 1).toBe(1);
  });

  test("the real logbuy card: name, version, Claude command, other clients, MCP block", () => {
    const real = loadData(ROOT);
    const c = articleOf(render(real), "logbuy");
    expect(c).toContain(">logbuy</a></h3>");
    expect(c).toContain(`>v${real.plugins[0].version}</span>`);
    expect(c).toContain("<code>/plugin install logbuy@hoaj</code>");
    const others = c.slice(c.indexOf("Andre klienter"));
    expect(others).toContain("copilot plugin install logbuy@hoaj");
    expect(others).toContain("copilot plugin marketplace add hoaj/plugins");
    expect(others).toMatch(/Cursor[\s\S]*<code>hoaj\/plugins<\/code>/);
    expect(c).toContain("Som MCP-server");
  });

  test("hero: headline, sub line, copyable marketplace command; one h1", () => {
    const html = render(data);
    expect(html).toContain("Din AI-agent, på dine websites.");
    expect(html).toContain("Plugins til Claude Code, Copilot CLI og Cursor.");
    expect(html).toMatch(/<section class="hero[^"]*"[\s\S]*<code>\/plugin marketplace add hoaj\/plugins<\/code>[\s\S]*class="copy"/);
    expect(html.match(/<h1[ >]/g)?.length).toBe(1);
    expect(html).toContain("Plugins · 1");
  });

  test("no tabs, no localStorage, no old fonts or removed sections", () => {
    const html = render(data);
    expect(html).not.toContain('<button type="button" role="tab"');
    expect(html).not.toContain('<button role="tab"');
    expect(html).not.toContain('role="tablist"');
    expect(html).not.toContain("localStorage");
    expect(html).not.toContain("Schibsted");
    expect(html).not.toContain("JetBrains");
    expect(html).not.toContain("Sådan virker det");
    expect(html).not.toContain("Dine data");
    expect(html).not.toContain("Mangler dit website?");
    expect(html).not.toContain('class="legend"');
  });

  test("plugin card: monogram, one install command, disclosures, MCP block and links", () => {
    const c = articleOf(render(data), "demo");
    expect(c).toContain('<span class="mono-tile" aria-hidden="true">de</span>');
    expect(c).toContain(">demo</a></h3>");
    expect(c).toContain("Demo site CLI.");
    expect(c).toContain('<span class="ver">v1.2.3</span>');
    expect(c).toContain("<code>/plugin install demo@hoaj</code>");
    expect(c).toContain("Efter <code>marketplace add</code> ovenfor.");
    expect(c.match(/<details /g)?.length).toBe(3);
    expect(c).toContain("Kommandoer (1)");
    expect(c).toContain("Som MCP-server");
    expect(c).toContain("bash plugins/demo/skills/demo/install.sh");
    expect(c).toContain("claude mcp add demo -- /sti/til/plugins/plugins/demo/skills/demo/bin/demo mcp");
    expect(c).toContain("&quot;args&quot;: [\n        &quot;mcp&quot;\n      ]");
    expect(c).toContain('href="https://github.com/hoaj/plugins/tree/main/plugins/demo">Kilde ↗</a>');
    expect(c).toContain('href="https://github.com/hoaj/plugins/issues?q=is%3Aopen+label%3Ademo">Issues ↗</a>');
  });

  test("Copilot and Cursor commands sit inside Andre klienter", () => {
    const c = articleOf(render(data), "demo");
    const start = c.indexOf("Andre klienter");
    const block = c.slice(start, c.indexOf("</details>", start));
    expect(block).toContain("copilot plugin marketplace add hoaj/plugins");
    expect(block).toContain("copilot plugin install demo@hoaj");
    expect(block).toContain("<code>hoaj/plugins</code>");
    expect(c.slice(0, start)).not.toContain("copilot plugin");
  });

  test("commands table renders command and summary", () => {
    const c = articleOf(render(data), "demo");
    expect(c).toContain("<li><code>demo item list</code><span>Lists items</span></li>");
  });

  test("a plugin without CLI skills has no status, MCP block or command list", () => {
    const c = articleOf(render({ ...data, plugins: [{ ...demo, cliSkills: [] }] }), "demo");
    expect(c).not.toContain('class="srow"');
    expect(c).not.toContain("MCP-server");
    expect(c).not.toContain("Kommandoer");
    expect(c.match(/<details /g)?.length).toBe(1);
  });

  test("prompts render as chips and are omitted without extra.json", () => {
    const real = loadData(ROOT);
    expect(real.plugins.find((p) => p.name === "logbuy")?.prompts).toEqual([
      "Er der LogBuy-rabat på høretelefoner?",
      "Vis mig LogBuy-tilbuddet hos Zalando.",
      "Hvilke kategorier har LogBuy?",
    ]);
    const withPrompts = articleOf(render(data), "demo");
    expect(withPrompts).toContain('<ul class="prompts"');
    expect(withPrompts).toContain("<li>Vis mig demoen.</li>");
    const without = articleOf(render({ ...data, plugins: [{ ...demo, prompts: undefined }] }), "demo");
    expect(without).not.toContain('class="prompts"');
  });

  test("demo visual renders its three texts; without demo it is omitted and the hero is one column", () => {
    const real = loadData(ROOT);
    expect(real.plugins[0].demo).toEqual({
      prompt: "Er der LogBuy-rabat på høretelefoner?",
      command: 'logbuy deal search "høretelefoner"',
      answer: "3 tilbud fundet.",
    });
    const html = render(real);
    const fig = html.slice(html.indexOf('<figure class="term"'), html.indexOf("</figure>"));
    expect(fig).toContain("Er der LogBuy-rabat på høretelefoner?");
    expect(fig).toContain("logbuy deal search &quot;høretelefoner&quot;");
    expect(fig).toContain("3 tilbud fundet.");
    expect(html).toContain('<section class="hero wrap"');
    const plain = render(data);
    expect(plain).not.toContain('<figure class="term"');
    expect(plain).toContain('<section class="hero wrap one"');
  });

  test("three facts and the footer row", () => {
    const html = render(data);
    expect(html.match(/<ul class="facts">[\s\S]*?<\/ul>/)![0].match(/<svg /g)?.length).toBe(3);
    expect(html).toContain("Login bliver hos dig");
    expect(html).toContain("Kun former, aldrig data");
    expect(html).toContain("Rapporterer kun med dit ja");
    expect(html).toContain("Mangler et website?");
    expect(html).toContain("MIT · ");
    expect(html).toContain("Brug kun plugins på dine egne konti.");
  });

  test("site request link", () => {
    const html = render(data);
    expect(html).toContain('<a href="https://github.com/hoaj/plugins/issues/new?labels=site-request&amp;title=Site-%C3%B8nske%3A%20">Foreslå det</a>');
    expect(SITE_REQUEST_URL).toContain("labels=site-request");
  });

  test("every link is relative or absolute https; none is root-relative", () => {
    const real = render({ ...loadData(ROOT), statusUpdated: "2026-10-18T05:20:00Z" });
    const hrefs = [...real.matchAll(/\shref="([^"]*)"/g)].map((m) => m[1]);
    expect(hrefs.length).toBeGreaterThan(8);
    for (const h of hrefs) expect(h).toMatch(/^(#|\.\/|https:\/\/|data:image\/svg\+xml)/);
    expect(real).not.toContain('href="/"');
    expect(real).toContain('class="wordmark" href="./"');
  });

  test("head: title, description, canonical and og:url from siteUrl, Geist, favicon, themes", () => {
    const html = render(data);
    expect(html).toContain("<title>hoaj/plugins</title>");
    expect(html).toContain(
      '<meta name="description" content="Plugins til Claude Code, Copilot CLI og Cursor, der lader din AI-agent bruge websites for dig.">',
    );
    expect(html).toContain(`<link rel="canonical" href="${SITE_URL_DEFAULT}">`);
    expect(html).toContain(`<meta property="og:url" content="${SITE_URL_DEFAULT}">`);
    const custom = render({ ...data, siteUrl: "https://agentplugins.dk/" });
    expect(custom).toContain('<link rel="canonical" href="https://agentplugins.dk/">');
    expect(custom).toContain('<meta property="og:url" content="https://agentplugins.dk/">');
    expect(html).toContain("family=Geist:wght@400;500;600");
    expect(html).toContain("family=Geist+Mono");
    expect(html).toContain('<link rel="icon" href="data:image/svg+xml,');
    expect(html).toContain(':root:not([data-theme="light"])');
    expect(html).toContain(':root[data-theme="dark"]');
    expect(html).toContain("background:var(--paper)");
  });

  test("copy buttons are announced through aria-live", () => {
    const html = render(data);
    expect(html).toContain('id="live" class="sr" aria-live="polite"');
    expect(html).toContain("Kopieret");
  });

  test("escapes HTML in descriptions, prompts and the demo", () => {
    const evil: Plugin = {
      ...demo,
      description: `<script>alert("x")</script> & 'y'`,
      prompts: ["<b>hej</b>"],
      demo: { prompt: "<i>p</i>", command: "<u>c</u>", answer: "<s>a</s>" },
    };
    const html = render({ marketplace: "hoaj", plugins: [evil] });
    expect(html).not.toContain("<script>alert");
    expect(html).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;y&#39;");
    expect(html).toContain("&lt;b&gt;hej&lt;/b&gt;");
    expect(html).not.toContain("<b>hej</b>");
    expect(html).not.toContain("<i>p</i>");
    expect(html).toContain("&lt;u&gt;c&lt;/u&gt;");
    expect(html).toContain("&lt;s&gt;a&lt;/s&gt;");
  });
});

describe("loadData", () => {
  test("the local plugins load with a version and their command tables", () => {
    const real = loadData(ROOT);
    expect(real.plugins.map((p) => p.name).sort()).toEqual(["logbuy", "totalkredit", "yousee"]);
    const byName = (name: string) => real.plugins.find((p) => p.name === name)!;
    for (const [name, command] of [["logbuy", "logbuy deal search"], ["totalkredit", "totalkredit fixed-rate list"], ["yousee", "yousee bill list"]] as const) {
      const plugin = byName(name);
      expect(plugin.version).toMatch(/^\d+\.\d+\.\d+$/);
      expect(plugin.cliSkills.map((s) => s.name)).toEqual([name]);
      expect(plugin.cliSkills[0].commands.map((c) => c.command)).toContain(command);
    }
  });

  test("parseCommands reads the commands table", () => {
    const md = "x\n<!-- commands:start -->\n| Command | Flags | Does |\n|---|---|---|\n| `a b` | `--q <q>` x<br>y | Does A |\n| `c` |  | Does C |\n<!-- commands:end -->\n";
    expect(parseCommands(md)).toEqual([
      { command: "a b", does: "Does A" },
      { command: "c", does: "Does C" },
    ]);
    expect(parseCommands("no table")).toEqual([]);
  });
});

const run = (result: StatusRun["result"], day: number, extra: Partial<StatusRun> = {}): StatusRun => ({
  at: `2026-10-${String(day).padStart(2, "0")}T05:19:02Z`,
  result,
  ...extra,
});
const series = (...results: StatusRun["result"][]) => results.map((r, i) => run(r, i + 1));

describe("pluginHealth", () => {
  test("no status data -> unchecked", () => {
    expect(pluginHealth(undefined).health).toBe("unchecked");
    expect(pluginHealth({ demo: [] }).health).toBe("unchecked");
  });

  test("latest counted drift or error -> drift, even with an uncounted run after it", () => {
    expect(pluginHealth({ demo: series("ok", "ok", "ok", "drift") }).health).toBe("drift");
    expect(pluginHealth({ demo: series("ok", "ok", "error", "network") }).health).toBe("drift");
  });

  test("drift/error among the last 14 counted runs -> unstable", () => {
    expect(pluginHealth({ demo: series("ok", "drift", "ok", "ok") }).health).toBe("unstable");
  });

  test("drift older than the last 14 counted runs is forgotten -> stable", () => {
    const runs = series("drift", ...Array<StatusRun["result"]>(14).fill("ok"));
    expect(pluginHealth({ demo: runs }).health).toBe("stable");
  });

  test("3 or more counted runs, all ok -> stable; fewer -> new", () => {
    expect(pluginHealth({ demo: series("ok", "ok", "ok") }).health).toBe("stable");
    expect(pluginHealth({ demo: series("ok", "no-session", "ok") }).health).toBe("new");
    expect(pluginHealth({ demo: series("ok") }).health).toBe("new");
  });

  test("worst skill wins across skills", () => {
    expect(pluginHealth({ a: series("ok", "ok", "ok"), b: series("ok", "drift") }).health).toBe("drift");
    expect(pluginHealth({ a: series("ok", "ok", "ok"), b: series("ok") }).health).toBe("new");
  });

  test("latest run uncounted -> muted note per reason", () => {
    const note = (r: StatusRun["result"]) => pluginHealth({ demo: series("ok", "ok", "ok", r) }).notes;
    expect(note("session")).toEqual(["Ikke tjekket i dag: CI-sessionen er udløbet"]);
    expect(note("no-session")).toEqual(["Ikke tjekket i dag: ingen CI-session sat op"]);
    expect(note("install")).toEqual(["Ikke tjekket i dag: binæren kunne ikke hentes"]);
    expect(note("network")).toEqual(["Ikke tjekket i dag: sitet svarede ikke"]);
    expect(note("ok")).toEqual([]);
    expect(pluginHealth({ demo: series("ok", "ok", "ok", "network") }).health).toBe("stable");
  });
});

describe("status rendering", () => {
  const withStatus = (runs: StatusRun[]): SiteData => ({
    marketplace: "hoaj",
    statusUpdated: "2026-10-18T04:19:00Z",
    plugins: [{ ...demo, status: { demo: runs } }],
  });

  test("dot, word, strip of at most 30 bars, last check and drift issue link; no legend", () => {
    const runs = Array.from({ length: 35 }, (_, i) => ({
      at: new Date(Date.UTC(2026, 8, 1 + i, 5, 19)).toISOString(),
      result: "ok" as const,
    }));
    runs.push({ at: "2026-10-17T05:19:02Z", result: "drift", issues: [12], run: "https://example.test/run/9" } as never);
    const c = articleOf(render(withStatus(runs)), "demo");
    expect(c).toContain('<span class="sword">Drift</span>');
    expect(c).toContain('class="status h-drift"');
    expect(c.match(/<li class="m r-/g)?.length).toBe(30);
    expect(c).toContain('title="17. okt. 2026: drift"');
    expect(c).toContain('<span class="sr">17. okt. 2026: drift</span>');
    expect(c).not.toContain("legend");
    expect(c).toContain('<a href="https://example.test/run/9">tjekket <time datetime="2026-10-17T05:19:02Z">17. okt. 07:19</time></a>');
    expect(c).toContain('href="https://github.com/hoaj/plugins/issues/12">#12</a>');
  });

  test("words follow the health rules", () => {
    const article = (runs: StatusRun[]) => articleOf(render(withStatus(runs)), "demo");
    expect(article(series("ok", "ok", "ok"))).toContain('<span class="sword">Stabil</span>');
    expect(article(series("ok", "drift", "ok", "ok"))).toContain('<span class="sword">Ustabil</span>');
    expect(article(series("ok"))).toContain('<span class="sword">Ny</span>');
  });

  test("without status data the word is Ikke tjekket and there is no strip", () => {
    const c = articleOf(render(data), "demo");
    expect(c).toContain('<span class="sword">Ikke tjekket</span>');
    expect(c).not.toContain('<ol class="strip"');
  });

  test("not-checked note is a tooltip and hidden text, not visible prose", () => {
    const c = articleOf(render(withStatus(series("ok", "ok", "ok", "network"))), "demo");
    expect(c).toContain('title="Ikke tjekket i dag: sitet svarede ikke"');
    expect(c).toContain('<span class="sr">Ikke tjekket i dag: sitet svarede ikke</span>');
    expect(c).toContain('<span class="sword">Stabil</span>');
  });
});

describe("status file", () => {
  test("missing status file: loadData has no status and the site still builds", () => {
    const real = loadData(ROOT, { statusFile: join(tmpdir(), "does-not-exist-status.json") });
    expect(real.statusUpdated).toBeUndefined();
    expect(real.plugins.every((p) => p.status === undefined)).toBe(true);
    expect(render(real)).toContain('<span class="sword">Ikke tjekket</span>');
  });

  test("status file is read for local CLI skills and unknown results are dropped", () => {
    const dir = mkdtempSync(join(tmpdir(), "plugins-status-"));
    try {
      const file = join(dir, "status.json");
      writeFileSync(
        file,
        JSON.stringify({
          updated: "2026-10-17T05:20:00Z",
          plugins: {
            logbuy: { skills: { logbuy: { runs: [run("ok", 2), run("ok", 1), { at: "2026-10-03T00:00:00Z", result: "weird" }] } } },
            bank: { skills: { bank: { runs: [run("drift", 1)] } } },
          },
        }),
      );
      const real = loadData(ROOT, { statusFile: file });
      expect(real.statusUpdated).toBe("2026-10-17T05:20:00Z");
      expect(real.plugins.find((p) => p.name === "logbuy")?.status?.logbuy.map((r) => r.at)).toEqual([
        run("ok", 1).at,
        run("ok", 2).at,
      ]);
      expect(real.plugins.find((p) => p.name === "bank")).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("statusFileArg: --status, --status=, STATUS_FILE", () => {
    expect(statusFileArg(["--status", "a.json"], {})).toBe("a.json");
    expect(statusFileArg(["--status=b.json"], { STATUS_FILE: "c.json" })).toBe("b.json");
    expect(statusFileArg([], { STATUS_FILE: "c.json" })).toBe("c.json");
    expect(statusFileArg([], {})).toBeUndefined();
  });
});

describe("build", () => {
  test("writes index.html and .nojekyll, and no CNAME without a custom domain", () => {
    const out = mkdtempSync(join(tmpdir(), "plugins-site-"));
    try {
      build(ROOT, out);
      expect(existsSync(join(out, "CNAME"))).toBe(false);
      expect(existsSync(join(out, ".nojekyll"))).toBe(true);
      const html = readFileSync(join(out, "index.html"), "utf8");
      expect(html).toContain("<title>hoaj/plugins</title>");
      expect(html).toContain(`<link rel="canonical" href="${SITE_URL_DEFAULT}">`);
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });

  test("CNAME is written only with a custom domain; canonical uses siteUrl", () => {
    const out = mkdtempSync(join(tmpdir(), "plugins-site-"));
    try {
      build(ROOT, out, { customDomain: "agentplugins.dk", siteUrl: "https://agentplugins.dk/" });
      expect(readFileSync(join(out, "CNAME"), "utf8").trim()).toBe("agentplugins.dk");
      expect(readFileSync(join(out, "index.html"), "utf8")).toContain('<link rel="canonical" href="https://agentplugins.dk/">');
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });
});
