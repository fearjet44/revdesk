#!/usr/bin/env node
/**
 * Point the systemd desk unit at a git worktree so a PR can be tested
 * without merging into the primary checkout.
 *
 * origin/main is the source of truth. ~/Work/revdesk is the default
 * live desk (ff-only from origin), not a merge target. Land path is a GitHub PR.
 *
 *   ./bin/revdesk desk status
 *   ./bin/revdesk desk deploy --pr 2
 *   ./bin/revdesk desk deploy --branch feat/ingest
 *   ./bin/revdesk desk deploy --tree ~/Work/revdesk/.worktrees/feat-ingest
 *   ./bin/revdesk desk origin
 *   ./bin/revdesk desk public-demo on | off
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

export const UNIT = "revdesk";
export const DESK_PORT = 5173;
/** Funnel public listener. Never 443 (Bitwarden), 5173 (tailnet Serve), or 5175 (RFD). */
export const PUBLIC_DEMO_PORT = 8443;
export const FUNNEL_PUBLIC_PORTS = new Set([8443, 10000]);
export const FORBIDDEN_PUBLIC_PORTS = new Set([443, 5173, 5175]);

const USAGE =
  "usage: revdesk desk status | revdesk desk deploy --pr <n> | --branch <name> | --tree <path> | revdesk desk origin | revdesk desk public-demo on | off";
const PUBLIC_DEMO_USAGE = "usage: revdesk desk public-demo on | off";

export function defaultPaths(env = process.env, home = homedir()) {
  const dropinDir = join(home, ".config/systemd/user", `${UNIT}.service.d`);
  const primary = (env.REVDESK_PRIMARY || "").trim() || join(home, "Work/revdesk");
  return {
    home,
    primary,
    worktrees: (env.REVDESK_WORKTREES || "").trim() || join(primary, ".worktrees"),
    dropinDir,
    dropin: join(dropinDir, "tree.conf"),
    unit: UNIT,
    port: Number(env.REVDESK_DESK_PORT) || DESK_PORT,
    publicDemoPort: Number(env.REVDESK_PUBLIC_DEMO_PORT) || PUBLIC_DEMO_PORT,
  };
}

export function parseDeskArgs(sub, rest = []) {
  const verb = (sub ?? "status").toLowerCase();
  if (verb === "help" || verb === "--help") {
    return { cmd: "desk", sub: "help" };
  }
  if (verb === "status") {
    if (rest.length) return { error: "usage: revdesk desk status" };
    return { cmd: "desk", sub: "status" };
  }
  if (verb === "origin") {
    if (rest.length) return { error: "usage: revdesk desk origin" };
    return { cmd: "desk", sub: "origin" };
  }
  if (verb === "public-demo") {
    const action = (rest[0] || "status").toLowerCase();
    if (rest.length > 1) return { error: PUBLIC_DEMO_USAGE };
    if (action !== "on" && action !== "off" && action !== "status") {
      return { error: PUBLIC_DEMO_USAGE };
    }
    return { cmd: "desk", sub: "public-demo", action };
  }
  if (verb !== "deploy") return { error: USAGE };

  let pr;
  let branch;
  let tree;
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    const take = (flag) => {
      const v = rest[++i];
      if (!v || v.startsWith("-")) return { error: `usage: revdesk desk deploy ${flag} <value>` };
      return v;
    };
    if (a === "--pr" || a === "-pr") {
      const v = take("--pr");
      if (v && typeof v === "object" && v.error) return v;
      pr = v;
    } else if (a === "--branch" || a === "-branch") {
      const v = take("--branch");
      if (v && typeof v === "object" && v.error) return v;
      branch = v;
    } else if (a === "--tree" || a === "-tree") {
      const v = take("--tree");
      if (v && typeof v === "object" && v.error) return v;
      tree = v;
    } else {
      return { error: `unexpected argument: ${a}` };
    }
  }
  const n = [pr, branch, tree].filter(Boolean).length;
  if (n !== 1) return { error: USAGE };
  return { cmd: "desk", sub: "deploy", pr, branch, tree };
}

export function dropinContents(workingDirectory) {
  return `# written by revdesk desk deploy — do not hand-edit; use revdesk desk origin to clear\n[Service]\nWorkingDirectory=${workingDirectory}\n`;
}

