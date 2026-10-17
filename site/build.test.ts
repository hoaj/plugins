import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { build, loadData, normalizeRepo, parseCommands, render, type Plugin, type SiteData } from "./build";

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
  cursorMarketplace: "noskillish/bankmcp",
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

  test("external plugin: Claude and Copilot via hoaj, Cursor via its own repo, homepage link", () => {
    const c = cardOf(render(data), "bank");
    expect(c).toContain("/plugin install bank@hoaj");
    expect(c).toContain("copilot plugin install bank@hoaj");
    expect(c).toMatch(/data-client="cursor"[\s\S]*<code>noskillish\/bankmcp<\/code>/);
    expect(c).toContain('href="https://github.com/noskillish/bankmcp"');
    expect(c).not.toContain("/issues?q=");
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
    expect(real.plugins.find((p) => p.name === "bank")?.cursorMarketplace).toBe("noskillish/bankmcp");
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
