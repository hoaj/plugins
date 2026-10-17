// bun status/check.ts --data <status.json> [--root .] [--repo hoaj/plugins] [--run-url <url>] [--dry-run]
//
// The daily drift check (.github/workflows/drift-check.yml). For every CLI skill under
// plugins/*/skills/*: install the released binary with the skill's own install.sh, run its
// read-only `check` (never --writes: the check must not touch anyone's account), record the
// result in status.json (kept on the `status` branch, read by the catalog site) and open an
// issue the maintainer can act on:
//
//   exit 3 (drift)    one issue per Fingerprint, titled with the Fingerprint exactly, labels
//                     drift + <plugin>: the same title the plugin's Feedback skill writes, so a
//                     user's report and the daily check never file the same Drift twice
//                     (and, like it, a closed one counts while its fix is not released)
//   exit 1/2 (error)  "check: <plugin>:<skill>: the daily check failed (<kind>)", labels bug + <plugin>
//   exit 4 (session)  "ci-session: <plugin>:<skill>: …", label ci-session: the CI session expired
//   exit 5 (network)  recorded only
//
// A login skill is checked only when the secret SESSION_<PLUGIN>_<SKILL> holds its session.json
// (raw JSON or base64); the workflow passes all secrets as SECRETS_JSON. The check's output
// carries shapes and type names only, never site values, and this script prints none of it
// beyond the Fingerprints and type-only diffs the issues hold.
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

export type Result = "ok" | "drift" | "error" | "session" | "no-session" | "network" | "install";
export type Run = { at: string; result: Result; version: string; run?: string; issues: number[]; detail: string };
export type Status = { updated?: string; plugins: Record<string, { skills: Record<string, { runs: Run[] }> }> };
export type Skill = { plugin: string; skill: string; dir: string; version: string; auth: "login" | "none" };
export type Drift = { operation: string; fingerprint: string; diff: unknown[] };
export type Outcome = { result: Result; detail: string; drifts: Drift[]; kind?: string };
export type Issue = { number: number; title: string; state: "OPEN" | "CLOSED"; labels?: { name: string }[] };
/** `isolated`: the child sees none of this job's secrets (SECRETS_JSON, SESSION_*, GH_TOKEN, GITHUB_TOKEN). */
export type Exec = (cmd: string[], opts?: { cwd?: string; env?: Record<string, string>; stdin?: string; timeoutMs?: number; isolated?: boolean }) => { code: number; stdout: string; stderr: string };

export const MAX_RUNS = 60;

/** Every CLI skill in the repo: a skills/<skill>/ folder with install.sh and cli/src/site.ts. */
export function discover(root: string): Skill[] {
  const out: Skill[] = [];
  const pluginsDir = join(root, "plugins");
  if (!existsSync(pluginsDir)) return out;
  for (const plugin of readdirSync(pluginsDir).sort()) {
    const skillsDir = join(pluginsDir, plugin, "skills");
    if (!existsSync(skillsDir)) continue;
    for (const skill of readdirSync(skillsDir).sort()) {
      const dir = join(skillsDir, skill);
      const site = join(dir, "cli", "src", "site.ts");
      if (!existsSync(join(dir, "install.sh")) || !existsSync(site)) continue;
      const src = readFileSync(site, "utf8");
      const field = (name: string) => new RegExp(`^\\s*${name}:\\s*"([^"]+)"`, "m").exec(src)?.[1];
      out.push({
        plugin: field("plugin") ?? plugin,
        skill: field("skill") ?? skill,
        dir,
        version: field("version") ?? "unknown",
        auth: field("auth") === "login" ? "login" : "none",
      });
    }
  }
  return out;
}

/** The secret that holds a login skill's CI session: SESSION_<PLUGIN>_<SKILL>, upper case. */
export function secretName(s: Pick<Skill, "plugin" | "skill">): string {
  return `SESSION_${s.plugin}_${s.skill}`.toUpperCase().replace(/[^A-Z0-9_]/g, "_");
}

/** session.json text from a secret holding the raw JSON or its base64. Null when it is neither. */
export function sessionText(secret: string | undefined): string | null {
  if (!secret || !secret.trim()) return null;
  const raw = secret.trim();
  if (raw.startsWith("{")) return raw;
  try {
    const decoded = Buffer.from(raw, "base64").toString("utf8").trim();
    return decoded.startsWith("{") ? decoded : null;
  } catch {
    return null;
  }
}