export function parseDropinWorkingDirectory(text) {
  const m = String(text).match(/^\s*WorkingDirectory\s*=\s*(.+?)\s*$/m);
  return m ? m[1].trim() : null;
}

export function parseWorktreeList(porcelain) {
  const trees = [];
  let cur = {};
  for (const line of String(porcelain).split("\n")) {
    if (line === "") {
      if (cur.path) trees.push(cur);
      cur = {};
      continue;
    }
    if (line.startsWith("worktree ")) cur.path = line.slice("worktree ".length);
    else if (line.startsWith("HEAD ")) cur.head = line.slice("HEAD ".length);
    else if (line.startsWith("branch ")) {
      cur.branch = line.slice("branch ".length).replace(/^refs\/heads\//, "");
    } else if (line === "detached") cur.detached = true;
  }
  if (cur.path) trees.push(cur);
  return trees;
}

export function slugBranch(branch) {
  return String(branch).replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-|-$/g, "");
}

export function expandPath(p, home) {
  if (!p) return p;
  if (p === "~") return home;
  if (p.startsWith("~/")) return join(home, p.slice(2));
  return isAbsolute(p) ? p : resolve(p);
}

export function stripDnsDot(name) {
  return String(name || "").replace(/\.$/, "");
}

export function publicDemoTarget(deskPort = DESK_PORT) {
  return `http://127.0.0.1:${deskPort}`;
}

export function assertSafePublicDemoPort(port) {
  const n = Number(port);
  if (n === 443) throw new Error("public-demo refuses :443 (existing Serve / Bitwarden)");
  if (n === 5173) throw new Error("Funnel cannot use :5173; tailnet Serve stays private");
  if (n === 5175) throw new Error("public-demo refuses :5175 (Ready for Duty)");
  if (!FUNNEL_PUBLIC_PORTS.has(n)) {
    throw new Error("Funnel public ports are 8443 or 10000 (never 443)");
  }
  return n;
}

export function parseWebPort(hostKey) {
  const s = String(hostKey || "");
  const i = s.lastIndexOf(":");
  if (i < 0) return 443;
  const n = Number(s.slice(i + 1));
  return Number.isFinite(n) ? n : 443;
}

function handlerProxy(webEntry) {
  return webEntry?.Handlers?.["/"]?.Proxy || null;
}

/**
 * Read Tailscale `serve status --json` and decide whether public-demo is on.
 * On = Funnel AllowFunnel on the demo port AND proxy is this desk's loopback.
 * Occupied = something else (usually Ready for Duty on :5175) already owns :8443.
 */
export function publicDemoFromServe(status, dnsName, opts = {}) {
  const port = Number(opts.port) || PUBLIC_DEMO_PORT;
  const deskPort = Number(opts.deskPort) || DESK_PORT;
  const target = publicDemoTarget(deskPort);
  const host = stripDnsDot(dnsName);
  const web = status?.Web && typeof status.Web === "object" ? status.Web : {};
  const allow = status?.AllowFunnel && typeof status.AllowFunnel === "object" ? status.AllowFunnel : {};
  const preferred = host ? `${host}:${port}` : null;
  const foundKey =
    (preferred && web[preferred] ? preferred : null) ||
    Object.keys(web).find((k) => parseWebPort(k) === port) ||
    null;
  const proxy = foundKey ? handlerProxy(web[foundKey]) : null;
  const funnel = Object.entries(allow).some(([k, v]) => v === true && parseWebPort(k) === port);
  const ours = proxy === target;
  return {
    on: Boolean(funnel && ours),
    port,
    host: host || null,
    url: host ? `https://${host}:${port}` : null,
    target,
    proxy,
    funnel: Boolean(funnel),
    ours,
    occupied: Boolean(proxy) && !ours,
  };
}

function defaultRun(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, {
    encoding: "utf8",
    cwd: opts.cwd,
    env: opts.env ?? process.env,
  });
  return {
    status: r.status ?? 1,
    stdout: r.stdout || "",
    stderr: r.stderr || "",
    error: r.error,
  };
}

async function defaultHealth(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(2500) });
    return { ok: res.ok, status: res.status };
  } catch (err) {
    return { ok: false, status: 0, error: err?.message || String(err) };
  }
}

function runOrThrow(run, cmd, args, opts = {}) {
  const r = run(cmd, args, opts);
  if (r.status !== 0) {
    const msg = (r.stderr || r.stdout || r.error?.message || `${cmd} exit ${r.status}`).trim();
    throw new Error(msg);
  }
  return r.stdout;
}

