import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  build,
  loadData,
  normalizeRepo,
  parseCommands,
  pluginHealth,
  render,
  statusFileArg,
  type Plugin,
  type SiteData,
  type StatusRun,
} from "./build";

const ROOT = resolve(import.meta.dir, "..");

const siteCli: Plugin = {
  name: "demo",
  description: "Demo site CLI.",
  category: "shopping",
  kind: "site-cli",
  local: true,
  version: "1.2.3",
  repo: "hoaj/plugins",
  path: "plugins/demo",
  cursorMarketplace: "hoaj/plugins",
  cliSkills: [{ name: "demo", commands: [{ command: "demo item list", does: "Lists items" }] }],
};

const external: Plugin = {
  name: "bank",
  description: "Bank plugin.",
  kind: "external",
  local: false,
  repo: "noskillish/bankmcp",
  path: "plugin",
  homepage: "https://github.com/noskillish/bankmcp",
  cliSkills: [],
};

const data: SiteData = { marketplace: "hoaj", plugins: [siteCli, external] };

/** Text of the HTML between the opening tag of the element with `id` and the next </article>. */
function cardOf(html: string, id: string): string {
  const start = html.indexOf(`<article class="card" id="${id}"`);
  expect(start).toBeGreaterThan(-1);
  return html.slice(start, html.indexOf("</article>", start));
}

describe("render", () => {
  test("includes every marketplace plugin by name", () => {
    const real = loadData(ROOT);
    const market = JSON.parse(readFileSync(join(ROOT, ".claude-plugin/marketplace.json"), "utf8"));
    const html = render(real);
    expect(real.plugins.map((p) => p.name)).toEqual(market.plugins.map((p: { name: string }) => p.name));
    for (const p of market.plugins) {
      expect(html).toContain(`id="h-${p.name}"`);
      expect(html).toContain(`>${p.name}</a></h2>`);
    }
  });

  test("local plugin: install commands from hoaj/plugins, Cursor via hoaj/plugins, issues link", () => {
    const c = cardOf(render(data), "demo");
    expect(c).toContain("/plugin marketplace add hoaj/plugins");
    expect(c).toContain("/plugin install demo@hoaj");
    expect(c).toContain("copilot plugin marketplace add hoaj/plugins");
    expect(c).toContain("copilot plugin install demo@hoaj");
    expect(c).toMatch(/data-client="cursor"[\s\S]*<code>hoaj\/plugins<\/code>/);
    expect(c).toContain("https://github.com/hoaj/plugins/issues?q=is%3Aopen+label%3Ademo");
    expect(c).toContain("https://github.com/hoaj/plugins/tree/main/plugins/demo");
    expect(c).toContain("v1.2.3");
  });

  test("external plugin: Claude and Copilot via hoaj, homepage link, not in Cursor without a Cursor marketplace", () => {
    const c = cardOf(render(data), "bank");
    expect(c).toContain("/plugin install bank@hoaj");
    expect(c).toContain("copilot plugin install bank@hoaj");
    expect(c).toContain("bank findes ikke til Cursor endnu");
    expect(c).not.toContain("<code>noskillish/bankmcp</code>");
    expect(c).toContain('href="https://github.com/noskillish/bankmcp"');
    expect(c).not.toContain("/issues?q=");
  });

  test("external plugin with its own Cursor marketplace: Cursor via its repo", () => {
    const c = cardOf(render({ marketplace: "hoaj", plugins: [{ ...external, name: "gen", cursorMarketplace: "hoaj/site-cli-creator" }] }), "gen");
    expect(c).toMatch(/data-client="cursor"[\s\S]*<code>hoaj\/site-cli-creator<\/code>/);
    expect(c).toContain("Cursor henter dette plugin fra dets eget repo");
  });

  test("MCP snippet only for site CLIs", () => {
    const html = render(data);
    const demo = cardOf(html, "demo");
    expect(demo).toContain("Brug som MCP-server");
    expect(demo).toContain("bash plugins/demo/skills/demo/install.sh");
    expect(demo).toContain("/sti/til/plugins/plugins/demo/skills/demo/bin/demo");
    expect(demo).toContain("&quot;mcpServers&quot;");
    expect(demo).toContain("&quot;args&quot;: [\n        &quot;mcp&quot;\n      ]");
    expect(demo).toContain("claude mcp add demo -- /sti/til/plugins/plugins/demo/skills/demo/bin/demo mcp");
    expect(cardOf(html, "bank")).not.toContain("MCP-server");
    expect(html.match(/class="mcp"/g)?.length).toBe(1);
  });

  test("escapes HTML in descriptions", () => {
    const evil: Plugin = { ...external, name: "evil", description: `<script>alert("x")</script> & 'y'` };
    const html = render({ marketplace: "hoaj", plugins: [evil] });
    expect(html).not.toContain("<script>alert");
    expect(html).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;y&#39;");
  });
});

