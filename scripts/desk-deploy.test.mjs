import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  assertSafePublicDemoPort,
  defaultPaths,
  dropinContents,
  parseDeskArgs,
  parseDropinWorkingDirectory,
  parseWorktreeList,
  publicDemoFromServe,
  resolveGitCommonDir,
  runDesk,
  slugBranch,
} from "./desk-deploy.mjs";

test("parseDeskArgs: bare desk is status; deploy needs exactly one target", () => {
  assert.deepEqual(parseDeskArgs(undefined, []), { cmd: "desk", sub: "status" });
  assert.deepEqual(parseDeskArgs("status", []), { cmd: "desk", sub: "status" });
  assert.equal(parseDeskArgs("status", ["extra"]).error, "usage: revdesk desk status");
  assert.match(parseDeskArgs("deploy", []).error, /revdesk desk deploy/);
  assert.deepEqual(parseDeskArgs("deploy", ["--pr", "2"]), {
    cmd: "desk",
    sub: "deploy",
    pr: "2",
    branch: undefined,
    tree: undefined,
  });
  assert.deepEqual(parseDeskArgs("deploy", ["--branch", "feat/ingest"]), {
    cmd: "desk",
    sub: "deploy",
    pr: undefined,
    branch: "feat/ingest",
    tree: undefined,
  });
  assert.match(parseDeskArgs("deploy", ["--pr", "2", "--branch", "x"]).error, /usage/);
  assert.match(parseDeskArgs("deploy", ["--nope"]).error, /unexpected argument/);
  assert.equal(parseDeskArgs("ship", []).error.startsWith("usage:"), true);
  assert.deepEqual(parseDeskArgs("public-demo", []), {
    cmd: "desk",
    sub: "public-demo",
    action: "status",
  });
  assert.deepEqual(parseDeskArgs("public-demo", ["on"]), {
    cmd: "desk",
    sub: "public-demo",
    action: "on",
  });
  assert.deepEqual(parseDeskArgs("public-demo", ["off"]), {
    cmd: "desk",
    sub: "public-demo",
    action: "off",
  });
  assert.match(parseDeskArgs("public-demo", ["maybe"]).error, /public-demo/);
});

test("worktree porcelain and drop-in round-trip", () => {
  const trees = parseWorktreeList(
    [
      "worktree /home/x/Work/revdesk",
      "HEAD abc",
      "branch refs/heads/main",
      "",
      "worktree /home/x/Work/revdesk/.worktrees/feat-ingest",
      "HEAD def",
      "branch refs/heads/feat/ingest",
      "",
    ].join("\n"),
  );
  assert.equal(trees.length, 2);
  assert.equal(trees[1].branch, "feat/ingest");
  assert.equal(slugBranch("feat/ingest"), "feat-ingest");
  const primary = "/home/x/Work/revdesk";
  const wt = "/home/x/Work/revdesk/.worktrees/feat-ingest";
  assert.equal(
    resolveGitCommonDir(primary, ".git"),
    resolveGitCommonDir(wt, `${primary}/.git`),
  );
  const text = dropinContents(wt);
  assert.equal(parseDropinWorkingDirectory(text), wt);
});

test("defaultPaths nests worktrees under the primary checkout", () => {
  const p = defaultPaths({ REVDESK_PRIMARY: "/tmp/revdesk" }, "/home/x");
  assert.equal(p.primary, "/tmp/revdesk");
  assert.equal(p.worktrees, "/tmp/revdesk/.worktrees");
  const def = defaultPaths({}, "/home/x");
  assert.equal(def.primary, "/home/x/Work/revdesk");
  assert.equal(def.worktrees, "/home/x/Work/revdesk/.worktrees");
  const override = defaultPaths(
    { REVDESK_PRIMARY: "/tmp/revdesk", REVDESK_WORKTREES: "/tmp/elsewhere" },
    "/home/x",
  );
  assert.equal(override.worktrees, "/tmp/elsewhere");
  assert.equal(defaultPaths({}, "/home/x").publicDemoPort, 8443);
  assert.equal(defaultPaths({ REVDESK_PUBLIC_DEMO_PORT: "10000" }, "/home/x").publicDemoPort, 10000);
});