function git(run, cwd, gitArgs) {
  return runOrThrow(run, "git", ["-C", cwd, ...gitArgs]);
}

function gitOk(run, cwd, gitArgs) {
  return run("git", ["-C", cwd, ...gitArgs]);
}

function porcelainLines(text) {
  return String(text)
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}

function bindOps(io, paths) {
  return {
    paths,
    run: io.run || defaultRun,
    writeFile: io.writeFile || writeFileSync,
    readFile: io.readFile || ((p) => readFileSync(p, "utf8")),
    exists: io.exists || existsSync,
    mkdir: io.mkdir || ((p) => mkdirSync(p, { recursive: true })),
    unlink: io.unlink || unlinkSync,
    health: io.health || defaultHealth,
    sleep: io.sleep || ((ms) => new Promise((r) => setTimeout(r, ms))),
    healthAttempts: io.healthAttempts ?? 40,
    healthDelayMs: io.healthDelayMs ?? 500,
    npmInstall: io.npmInstall,
  };
}

function unitShow(ops) {
  const r = ops.run("systemctl", ["--user", "show", ops.paths.unit, "-p", "ActiveState", "-p", "WorkingDirectory", "-p", "MainPID"]);
  const out = {};
  for (const line of String(r.stdout || "").split("\n")) {
    const i = line.indexOf("=");
    if (i < 0) continue;
    out[line.slice(0, i)] = line.slice(i + 1);
  }
  return {
    loaded: r.status === 0,
    active: out.ActiveState || "unknown",
    working_directory: out.WorkingDirectory || "",
    main_pid: out.MainPID ? Number(out.MainPID) : 0,
  };
}

function readDropin(ops) {
  if (!ops.exists(ops.paths.dropin)) return null;
  try {
    return parseDropinWorkingDirectory(ops.readFile(ops.paths.dropin));
  } catch {
    return null;
  }
}

function treeInfo(ops, tree) {
  const head = git(ops.run, tree, ["rev-parse", "HEAD"]).trim();
  const branchRaw = gitOk(ops.run, tree, ["rev-parse", "--abbrev-ref", "HEAD"]);
  const branch = branchRaw.status === 0 ? branchRaw.stdout.trim() : "";
  const dirty = porcelainLines(git(ops.run, tree, ["status", "--porcelain"]));
  return { head, branch: branch === "HEAD" ? "" : branch, dirty };
}

export function resolveGitCommonDir(tree, raw) {
  return resolve(tree, String(raw).trim());
}

function commonDir(ops, tree) {
  return resolveGitCommonDir(tree, git(ops.run, tree, ["rev-parse", "--git-common-dir"]));
}

function assertSameRepo(ops, tree) {
  const a = resolve(commonDir(ops, ops.paths.primary));
  const b = resolve(commonDir(ops, tree));
  if (a !== b) {
    throw new Error(`${tree} is not a worktree of ${ops.paths.primary}`);
  }
}

function listWorktrees(ops) {
  const text = git(ops.run, ops.paths.primary, ["worktree", "list", "--porcelain"]);
  return parseWorktreeList(text);
}

function lookupPr(ops, tree) {
  const r = ops.run("gh", ["pr", "view", "--json", "number,url,title,state,headRefName"], { cwd: tree });
  if (r.status !== 0) return null;
  try {
    const j = JSON.parse(r.stdout);
    if (!j?.number) return null;
    return {
      number: j.number,
      url: j.url || null,
      title: j.title || null,
      state: j.state || null,
      head: j.headRefName || null,
    };
  } catch {
    return null;
  }
}

function viewPr(ops, n) {
  const r = ops.run(
    "gh",
    ["pr", "view", String(n), "--json", "number,url,title,state,headRefName"],
    { cwd: ops.paths.primary },
  );
  if (r.status !== 0) {
    const msg = (r.stderr || r.stdout || `gh pr view ${n} failed`).trim();
    throw new Error(msg);
  }
  const j = JSON.parse(r.stdout);
  if (!j?.headRefName) throw new Error(`PR #${n} has no head branch`);
  return {
    number: j.number,
    url: j.url || null,
    title: j.title || null,
    state: j.state || null,
    head: j.headRefName,
  };
}