describe("loadData", () => {
  test("logbuy is a local site CLI with a version, the others are external", () => {
    const real = loadData(ROOT);
    const logbuy = real.plugins.find((p) => p.name === "logbuy");
    expect(logbuy?.kind).toBe("site-cli");
    expect(logbuy?.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(logbuy?.cliSkills.map((s) => s.name)).toEqual(["logbuy"]);
    expect(real.plugins.find((p) => p.name === "site-cli-creator")).toMatchObject({
      kind: "generator",
      local: false,
      cursorMarketplace: "hoaj/site-cli-creator",
    });
    expect(real.plugins.find((p) => p.name === "bank")?.cursorMarketplace).toBeUndefined();
  });

  test("parseCommands reads the commands table", () => {
    const md = "x\n<!-- commands:start -->\n| Command | Flags | Does |\n|---|---|---|\n| `a b` | `--q <q>` x<br>y | Does A |\n| `c` |  | Does C |\n<!-- commands:end -->\n";
    expect(parseCommands(md)).toEqual([
      { command: "a b", does: "Does A" },
      { command: "c", does: "Does C" },
    ]);
    expect(parseCommands("no table")).toEqual([]);
  });

  test("normalizeRepo", () => {
    expect(normalizeRepo("https://github.com/a/b.git")).toBe("a/b");
    expect(normalizeRepo("a/b")).toBe("a/b");
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
    statusUpdated: "2026-10-17T05:20:00Z",
    plugins: [{ ...siteCli, status: { demo: runs } }, external],
  });

  test("card shows badge, explanation, strip of at most 30 marks, last check and drift issues link", () => {
    const runs = Array.from({ length: 35 }, (_, i) => ({
      at: new Date(Date.UTC(2026, 8, 1 + i, 5, 19)).toISOString(),
      result: "ok" as const,
    }));
    runs.push({ at: "2026-10-17T05:19:02Z", result: "drift", issues: [12], run: "https://example.test/run/9" } as never);
    const c = cardOf(render(withStatus(runs)), "demo");
    expect(c).toContain(">Drift fundet</span>");
    expect(c.match(/<li class="m r-/g)?.length).toBe(30);
    expect(c).toContain('title="17. okt. 2026: drift"');
    expect(c).toContain('<a href="https://example.test/run/9"><time datetime="2026-10-17T05:19:02Z">');
    expect(c).toContain('href="https://github.com/hoaj/plugins/issues/12">#12</a>');
    expect(c).toContain("https://github.com/hoaj/plugins/issues?q=is%3Aopen+label%3Adrift+label%3Ademo");
  });

  test("intro summarises stable plugins and the last check date", () => {
    const html = render(withStatus(series("ok", "ok", "ok")));
    expect(html).toContain("1 af 1 plugins kører stabilt</a> · sidst tjekket 17. okt. 2026");
  });

  test("site CLI without status data says it is not checked yet", () => {
    const c = cardOf(render(data), "demo");
    expect(c).toContain(">Endnu ikke tjekket</span>");
    expect(c).not.toContain('<ol class="strip"');
  });

  test("plugin without CLI skills shows no status", () => {
    const html = render(withStatus(series("drift")));
    const bank = cardOf(html, "bank");
    expect(bank).not.toContain('class="status');
    expect(bank).not.toContain("Dagligt tjek");
  });
});

describe("status file", () => {
  test("missing status file: loadData has no status and the site still builds", () => {
    const real = loadData(ROOT, { statusFile: join(tmpdir(), "does-not-exist-status.json") });
    expect(real.statusUpdated).toBeUndefined();
    expect(real.plugins.every((p) => p.status === undefined)).toBe(true);
    expect(render(real)).toContain(">Endnu ikke tjekket</span>");
  });

  test("status file is read for local CLI skills and unknown results are dropped", () => {
    const dir = mkdtempSync(join(tmpdir(), "agentplugins-status-"));
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
      expect(real.plugins.find((p) => p.name === "bank")?.status).toBeUndefined();
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
  test("writes index.html, CNAME and .nojekyll", () => {
    const out = mkdtempSync(join(tmpdir(), "agentplugins-"));
    try {
      build(ROOT, out);
      expect(readFileSync(join(out, "CNAME"), "utf8").trim()).toBe("agentplugins.dk");
      expect(existsSync(join(out, ".nojekyll"))).toBe(true);
      expect(readFileSync(join(out, "index.html"), "utf8")).toContain("<title>agentplugins.dk</title>");
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });
});