/** What one `check` run means, from its exit code and its stdout (one JSON document). */
export function classify(code: number, stdout: string): Outcome {
  let doc: any = null;
  try {
    doc = JSON.parse(stdout);
  } catch {
    // a crash before the envelope: handled as an error below
  }
  const err = doc?.error;
  if (code === 0 && doc && !err) {
    const ops = Array.isArray(doc.operations) ? doc.operations : [];
    const ok = ops.filter((o: { status?: string }) => o.status === "ok").length;
    const warnings = Array.isArray(doc.warnings) ? doc.warnings.length : 0;
    return { result: "ok", detail: `${ok} Operation(s) ok${warnings ? `, ${warnings} not checkable` : ""}`, drifts: [] };
  }
  const kind: string = err?.kind ?? (code === 3 ? "drift" : code === 4 ? "session" : code === 5 ? "network" : "bug");
  if (kind === "drift") {
    const drifts: Drift[] = (Array.isArray(err?.drifts) ? err.drifts : []).filter((d: Drift) => d?.fingerprint);
    if (drifts.length === 0 && err?.fingerprint) drifts.push({ operation: "", fingerprint: err.fingerprint, diff: err.diff ?? [] });
    return { result: "drift", detail: `${drifts.length} Operation(s) drifted: ${drifts.map((d) => d.operation || d.fingerprint).join(", ")}`, drifts, kind };
  }
  if (kind === "session") return { result: "session", detail: "the CI session is signed out or expired", drifts: [], kind };
  if (kind === "network") return { result: "network", detail: "the site did not answer", drifts: [], kind };
  return { result: "error", detail: `check failed (${kind}, exit ${code})`, drifts: [], kind };
}

export const errorTitle = (s: Skill, kind: string) => `check: ${s.plugin}:${s.skill}: the daily check failed (${kind})`;
export const sessionTitle = (s: Skill) => `ci-session: ${s.plugin}:${s.skill}: the daily check needs a new session`;

export type IssuePlan = { title: string; labels: string[]; body: string; existing?: number };

/** The version in a `fixed-in:<plugin>-vX.Y.Z` (or `fixed-in:vX.Y.Z`) label of this plugin, else null. */
export function fixedIn(issue: Issue, plugin: string): string | null {
  for (const { name } of issue.labels ?? []) {
    const m = /^fixed-in:(.*?)v(\d+\.\d+\.\d+)$/.exec(name);
    if (m && (m[1] === "" || m[1] === `${plugin}-`)) return m[2]!;
  }
  return null;
}

function newer(a: string, b: string): boolean {
  const pa = a.split(".").map(Number), pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i]! > pb[i]!;
  return false;
}

/**
 * The closed issue that already stands for this Drift, as the Feedback skill decides: one whose fix
 * is merged but not released yet (no fixed-in label), or released in a version newer than the one
 * checked. Null when every fix was released at or below that version: the Drift came back.
 */
export function pendingFix(closed: Issue[], s: Skill): Issue | null {
  for (const i of [...closed].sort((a, b) => b.number - a.number)) {
    const v = fixedIn(i, s.plugin);
    if (v === null || (s.version !== "unknown" && newer(v, s.version))) return i;
  }
  return null;
}

/**
 * The issues an outcome calls for. `existing` is set when an issue already stands for it: an open
 * one with that exact title, or (Drift) a closed one whose fix is not released at this version yet.
 */