function ensureWorktree(ops, branch) {
  git(ops.run, ops.paths.primary, ["fetch", "origin"]);
  const existing = listWorktrees(ops).find((t) => t.branch === branch);
  if (existing?.path) return existing.path;

  const dest = join(ops.paths.worktrees, slugBranch(branch));
  if (ops.exists(dest)) {
    const info = treeInfo(ops, dest);
    if (info.branch && info.branch !== branch) {
      throw new Error(`${dest} already exists on ${info.branch}, not ${branch}`);
    }
    return dest;
  }

  ops.mkdir(ops.paths.worktrees);
  const local = gitOk(ops.run, ops.paths.primary, ["rev-parse", "--verify", branch]);
  if (local.status === 0) {
    runOrThrow(ops.run, "git", ["-C", ops.paths.primary, "worktree", "add", dest, branch]);
    return dest;
  }
  const remote = gitOk(ops.run, ops.paths.primary, ["rev-parse", "--verify", `origin/${branch}`]);
  if (remote.status === 0) {
    runOrThrow(ops.run, "git", [
      "-C",
      ops.paths.primary,
      "worktree",
      "add",
      "--track",
      "-b",
      branch,
      dest,
      `origin/${branch}`,
    ]);
    return dest;
  }
  throw new Error(`branch not found: ${branch} (tried local and origin/${branch})`);
}

function writeDropin(ops, tree) {
  ops.mkdir(ops.paths.dropinDir);
  ops.writeFile(ops.paths.dropin, dropinContents(tree), "utf8");
}

function removeDropin(ops) {
  if (ops.exists(ops.paths.dropin)) ops.unlink(ops.paths.dropin);
}

function restartUnit(ops) {
  runOrThrow(ops.run, "systemctl", ["--user", "daemon-reload"]);
  const r = ops.run("systemctl", ["--user", "restart", ops.paths.unit]);
  if (r.status !== 0) {
    const start = ops.run("systemctl", ["--user", "start", ops.paths.unit]);
    if (start.status !== 0) {
      throw new Error((r.stderr || start.stderr || "systemctl restart failed").trim());
    }
  }
}

async function waitHealth(ops) {
  const url = `http://127.0.0.1:${ops.paths.port}/`;
  let last = { ok: false, status: 0 };
  for (let i = 0; i < ops.healthAttempts; i++) {
    last = await ops.health(url);
    if (last.ok) return { ...last, url };
    await ops.sleep(ops.healthDelayMs);
  }
  return { ...last, url };
}

function ensureNodeModules(ops, tree) {
  if (ops.exists(join(tree, "node_modules"))) return { installed: false };
  if (typeof ops.npmInstall === "function") {
    ops.npmInstall(tree);
    return { installed: true };
  }
  runOrThrow(ops.run, "npm", ["install", "--no-audit", "--no-fund"], { cwd: tree });
  return { installed: true };
}

function parseJsonOrThrow(stdout, label) {
  try {
    return JSON.parse(stdout);
  } catch {
    throw new Error(`${label} did not return JSON`);
  }
}

function tailscaleDnsName(ops) {
  const r = ops.run("tailscale", ["status", "--json"]);
  if (r.status !== 0) {
    throw new Error((r.stderr || r.stdout || "tailscale status failed").trim());
  }
  const j = parseJsonOrThrow(r.stdout, "tailscale status --json");
  const name = stripDnsDot(j?.Self?.DNSName);
  if (!name) throw new Error("tailscale status has no DNSName");
  return name;
}

function tailscaleServeStatus(ops) {
  const r = ops.run("tailscale", ["serve", "status", "--json"]);
  if (r.status !== 0 && !String(r.stdout || "").trim()) {
    return { Web: {}, AllowFunnel: {} };
  }
  if (r.status !== 0) {
    throw new Error((r.stderr || r.stdout || "tailscale serve status failed").trim());
  }
  return parseJsonOrThrow(r.stdout, "tailscale serve status --json");
}

function readPublicDemo(ops) {
  const port = assertSafePublicDemoPort(ops.paths.publicDemoPort || PUBLIC_DEMO_PORT);
  const dns = tailscaleDnsName(ops);
  const serve = tailscaleServeStatus(ops);
  return publicDemoFromServe(serve, dns, { port, deskPort: ops.paths.port });
}

