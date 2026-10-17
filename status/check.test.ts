import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkSkill, classify, discover, fileIssues, fixedIn, isolatedEnv, MAX_RUNS, planIssues, record, secretName, sessionText, type Exec, type Skill, type Status } from "./check";

const tmp = mkdtempSync(join(tmpdir(), "status-check-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const SKILL: Skill = { plugin: "shop", skill: "shop", dir: "/x", version: "1.2.3", auth: "login" };
const FP = "shop:shop:listOrders:changed-type:items[].price:invalid_type";

describe("discover", () => {
  test("finds CLI skills with install.sh and site.ts, reading plugin, skill, version and auth", () => {
    const root = join(tmp, "repo");
    const skill = join(root, "plugins", "shop", "skills", "shop");
    mkdirSync(join(skill, "cli", "src"), { recursive: true });
    writeFileSync(join(skill, "install.sh"), "");
    writeFileSync(join(skill, "cli", "src", "site.ts"), 'export default defineSite({\n  plugin: "shop",\n  skill: "shop",\n  version: "1.2.3",\n  auth: "login" as Auth,\n});\n');
    mkdirSync(join(root, "plugins", "shop", "skills", "shop-feedback"), { recursive: true });
    expect(discover(root)).toEqual([{ plugin: "shop", skill: "shop", dir: skill, version: "1.2.3", auth: "login" }]);
  });

  test("the real repo: logbuy is a login skill", () => {
    const found = discover(join(import.meta.dir, ".."));
    expect(found.find((s) => s.skill === "logbuy")).toMatchObject({ plugin: "logbuy", auth: "login" });
  });
});

test("secretName and sessionText", () => {
  expect(secretName({ plugin: "my-shop", skill: "my-shop" })).toBe("SESSION_MY_SHOP_MY_SHOP");
  expect(sessionText('{"cookies":[]}')).toBe('{"cookies":[]}');
  expect(sessionText(Buffer.from('{"cookies":[]}').toString("base64"))).toBe('{"cookies":[]}');
  expect(sessionText("")).toBeNull();
  expect(sessionText("not a session")).toBeNull();
});

describe("classify", () => {
  test("exit 0 is ok, counting ok Operations and warnings", () => {
    const o = classify(0, JSON.stringify({ ok: false, operations: [{ status: "ok" }, { status: "ok" }, { status: "skipped" }], warnings: ["x"] }));
    expect(o).toEqual({ result: "ok", detail: "2 Operation(s) ok, 1 not checkable", drifts: [] });
  });

  test("exit 3 is drift with every Fingerprint", () => {
    const o = classify(3, JSON.stringify({ error: { kind: "drift", message: "m", drifts: [{ operation: "listOrders", fingerprint: FP, diff: [{ path: "items[].price" }] }] } }));
    expect(o.result).toBe("drift");
    expect(o.drifts.map((d) => d.fingerprint)).toEqual([FP]);
  });

  test.each([
    [4, "session", "session"],
    [5, "network", "network"],
    [1, "bug", "error"],
    [2, "input", "error"],
  ])("exit %i (%s) → %s", (code, kind, result) => {
    expect(classify(code as number, JSON.stringify({ error: { kind, message: "m" } })).result).toBe(result as string);
  });

  test("a crash with no JSON is an error", () => {
    expect(classify(139, "Segmentation fault")).toMatchObject({ result: "error", kind: "bug" });
  });
});

describe("planIssues", () => {
  const drift = classify(3, JSON.stringify({ error: { kind: "drift", drifts: [{ operation: "listOrders", fingerprint: FP, diff: [{ path: "items[].price", expected: "number", received: "string" }] }] } }));

  test("drift: titled with the Fingerprint exactly, labels drift + plugin, type-only diff in the body", () => {
    const [p] = planIssues(SKILL, drift, [], "https://run/1");
    expect(p).toMatchObject({ title: FP, labels: ["drift", "shop"] });
    expect(p!.existing).toBeUndefined();
    expect(p!.body).toContain('"received": "string"');
    expect(p!.body).toContain("Run: https://run/1");
  });

  test("an open issue with the same title is reused, not filed again", () => {
    expect(planIssues(SKILL, drift, [{ number: 7, title: FP, state: "OPEN" }], undefined)[0]!.existing).toBe(7);
  });

  test("a closed one whose fix shipped at or below this version: a new issue that links it (it came back)", () => {
    const [p] = planIssues(SKILL, drift, [], undefined, [{ number: 3, title: FP, state: "CLOSED", labels: [{ name: "fixed-in:shop-v1.2.0" }] }]);
    expect(p!.existing).toBeUndefined();
    expect(p!.body).toContain("reported before in #3");
  });

  test("a closed one whose fix is merged but not released (no fixed-in) stands for it: nothing new", () => {
    expect(planIssues(SKILL, drift, [], undefined, [{ number: 3, title: FP, state: "CLOSED", labels: [] }])[0]!.existing).toBe(3);
  });

  test("a closed one fixed in a newer version than the one checked stands for it", () => {
    expect(planIssues(SKILL, drift, [], undefined, [{ number: 4, title: FP, state: "CLOSED", labels: [{ name: "fixed-in:shop-v1.3.0" }] }])[0]!.existing).toBe(4);
  });

  test("fixedIn reads only this plugin's labels", () => {
    expect(fixedIn({ number: 1, title: "", state: "CLOSED", labels: [{ name: "fixed-in:other-v9.0.0" }, { name: "fixed-in:shop-v1.0.1" }] }, "shop")).toBe("1.0.1");
    expect(fixedIn({ number: 1, title: "", state: "CLOSED", labels: [{ name: "fixed-in:v2.0.0" }] }, "shop")).toBe("2.0.0");
    expect(fixedIn({ number: 1, title: "", state: "CLOSED", labels: [{ name: "drift" }] }, "shop")).toBeNull();
  });

  test("session: a ci-session issue that says how to renew the secret", () => {
    const [p] = planIssues(SKILL, classify(4, JSON.stringify({ error: { kind: "session" } })), [], undefined, [], "acme/plugins");
    expect(p!.labels).toEqual(["ci-session", "shop"]);
    expect(p!.body).toContain("gh secret set SESSION_SHOP_SHOP --repo acme/plugins");
    expect(p!.body).toContain("~/.shop/session.json");
  });

  test("ok, network, no-session and install file nothing", () => {
    for (const result of ["ok", "network", "no-session", "install"] as const) {
      expect(planIssues(SKILL, { result, detail: "", drifts: [] }, [], undefined)).toEqual([]);
    }
  });
});

test("record keeps the newest MAX_RUNS runs per skill", () => {
  let s: Status = { plugins: {} };
  for (let i = 0; i < MAX_RUNS + 5; i++) s = record(s, SKILL, { at: `t${i}`, result: "ok", version: "1", issues: [], detail: "" }, `t${i}`);
  const runs = s.plugins.shop!.skills.shop!.runs;
  expect(runs.length).toBe(MAX_RUNS);
  expect(runs.at(-1)!.at).toBe(`t${MAX_RUNS + 4}`);
  expect(s.updated).toBe(`t${MAX_RUNS + 4}`);
});

describe("checkSkill", () => {
  const calls: string[][] = [];
  const exec = (answers: Record<string, { code: number; stdout?: string }>): Exec => (cmd, opts) => {
    calls.push(cmd);
    expect(opts?.isolated).toBe(true);
    if (cmd[0] === "bash") return { code: answers.install?.code ?? 0, stdout: "", stderr: "install.sh: release logbuy-v9 still being built" };
    expect(opts!.env!.SITE_CLI_NONINTERACTIVE).toBe("1");
    const session = readFileSync(join(opts!.env!.SITE_CLI_HOME!, "session.json"), "utf8");
    expect(session).toBe('{"cookies":[]}');
    return { code: answers.check!.code, stdout: answers.check!.stdout ?? "", stderr: "" };
  };

  test("a login skill without its secret is not checked", () => {
    expect(checkSkill(SKILL, {}, exec({})).result).toBe("no-session");
  });

  test("a failed install is recorded as install", () => {
    expect(checkSkill(SKILL, {}, exec({ install: { code: 1 } }))).toMatchObject({ result: "install", detail: "install.sh: release logbuy-v9 still being built" });
  });

  test("the session goes into a temp SITE_CLI_HOME and check runs read-only", () => {
    calls.length = 0;
    const o = checkSkill(SKILL, { SESSION_SHOP_SHOP: '{"cookies":[]}' }, exec({ check: { code: 0, stdout: '{"ok":true,"operations":[]}' } }));
    expect(o.result).toBe("ok");
    expect(calls.at(-1)).toEqual(["/x/bin/shop", "check"]);
  });
});

test("isolatedEnv drops the job's secrets and keeps the rest", () => {
  expect(isolatedEnv({ PATH: "/bin", HOME: "/h", SECRETS_JSON: "{}", GH_TOKEN: "t", GITHUB_TOKEN: "t", SESSION_SHOP_SHOP: "s", X: undefined })).toEqual({ PATH: "/bin", HOME: "/h" });
});

test("fileIssues opens only what is not open yet and returns every number", () => {
  const opened: string[][] = [];
  const exec: Exec = (cmd) => {
    opened.push(cmd);
    return { code: 0, stdout: "https://github.com/hoaj/plugins/issues/42\n", stderr: "" };
  };
  const n = fileIssues([{ title: "a", labels: ["drift", "shop"], body: "b", existing: 7 }, { title: "c", labels: ["drift", "shop"], body: "d" }], "hoaj/plugins", exec, false, () => {});
  expect(n).toEqual([7, 42]);
  expect(opened).toEqual([["gh", "issue", "create", "--repo", "hoaj/plugins", "--title", "c", "--body-file", "-", "--label", "drift", "--label", "shop"]]);
});