export function planIssues(s: Skill, o: Outcome, open: Issue[], runUrl: string | undefined, closed: Issue[] = [], repo = "hoaj/plugins"): IssuePlan[] {
  const exact = (title: string) => open.find((i) => i.title === title && i.state === "OPEN")?.number;
  const run = runUrl ? `\n\nRun: ${runUrl}` : "";
  if (o.result === "drift") {
    return o.drifts.map((d) => {
      const same = closed.filter((i) => i.title === d.fingerprint);
      const back = same.length ? same.reduce((a, b) => (a.number > b.number ? a : b)) : undefined;
      return {
        title: d.fingerprint,
        labels: ["drift", s.plugin],
        existing: exact(d.fingerprint) ?? pendingFix(same, s)?.number,
        body: [
          `The daily check found Drift in \`${s.plugin}\` ${s.version}, skill \`${s.skill}\`${d.operation ? `, Operation \`${d.operation}\`` : ""}: the site changed away from the Contract.`,
          "",
          "Type-only diff (no site values):",
          "",
          "```json",
          JSON.stringify(d.diff ?? [], null, 2),
          "```",
          back ? `\nThis Drift was reported before in #${back.number} and has come back.` : "",
          "",
          "Fix it with site-cli-creator's `fix` mode. Filed by the daily drift check." + run,
        ].join("\n"),
      };
    });
  }
  if (o.result === "error") {
    const title = errorTitle(s, o.kind ?? "bug");
    return [{
      title,
      labels: ["bug", s.plugin],
      existing: exact(title),
      body: `The daily \`check\` of \`${s.plugin}\` ${s.version}, skill \`${s.skill}\`, failed with kind \`${o.kind}\` instead of passing or reporting Drift. Run it locally (\`bin/${s.skill} check\`) to see the envelope. Filed by the daily drift check.${run}`,
    }];
  }
  if (o.result === "session") {
    const title = sessionTitle(s);
    return [{
      title,
      labels: ["ci-session", s.plugin],
      existing: exact(title),
      body: [
        `The daily check of \`${s.plugin}\`, skill \`${s.skill}\`, could not sign in: its CI session expired or was signed out. Until it is renewed, the catalog shows the plugin as not checked.`,
        "",
        "To renew it, on the maintainer's machine:",
        "",
        "```sh",
        `bin/${s.skill} login                 # in plugins/${s.plugin}/skills/${s.skill}`,
        `gh secret set ${secretName(s)} --repo ${repo} < ~/.${s.plugin === s.skill ? s.plugin : `${s.plugin}-${s.skill}`}/session.json`,
        "```",
        "",
        "Then close this issue. Filed by the daily drift check." + run,
      ].join("\n"),
    }];
  }
  return [];
}

/** Adds one run to a skill's history, newest last, keeping the last MAX_RUNS. */
export function record(status: Status, s: Skill, run: Run, now: string): Status {
  const plugins = { ...status.plugins };
  const p = plugins[s.plugin] ?? { skills: {} };
  const runs = [...(p.skills[s.skill]?.runs ?? []), run].slice(-MAX_RUNS);
  plugins[s.plugin] = { skills: { ...p.skills, [s.skill]: { runs } } };
  return { updated: now, plugins };
}

/** This process's env without the job's secrets, for install.sh and the CLI. */
export function isolatedEnv(env: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined || k === "SECRETS_JSON" || k === "GH_TOKEN" || k === "GITHUB_TOKEN" || k.startsWith("SESSION_")) continue;
    out[k] = v;
  }
  return out;
}

const realExec: Exec = (cmd, opts = {}) => {
  const base = opts.isolated ? isolatedEnv(process.env) : process.env;
  const p = Bun.spawnSync(cmd, {
    cwd: opts.cwd,
    env: { ...base, ...(opts.env ?? {}) },
    stdin: opts.stdin !== undefined ? new TextEncoder().encode(opts.stdin) : "ignore",
    timeout: opts.timeoutMs,
  });
  return { code: p.exitCode ?? 1, stdout: p.stdout.toString(), stderr: p.stderr.toString() };
};

function lastLine(text: string): string {
  return text.trim().split("\n").filter(Boolean).pop()?.slice(0, 300) ?? "";
}

/** Installs and checks one skill. The session, if any, lives in a temp state dir removed afterwards. */
export function checkSkill(s: Skill, secrets: Record<string, string>, exec: Exec = realExec): Outcome {
  const install = exec(["bash", join(s.dir, "install.sh")], { timeoutMs: 300_000, isolated: true });
  if (install.code !== 0) return { result: "install", detail: lastLine(install.stderr) || "install.sh failed", drifts: [] };
  const state = mkdtempSync(join(tmpdir(), `check-${s.skill}-`));
  try {
    if (s.auth === "login") {
      const session = sessionText(secrets[secretName(s)]);
      if (!session) return { result: "no-session", detail: `no ${secretName(s)} secret`, drifts: [] };
      writeFileSync(join(state, "session.json"), session, { mode: 0o600 });
      chmodSync(join(state, "session.json"), 0o600);
    }
    const bin = join(s.dir, "bin", process.platform === "win32" ? `${s.skill}.exe` : s.skill);
    // No one can sign in on a runner: an expired session must end as kind "session", not open Chrome.
    const r = exec([bin, "check"], { env: { SITE_CLI_HOME: state, SITE_CLI_NONINTERACTIVE: "1" }, timeoutMs: 300_000, isolated: true });
    return classify(r.code, r.stdout);
  } finally {
    rmSync(state, { recursive: true, force: true });
  }
}