function tryPublicDemo(ops) {
  try {
    return readPublicDemo(ops);
  } catch (err) {
    return { on: false, error: err?.message || String(err) };
  }
}

function tailscaleOrThrow(ops, args) {
  const r = ops.run("tailscale", args);
  if (r.status !== 0) {
    throw new Error((r.stderr || r.stdout || `tailscale ${args.join(" ")}`).trim());
  }
  return r;
}

function occupiedHint(proxy) {
  if (String(proxy || "").includes(":5175")) {
    return "one public-demo at a time; Ready for Duty owns :8443 — rfd desk public-demo off first";
  }
  return "one public-demo at a time; will not steal :8443";
}

async function collectStatus(ops) {
  const unit = unitShow(ops);
  const dropin = readDropin(ops);
  const tree = dropin || unit.working_directory || ops.paths.primary;
  const deploy = dropin ? "tree" : "origin";
  let gitState = null;
  let pr = null;
  if (tree && ops.exists(tree)) {
    try {
      gitState = treeInfo(ops, tree);
      pr = lookupPr(ops, tree);
    } catch (err) {
      gitState = { error: err.message };
    }
  }
  const health = await ops.health(`http://127.0.0.1:${ops.paths.port}/`);
  return {
    ok: true,
    unit: ops.paths.unit,
    active: unit.active,
    working_directory: unit.working_directory || null,
    deploy,
    dropin: dropin ? ops.paths.dropin : null,
    dropin_directory: dropin,
    primary: ops.paths.primary,
    tree,
    git: gitState,
    pr,
    health: { ...health, url: `http://127.0.0.1:${ops.paths.port}/` },
    public_demo: tryPublicDemo(ops),
  };
}

function publicDemoJson(state, extra = {}) {
  return {
    public_demo: state.on === true,
    on: state.on === true,
    url: state.url || null,
    port: state.port || PUBLIC_DEMO_PORT,
    target: state.target || publicDemoTarget(),
    ...extra,
  };
}

async function runPublicDemo(ops, action) {
  const port = assertSafePublicDemoPort(ops.paths.publicDemoPort || PUBLIC_DEMO_PORT);

  if (action === "status") {
    const state = readPublicDemo(ops);
    return {
      exitCode: 0,
      json: publicDemoJson(state, { ok: true }),
    };
  }

  if (action === "on") {
    const health = await ops.health(`http://127.0.0.1:${ops.paths.port}/`);
    if (!health.ok) {
      return {
        exitCode: 1,
        json: {
          error: `desk is not answering http://127.0.0.1:${ops.paths.port}/; start revdesk first`,
          health,
        },
      };
    }
    const state = readPublicDemo(ops);
    if (state.occupied) {
      return {
        exitCode: 2,
        json: {
          error: `:${port} already proxies ${state.proxy}; will not steal it`,
          hint: occupiedHint(state.proxy),
          ...publicDemoJson(state),
        },
      };
    }
    if (!state.on) {
      tailscaleOrThrow(ops, [
        "funnel",
        "--bg",
        "--yes",
        `--https=${port}`,
        publicDemoTarget(ops.paths.port),
      ]);
    }
    const next = readPublicDemo(ops);
    return {
      exitCode: next.on ? 0 : 1,
      json: publicDemoJson(next, {
        ok: next.on,
        hint: next.on
          ? "public internet until revdesk desk public-demo off. Chrome secure DNS: use Google, not Cloudflare 1.1.1.1"
          : "funnel ran but AllowFunnel is not on; check tailscale funnel status",
      }),
    };
  }

  if (action === "off") {
    const state = readPublicDemo(ops);
    if (state.occupied) {
      return {
        exitCode: 2,
        json: {
          error: `:${port} proxies ${state.proxy}, not this desk; will not turn it off`,
          hint: occupiedHint(state.proxy),
          ...publicDemoJson(state),
        },
      };
    }
    if (state.on || state.ours || state.funnel) {
      const funnelOff = ops.run("tailscale", ["funnel", "--yes", `--https=${port}`, "off"]);
      const serveOff = ops.run("tailscale", ["serve", "--yes", `--https=${port}`, "off"]);
      if (funnelOff.status !== 0 && serveOff.status !== 0) {
        throw new Error(
          (funnelOff.stderr || serveOff.stderr || `tailscale off :${port} failed`).trim(),
        );
      }
    }
    const next = readPublicDemo(ops);
    return {
      exitCode: next.on ? 1 : 0,
      json: publicDemoJson(next, {
        ok: !next.on,
        hint: next.on ? "still public; check tailscale funnel status" : "public-demo off",
      }),
    };
  }

  return { exitCode: 2, json: { error: PUBLIC_DEMO_USAGE } };
}