const DEMO_DNS = "brendanthenavigator.mole-bushmaster.ts.net";

function emptyServe() {
  return {
    TCP: {
      443: { HTTPS: true },
      5173: { HTTPS: true },
      5175: { HTTPS: true },
    },
    Web: {
      [`${DEMO_DNS}:443`]: { Handlers: { "/": { Proxy: "http://127.0.0.1:8222" } } },
      [`${DEMO_DNS}:5173`]: { Handlers: { "/": { Proxy: "http://127.0.0.1:5173" } } },
      [`${DEMO_DNS}:5175`]: { Handlers: { "/": { Proxy: "http://127.0.0.1:5175" } } },
    },
    AllowFunnel: {},
  };
}

function makeHarness() {
  const root = mkdtempSync(join(tmpdir(), "revdesk-desk-"));
  const primary = join(root, "revdesk");
  const tree = join(root, "worktrees", "feat-ingest");
  const dropinDir = join(root, "systemd");
  mkdirSync(primary, { recursive: true });
  mkdirSync(tree, { recursive: true });
  mkdirSync(join(tree, "node_modules"), { recursive: true });
  mkdirSync(dropinDir, { recursive: true });
  const dropin = join(dropinDir, "tree.conf");
  const calls = [];
  const git = {
    primaryDirty: "",
    treeDirty: "",
    common: "/git",
    head: "defdefd",
    branch: "feat/ingest",
    worktrees: [
      `worktree ${primary}`,
      "HEAD aa",
      "branch refs/heads/main",
      "",
      `worktree ${tree}`,
      "HEAD defdefd",
      "branch refs/heads/feat/ingest",
      "",
    ].join("\n"),
    pr: {
      number: 2,
      url: "https://github.com/fearjet44/revdesk/pull/2",
      title: "ingest",
      state: "OPEN",
      headRefName: "feat/ingest",
    },
  };
  const unit = {
    active: "active",
    working_directory: primary,
    main_pid: "9",
  };
  const serve = emptyServe();

  const run = (cmd, args, opts = {}) => {
    calls.push({ cmd, args, cwd: opts.cwd });
    if (cmd === "tailscale") {
      if (args[0] === "status" && args.includes("--json")) {
        return {
          status: 0,
          stdout: JSON.stringify({ Self: { DNSName: `${DEMO_DNS}.` } }),
          stderr: "",
        };
      }
      if (args[0] === "serve" && args[1] === "status") {
        return { status: 0, stdout: JSON.stringify(serve), stderr: "" };
      }
      if (args[0] === "funnel" && args.includes("off")) {
        const key = `${DEMO_DNS}:8443`;
        delete serve.Web[key];
        delete serve.AllowFunnel[key];
        return { status: 0, stdout: "", stderr: "" };
      }
      if (args[0] === "serve" && args.includes("off")) {
        const key = `${DEMO_DNS}:8443`;
        delete serve.Web[key];
        delete serve.AllowFunnel[key];
        return { status: 0, stdout: "", stderr: "" };
      }
      if (args[0] === "funnel") {
        const key = `${DEMO_DNS}:8443`;
        serve.Web[key] = { Handlers: { "/": { Proxy: "http://127.0.0.1:5173" } } };
        serve.AllowFunnel[key] = true;
        return { status: 0, stdout: "Available on the internet\n", stderr: "" };
      }
      return { status: 1, stdout: "", stderr: `unexpected tailscale ${args.join(" ")}` };
    }
    if (cmd === "systemctl" && args.includes("show")) {
      return {
        status: 0,
        stdout: `ActiveState=${unit.active}\nWorkingDirectory=${unit.working_directory}\nMainPID=${unit.main_pid}\n`,
        stderr: "",
      };
    }
    if (cmd === "systemctl") return { status: 0, stdout: "", stderr: "" };
    if (cmd === "npm") return { status: 0, stdout: "", stderr: "" };
    if (cmd === "gh" && args[0] === "pr" && args[1] === "view") {
      return { status: 0, stdout: JSON.stringify(git.pr), stderr: "" };
    }
    if (cmd !== "git") return { status: 1, stdout: "", stderr: `unexpected ${cmd}` };
    const gitArgs = args[0] === "-C" ? args.slice(2) : args;
    const cwd = args[0] === "-C" ? args[1] : opts.cwd;
    const key = gitArgs.join(" ");
    if (key === "worktree list --porcelain") {
      return { status: 0, stdout: git.worktrees, stderr: "" };
    }
    if (key === "rev-parse --git-common-dir") {
      return { status: 0, stdout: `${git.common}\n`, stderr: "" };
    }
    if (key === "rev-parse HEAD") return { status: 0, stdout: `${git.head}\n`, stderr: "" };
    if (key === "rev-parse --abbrev-ref HEAD") {
      return { status: 0, stdout: `${git.branch}\n`, stderr: "" };
    }
    if (key === "status --porcelain") {
      const dirty = cwd === primary ? git.primaryDirty : git.treeDirty;
      return { status: 0, stdout: dirty, stderr: "" };
    }
    if (key === "fetch origin" || key === "pull --ff-only") {
      return { status: 0, stdout: "", stderr: "" };
    }
    if (gitArgs[0] === "worktree" && gitArgs[1] === "add") {
      return { status: 0, stdout: "", stderr: "" };
    }
    if (key.startsWith("rev-parse --verify")) {
      return { status: 0, stdout: "abc\n", stderr: "" };
    }
    return { status: 1, stdout: "", stderr: `unexpected git ${key}` };
  };

  const paths = {
    home: root,
    primary,
    worktrees: join(root, "worktrees"),
    dropinDir,
    dropin,
    unit: "revdesk",
    port: 5173,
    publicDemoPort: 8443,
  };

  const io = {
    paths,
    run,
    health: async () => ({ ok: true, status: 200 }),
    sleep: async () => {},
    healthAttempts: 2,
    healthDelayMs: 0,
  };

  return {
    root,
    primary,
    tree,
    dropin,
    git,
    unit,
    serve,
    calls,
    io,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

test("deploy --tree writes drop-in, restarts unit, does not npm run dev", async () => {
  const h = makeHarness();
  try {
    const out = await runDesk(
      { cmd: "desk", sub: "deploy", tree: h.tree },
      h.io,
    );
    assert.equal(out.exitCode, 0);
    assert.equal(out.json.deployed, true);
    assert.equal(out.json.tree, h.tree);
    assert.equal(out.json.git.branch, "feat/ingest");
    const written = readFileSync(h.dropin, "utf8");
    assert.equal(parseDropinWorkingDirectory(written), h.tree);
    assert.equal(
      h.calls.some((c) => c.cmd === "systemctl" && c.args.includes("restart")),
      true,
    );
    assert.equal(
      h.calls.some((c) => c.cmd === "npm" && c.args.includes("run")),
      false,
    );
  } finally {
    h.cleanup();
  }
});

test("deploy --pr reuses the worktree already on that branch", async () => {
  const h = makeHarness();
  try {
    const out = await runDesk({ cmd: "desk", sub: "deploy", pr: "2" }, h.io);
    assert.equal(out.exitCode, 0);
    assert.equal(out.json.tree, h.tree);
    assert.equal(out.json.pr.number, 2);
    assert.equal(
      h.calls.some((c) => c.cmd === "git" && c.args.includes("worktree") && c.args.includes("add")),
      false,
    );
  } finally {
    h.cleanup();
  }
});

test("origin refuses a dirty primary and leaves the drop-in", async () => {
  const h = makeHarness();
  try {
    writeFileSync(h.dropin, dropinContents(h.tree));
    h.git.primaryDirty = " M docs/runbook/server.md\n";
    const out = await runDesk({ cmd: "desk", sub: "origin" }, h.io);
    assert.equal(out.exitCode, 2);
    assert.match(out.json.error, /primary is dirty/);
    assert.equal(out.json.dirty[0].includes("server.md"), true);
    assert.equal(readFileSync(h.dropin, "utf8").includes(h.tree), true);
    assert.equal(
      h.calls.some((c) => c.cmd === "systemctl" && c.args.includes("restart")),
      false,
    );
  } finally {
    h.cleanup();
  }
});

test("origin on a clean primary removes the drop-in and pulls ff-only", async () => {
  const h = makeHarness();
  try {
    writeFileSync(h.dropin, dropinContents(h.tree));
    h.git.branch = "main";
    h.git.head = "aabbcc";
    const out = await runDesk({ cmd: "desk", sub: "origin" }, h.io);
    assert.equal(out.exitCode, 0);
    assert.equal(out.json.deploy, "origin");
    assert.equal(out.json.tree, h.primary);
    let gone = false;
    try {
      readFileSync(h.dropin);
    } catch {
      gone = true;
    }
    assert.equal(gone, true);
    assert.equal(
      h.calls.some((c) => c.cmd === "git" && c.args.includes("pull") && c.args.includes("--ff-only")),
      true,
    );
  } finally {
    h.cleanup();
  }
});

test("status reports deploy vs origin from the drop-in", async () => {
  const h = makeHarness();
  try {
    const origin = await runDesk({ cmd: "desk", sub: "status" }, h.io);
    assert.equal(origin.json.deploy, "origin");
    writeFileSync(h.dropin, dropinContents(h.tree));
    h.unit.working_directory = h.tree;
    const deployed = await runDesk({ cmd: "desk", sub: "status" }, h.io);
    assert.equal(deployed.json.deploy, "tree");
    assert.equal(deployed.json.dropin_directory, h.tree);
    assert.equal(origin.json.public_demo.on, false);
  } finally {
    h.cleanup();
  }
});

test("publicDemoFromServe is on only when Funnel AllowFunnel points at revdesk", () => {
  const off = publicDemoFromServe(emptyServe(), DEMO_DNS);
  assert.equal(off.on, false);
  assert.equal(off.port, 8443);
  const on = publicDemoFromServe(
    {
      Web: {
        [`${DEMO_DNS}:8443`]: { Handlers: { "/": { Proxy: "http://127.0.0.1:5173" } } },
      },
      AllowFunnel: { [`${DEMO_DNS}:8443`]: true },
    },
    DEMO_DNS,
  );
  assert.equal(on.on, true);
  assert.equal(on.url, `https://${DEMO_DNS}:8443`);
  const rfd = publicDemoFromServe(
    {
      Web: {
        [`${DEMO_DNS}:8443`]: { Handlers: { "/": { Proxy: "http://127.0.0.1:5175" } } },
      },
      AllowFunnel: { [`${DEMO_DNS}:8443`]: true },
    },
    DEMO_DNS,
  );
  assert.equal(rfd.on, false);
  assert.equal(rfd.occupied, true);
});

test("assertSafePublicDemoPort never allows 443 / 5173 / 5175", () => {
  assert.equal(assertSafePublicDemoPort(8443), 8443);
  assert.equal(assertSafePublicDemoPort(10000), 10000);
  assert.throws(() => assertSafePublicDemoPort(443), /443/);
  assert.throws(() => assertSafePublicDemoPort(5173), /5173/);
  assert.throws(() => assertSafePublicDemoPort(5175), /5175/);
});

test("public-demo on funnels 8443 to 5173 and leaves 443/5175 alone", async () => {
  const h = makeHarness();
  try {
    const out = await runDesk({ cmd: "desk", sub: "public-demo", action: "on" }, h.io);
    assert.equal(out.exitCode, 0);
    assert.equal(out.json.on, true);
    assert.equal(out.json.url, `https://${DEMO_DNS}:8443`);
    assert.equal(out.json.target, "http://127.0.0.1:5173");
    const funnel = h.calls.filter((c) => c.cmd === "tailscale" && c.args[0] === "funnel");
    assert.equal(funnel.length, 1);
    assert.equal(funnel[0].args.includes("--https=8443"), true);
    assert.equal(funnel[0].args.includes("http://127.0.0.1:5173"), true);
    assert.equal(
      h.calls.some((c) =>
        c.cmd === "tailscale" &&
        c.args.some((a) => a === "443" || a === "--https=443" || String(a).endsWith(":443")),
      ),
      false,
    );
    assert.equal(
      h.calls.some((c) => c.cmd === "tailscale" && c.args.includes("reset")),
      false,
    );
    assert.equal(h.serve.Web[`${DEMO_DNS}:443`].Handlers["/"].Proxy, "http://127.0.0.1:8222");
  } finally {
    h.cleanup();
  }
});

test("public-demo on refuses a down desk", async () => {
  const down = makeHarness();
  try {
    down.io.health = async () => ({ ok: false, status: 0 });
    const out = await runDesk({ cmd: "desk", sub: "public-demo", action: "on" }, down.io);
    assert.equal(out.exitCode, 1);
    assert.match(out.json.error, /not answering/);
  } finally {
    down.cleanup();
  }
});

test("public-demo on refuses Ready for Duty occupying 8443", async () => {
  const occ = makeHarness();
  try {
    occ.serve.Web[`${DEMO_DNS}:8443`] = {
      Handlers: { "/": { Proxy: "http://127.0.0.1:5175" } },
    };
    occ.serve.AllowFunnel[`${DEMO_DNS}:8443`] = true;
    const on = await runDesk({ cmd: "desk", sub: "public-demo", action: "on" }, occ.io);
    assert.equal(on.exitCode, 2);
    assert.match(on.json.error, /already proxies/);
    assert.match(on.json.hint, /Ready for Duty/);
    const off = await runDesk({ cmd: "desk", sub: "public-demo", action: "off" }, occ.io);
    assert.equal(off.exitCode, 2);
    assert.match(off.json.error, /will not turn it off/);
    assert.equal(occ.serve.AllowFunnel[`${DEMO_DNS}:8443`], true);
  } finally {
    occ.cleanup();
  }
});

test("public-demo off is idempotent when already off", async () => {
  const h = makeHarness();
  try {
    const off = await runDesk({ cmd: "desk", sub: "public-demo", action: "off" }, h.io);
    assert.equal(off.exitCode, 0);
    assert.equal(off.json.on, false);
    assert.equal(
      h.calls.some((c) => c.cmd === "tailscale" && c.args.includes("off")),
      false,
    );
  } finally {
    h.cleanup();
  }
});

test("public-demo off clears funnel then serve on 8443 only", async () => {
  const h = makeHarness();
  try {
    h.serve.Web[`${DEMO_DNS}:8443`] = {
      Handlers: { "/": { Proxy: "http://127.0.0.1:5173" } },
    };
    h.serve.AllowFunnel[`${DEMO_DNS}:8443`] = true;
    const out = await runDesk({ cmd: "desk", sub: "public-demo", action: "off" }, h.io);
    assert.equal(out.exitCode, 0);
    assert.equal(out.json.on, false);
    assert.equal(h.serve.Web[`${DEMO_DNS}:8443`], undefined);
    assert.equal(h.serve.Web[`${DEMO_DNS}:443`].Handlers["/"].Proxy, "http://127.0.0.1:8222");
    assert.equal(h.serve.Web[`${DEMO_DNS}:5175`].Handlers["/"].Proxy, "http://127.0.0.1:5175");
    assert.equal(
      h.calls.some((c) => c.cmd === "tailscale" && c.args.includes("reset")),
      false,
    );
  } finally {
    h.cleanup();
  }
});

test("public-demo on refuses REVDESK_PUBLIC_DEMO_PORT=443", async () => {
  const h = makeHarness();
  try {
    h.io.paths.publicDemoPort = 443;
    const out = await runDesk({ cmd: "desk", sub: "public-demo", action: "on" }, h.io);
    assert.equal(out.exitCode, 1);
    assert.match(out.json.error, /443/);
    assert.equal(
      h.calls.some((c) => c.cmd === "tailscale" && c.args[0] === "funnel" && c.args.includes("--bg")),
      false,
    );
  } finally {
    h.cleanup();
  }
});