function ghIssues(exec: Exec, repo: string, title: string): Issue[] {
  const r = exec(["gh", "issue", "list", "--repo", repo, "--state", "all", "--limit", "50", "--search", `"${title}" in:title`, "--json", "number,title,state,labels"]);
  if (r.code !== 0) throw new Error(`gh issue list failed: ${lastLine(r.stderr)}`);
  return (JSON.parse(r.stdout) as Issue[]).filter((i) => i.title === title);
}

/** Opens the planned issues that are not open yet; returns every issue number the run stands for. */
export function fileIssues(plans: IssuePlan[], repo: string, exec: Exec, dryRun: boolean, log: (s: string) => void): number[] {
  const numbers: number[] = [];
  for (const p of plans) {
    if (p.existing) {
      numbers.push(p.existing);
      log(`  already filed: #${p.existing} ${p.title}`);
      continue;
    }
    if (dryRun) {
      log(`  would open: ${p.title} [${p.labels.join(", ")}]`);
      continue;
    }
    const args = ["gh", "issue", "create", "--repo", repo, "--title", p.title, "--body-file", "-"];
    for (const l of p.labels) args.push("--label", l);
    const r = exec(args, { stdin: p.body });
    if (r.code !== 0) throw new Error(`gh issue create failed: ${lastLine(r.stderr)}`);
    const n = Number(/\/issues\/(\d+)/.exec(r.stdout)?.[1]);
    if (n) numbers.push(n);
    log(`  opened: ${r.stdout.trim()}`);
  }
  return numbers;
}

function flag(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

export function main(argv: string[], exec: Exec = realExec): number {
  const data = flag(argv, "--data");
  if (!data) {
    console.error("usage: bun status/check.ts --data <status.json> [--root .] [--repo owner/name] [--run-url url] [--dry-run]");
    return 2;
  }
  const root = flag(argv, "--root") ?? ".";
  const repo = flag(argv, "--repo") ?? process.env.GITHUB_REPOSITORY ?? "hoaj/plugins";
  const runUrl = flag(argv, "--run-url");
  const dryRun = argv.includes("--dry-run");
  let secrets: Record<string, string> = {};
  try {
    secrets = JSON.parse(process.env.SECRETS_JSON || "{}");
  } catch {
    console.error("SECRETS_JSON is not JSON; checking without sessions");
  }
  for (const [k, v] of Object.entries(process.env)) if (k.startsWith("SESSION_") && v) secrets[k] = v;

  let status: Status = { plugins: {} };
  if (existsSync(data)) status = JSON.parse(readFileSync(data, "utf8"));
  const summary: string[] = ["| Plugin | Skill | Version | Result | Detail | Issues |", "|---|---|---|---|---|---|"];

  for (const s of discover(root)) {
    console.error(`${s.plugin}:${s.skill} ${s.version}`);
    const o = checkSkill(s, secrets, exec);
    console.error(`  ${o.result}: ${o.detail}`);
    let issues: number[] = [];
    if (["drift", "error", "session"].includes(o.result)) {
      // A GitHub failure must not lose the run: log it, record the result, go on.
      try {
        const titles = o.result === "drift" ? o.drifts.map((d) => d.fingerprint) : [o.result === "error" ? errorTitle(s, o.kind ?? "bug") : sessionTitle(s)];
        const found = titles.flatMap((t) => (dryRun ? [] : ghIssues(exec, repo, t)));
        const plans = planIssues(s, o, found.filter((i) => i.state === "OPEN"), runUrl, found.filter((i) => i.state === "CLOSED"), repo);
        issues = fileIssues(plans, repo, exec, dryRun, (l) => console.error(l));
      } catch (err) {
        console.error(`  issues not filed: ${(err as Error).message}`);
        o.detail += " (issue not filed: see the run log)";
      }
    }
    const now = new Date().toISOString();
    status = record(status, s, { at: now, result: o.result, version: s.version, ...(runUrl ? { run: runUrl } : {}), issues, detail: o.detail }, now);
    summary.push(`| ${s.plugin} | ${s.skill} | ${s.version} | ${o.result} | ${o.detail.replaceAll("|", "\\|")} | ${issues.map((n) => `#${n}`).join(" ")} |`);
  }

  mkdirSync(dirname(data), { recursive: true });
  writeFileSync(data, JSON.stringify(status, null, 2) + "\n");
  const out = process.env.GITHUB_STEP_SUMMARY;
  if (out) writeFileSync(out, `## Daily drift check\n\n${summary.join("\n")}\n`, { flag: "a" });
  console.error(summary.join("\n"));
  return 0;
}

if (import.meta.main) process.exit(main(process.argv.slice(2)));