async function deployTree(ops, tree, extra = {}) {
  if (!ops.exists(tree)) {
    return { exitCode: 2, json: { error: `tree not found: ${tree}` } };
  }
  try {
    assertSameRepo(ops, tree);
  } catch (err) {
    return { exitCode: 2, json: { error: err.message } };
  }
  const npm = ensureNodeModules(ops, tree);
  writeDropin(ops, tree);
  restartUnit(ops);
  const health = await waitHealth(ops);
  const gitState = treeInfo(ops, tree);
  const pr = extra.pr || lookupPr(ops, tree);
  return {
    exitCode: health.ok ? 0 : 1,
    json: {
      ok: health.ok,
      deployed: true,
      tree,
      npm_install: npm.installed,
      dropin: ops.paths.dropin,
      git: gitState,
      pr: pr || null,
      health,
      hint: health.ok
        ? `desk is ${tree}`
        : `Vite did not answer ${health.url}; journalctl --user -u ${ops.paths.unit} -n 80`,
    },
  };
}

export async function runDesk(args, io = {}) {
  if (args.error) return { exitCode: 2, json: { error: args.error } };
  const paths = io.paths || defaultPaths();
  const ops = bindOps(io, paths);

  if (args.sub === "help") {
    return {
      exitCode: 0,
      json: {
        name: "revdesk desk",
        host: true,
        commands: [
          "revdesk desk status",
          "revdesk desk deploy --pr <n>",
          "revdesk desk deploy --branch <name>",
          "revdesk desk deploy --tree <path>",
          "revdesk desk origin",
          "revdesk desk public-demo on | off",
        ],
        notes: [
          "Points the systemd unit at a worktree so a PR can be tested.",
          "Worktrees live at <repo>/.worktrees (gitignored). Same layout on other desks.",
          "origin/main is the source of truth. Do not merge into the primary checkout.",
          "revdesk desk origin returns the unit to the primary tree (ff-only from origin).",
          "Do not npm run dev — the unit owns :5173.",
          "public-demo Funnel is :8443 → loopback :5173. Never :443 (Bitwarden) or :5175 (RFD). One public demo at a time.",
        ],
      },
    };
  }

  try {
    if (args.sub === "status") {
      return { exitCode: 0, json: await collectStatus(ops) };
    }

    if (args.sub === "public-demo") {
      return await runPublicDemo(ops, args.action || "status");
    }

    if (args.sub === "origin") {
      const dirty = porcelainLines(git(ops.run, paths.primary, ["status", "--porcelain"]));
      if (dirty.length) {
        return {
          exitCode: 2,
          json: {
            error: "primary is dirty; commit or discard before revdesk desk origin",
            path: paths.primary,
            dirty,
          },
        };
      }
      removeDropin(ops);
      git(ops.run, paths.primary, ["pull", "--ff-only"]);
      restartUnit(ops);
      const health = await waitHealth(ops);
      const gitState = treeInfo(ops, paths.primary);
      return {
        exitCode: health.ok ? 0 : 1,
        json: {
          ok: health.ok,
          deployed: false,
          deploy: "origin",
          tree: paths.primary,
          git: gitState,
          health,
          hint: health.ok
            ? "desk is origin/main checkout"
            : `Vite did not answer ${health.url}; journalctl --user -u ${paths.unit} -n 80`,
        },
      };
    }

    if (args.sub === "deploy") {
      let pr = null;
      let tree = args.tree ? expandPath(args.tree, paths.home) : null;
      let branch = args.branch || null;
      if (args.pr) {
        pr = viewPr(ops, args.pr);
        branch = pr.head;
      }
      if (branch && !tree) tree = ensureWorktree(ops, branch);
      if (!tree) return { exitCode: 2, json: { error: USAGE } };
      return deployTree(ops, tree, { pr });
    }

    return { exitCode: 2, json: { error: USAGE } };
  } catch (err) {
    return { exitCode: 1, json: { error: err?.message || String(err) } };
  }
}
