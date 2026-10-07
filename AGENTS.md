# AGENTS.md — Revdesk rules for coding agents

This is the one rulebook. `CLAUDE.md` imports it. Handoffs and plan docs add detail. If one of them contradicts this file, stop and ask; do not pick.

## 1. What Revdesk is

A **desktop app for the people who write and control an operator's manuals** (GOM, training program, and so on): an editor plus a change-control desk. It runs on macOS, Windows, and Linux as a Tauri shell (`src-tauri/`) with the Node server (`server/`) as a loopback sidecar. The React desk lives in `src/`. The CLI (`cli/revdesk.ts`) has the same verbs and needs no server.

The **library** is a folder: Markdown leaves with YAML frontmatter plus control YAML (`manuals/`, `control/`, `artifacts/`, `.revdesk/`). When it is a git working tree, Revdesk commits and tags it, and a bound GitHub/GitLab origin is the shared, multi-user layer. There is no Revdesk-hosted server. **Solo file-backed no-auth mode is not a prototype. It stays.**

## 2. Read order

1. This file.
2. [`docs/plan/ROADMAP.md`](docs/plan/ROADMAP.md): find your task ID, its **track**, and the files that track owns.
3. Your handoff in `docs/handoffs/` (for example `T2.1-PRACTICE-MODE.md`). It names the files you may touch and what "done" means.
4. The lock docs the handoff names (`docs/plan/*.md`). Do not weaken a lock. If one is in your way, say so.

No handoff, no task. If you were asked to do something with no handoff, do it only if it fits inside one track's files. Otherwise ask.

## 3. Invariants (never weaken)

- **The desk never says Git.** No "branch", "commit", "tag", "push", "merge", or "repo" in UI text. The reviewer screen may show a line diff. Use the words the runbooks use (library, launch, issued, bind).
- **Never `git push --force`. Never delete or move an `issued/` tag.** A hand-moved tag must show `tag_ok: false`. Do not "fix" that.
- **A full revision exists only after `issue` with a stored, hashed instrument** (letter + sha256). Operating sooner is a TR against the last launched revision. Revision numbers are assigned at full launch only.
- **Publish ≠ issued.** Nothing pushes a book to crews unless Revdesk would allow a TR or a launched revision.
- **Company manuals never enter this repo.** Real operator text, figures, and PDFs go to a private library (a folder or a private repo the operator binds), never to `data/`, `fixtures/`, `corpus/` commits, test snapshots, or PR descriptions. `corpus/` is gitignored for local parser training only. The in-repo `data/` library is the public **practice** sample (placeholder text).
- **No smoke dirt in commits.** Do not commit CHGs, crew findings, working copies, or ledgers that you created while poking the desk.
- **LEP and managed leaves follow their locks**: `lep-page-ledger.md`, `managed-leaves.md`, `issued-pdf.md`, `mermaid.md`, `figures.md`. ROR, LEP, LES, and TOC are managed, not author pages. `rev-only` books do not get an invented LEP.
- **Blank forms are leaves. Filled, signed forms are records.** Do not mix them.
- **Exit codes are the contract**: `0` ok · `2` validation · `3` not found · `4` not allowed · `5` pipeline/tool. Throw `RepoError(code, message)`.

## 4. Tracks, ownership, collisions

The table in the ROADMAP is the authority. In short: **T1 Platform** (`src-tauri/`, CI, `server/tools.ts`, `server/config.ts`, standalone), **T2 Ingest** (`server/ingest*`, `fixtures/ingest/`, IngestDialog), **T3 Editor & figures** (`src/schema/`, components, `server/print.ts`, `server/figures.ts`), **T4 Control & git** (`server/repo.ts`, `git.ts`, `ledger.ts`, `managed.ts`, the sample `data/`).

Rules:

1. **Edit only files your track owns.** A handoff may grant a named exception. Nothing else counts as one.
2. **Shared files** (`server/plugin.ts`, the `cli/revdesk.ts` dispatch, `src/App.tsx`, `src/api.ts`, `server/types.ts`, `src/types.ts`, `package.json` + lock, `README.md`, `docs/runbook/{README,cli,server}.md`, `.gitignore`, `.gitattributes`): **add**, don't rewrite. Keep hunks small. Put a new route or verb next to its siblings; don't reorder existing ones. Rebase on `origin/main` right before you open the PR. For the lockfile, take main's version and rerun `npm install`; never hand-merge it.
3. **Planner-only files** (`AGENTS.md`, `CLAUDE.md`, `docs/plan/**`, `docs/handoffs/**`, `corpus/README.md`): do not edit. If one is wrong, say so in the PR description.
4. **Before starting**, run `gh pr list --state open`. If another open PR touches a file **your track owns** for this task, do not start. Say which PR and which file.
5. **One task = one branch = one PR.** Do not fold in "while I was here" fixes from another track. List them in the PR description instead.

## 5. Workflow

`origin/main` is the source of truth. The land path is a GitHub PR, for local and cloud agents alike.

```sh
git fetch origin
git worktree add -b t2/practice-mode .worktrees/t2-practice-mode origin/main
cd .worktrees/t2-practice-mode && npm ci
```

- Branch name `t<track>/<slug>` (`w0/foundations`, `t1/windows-build`, …). Worktrees live in `.worktrees/<name>` inside the repo (gitignored). Never work in the primary checkout.
- Commit on the branch, push, and open a PR against `main`. Title: conventional commit (`feat(ingest): …`). The body must have:
  - the task ID and a link to the handoff
  - **Tested**: a checkbox list of the commands you ran and what you checked by hand, PR #10 style. Unchecked means not done; say why.
  - **Out of track**: anything you noticed and did not fix.
- Do not merge. Do not merge or fast-forward into a local checkout to "run it." Do not delete your worktree when you finish; the operator may test it. Cleanup is a separate job (below).
- Never rewrite published history (`--force`) on a branch someone else may have pulled.

### Clean worktrees (only when the operator asks)

The operator may say "clean worktrees." That means: remove the worktrees and local branches of PRs that are **merged**, and nothing else. Run it from the primary checkout.

```sh
git fetch --prune origin
git worktree prune
git worktree list
```

For each worktree under `.worktrees/`:

1. Find its branch and its PR: `gh pr list -R fearjet44/revdesk --state all --head <branch> --json number,state`.
2. **Skip it** and report why if any of these is true:
   - the PR is open or closed-unmerged, or there is no PR
   - `git -C <worktree> status --porcelain` is not empty (uncommitted work)
   - `git -C <worktree> log origin/<branch>..HEAD` is not empty (commits that were never pushed)
   - on the Linux box, `./bin/revdesk desk status` shows the desk deployed from that worktree
3. Otherwise:
   - `git worktree remove <path>`, with no `--force`
   - then `git branch -d <branch>`. Use lowercase `-d`. If it refuses ("not fully merged", for example after a squash merge), leave the branch and report it. Do not switch to `-D`.

Finish with a short table: removed, skipped (and why). Never delete remote branches, never touch the primary checkout's branch, and never run `rm -rf` on a worktree directory. If `git worktree remove` fails, report it.

## 6. Build and test

```sh
npm ci
npx tsc -b              # types
npm run lint            # oxlint
npm run test:md         # schema round-trip, steps, theme, pdf, findings, instrument, compose, managed, ledger
npm run test:slice6     # ingest classify + practice scaffold
npm run test:slice7     # bind + ingest from file
npm run test:slice2 / test:slice3 / test:slice9 / test:slice10 / test:review
npm run build && npm run build:server   # dist/ + dist-server/server.mjs
npm run desktop         # Tauri dev window (needs Rust)
npm run desktop:build   # installer for this OS
```

The ROADMAP lists which tests each track must run. The `scripts/*.sh` acceptance scripts are bash (macOS and Linux). PDF tests need Chrome or Chromium (Edge on Windows), qpdf, and poppler. Tests that need the gitignored `corpus/` skip when it is empty; keep it that way.

Tests run against temp directories (`mkdtemp`) or `fixtures/`. Never point a test at the operator's library.

## 7. Running the desk, per machine

- **macOS (primary dev machine now):** `npm run dev` (Vite on `127.0.0.1:5173`) or `npm run desktop`. Prerequisites: `brew install node git qpdf poppler` plus Google Chrome. Build the `.dmg` locally (Xcode CLT + rustup) or take it from CI. See `docs/runbook/desktop.md`.
- **Windows:** use the installer from CI. Prerequisites go through winget; see `docs/runbook/desktop.md`.
- **The Linux box (`~/Work/revdesk`) only:** the desk there is the systemd **user** unit `revdesk.service` running `npm run dev`. On that box, do **not** also run `npm run dev` (it fights the unit for `:5173`); Ready for Duty owns `:5175`. Test a PR with `./bin/revdesk desk deploy --pr N` (or `--branch`/`--tree`), return with `./bin/revdesk desk origin`. `~/Work/revdesk` is fast-forward only from origin, not a merge target. Restart the unit after a `server/plugin.ts`-family change (`systemctl --user restart revdesk`); HMR does not reload the API. Tailscale Serve, the `public-demo` Funnel on `:8443`, and the port rules are in `docs/runbook/server.md`. All of this is dev tooling, not the product.

## 8. Code conventions

- TypeScript run directly by Node (`node --experimental-strip-types`). Import with the `.ts` suffix. No build step for server or CLI code in dev.
- Match the surrounding style: small functions, early returns, no classes where a function will do, few comments, and a comment only when it explains *why*. Prose in docs and UI copy is short and plain.
- **External binaries** (Chrome/Edge, `qpdf`, `pdftotext`, `pdfinfo`, `pdffonts`, `git`) are resolved through `server/tools.ts`. Do not hard-code a path or call a bare binary name elsewhere.
- **Library text** is read through the CRLF-normalizing reader (`readLibraryText` in `server/tools.ts`), so Windows checkouts parse.
- Section Markdown is produced by building `JSONContent` and calling `serializeBody()` (`src/schema/markdown.ts`). Never concatenate Markdown strings for leaf bodies, so the editor can always parse what was written.
- **No new npm dependency** unless the handoff names it. Prefer pure-JS packages that bundle into `dist-server/server.mjs`; native modules break the desktop bundle.
- Keep paths portable: `path.join`, never `'/'` string joins for filesystem paths. The library's own relative paths (`manuals/<id>/…`) stay forward-slash.
- UI copy follows §3: no Git words.

## 9. Crew findings (`control/findings/`)

YAML notes a crew leaves on an **issued** leaf: one file per finding, `control/findings/<issue-id>/cf-….yaml`. They are not written into `manuals/<id>/sections/*.md` and never ride `issued/` at launch (lock: `docs/plan/issued-pdf.md`). The path is deliberately **not** gitignored: findings are control records like `control/changes/`, and `control/` is an allowed snapshot prefix. Do not add it to `.gitignore`. Do not commit smoke findings. Solo mode has one identity (Chief Pilot). Answers (Done/Stand/Later) are later.

## 10. When you are stuck

Say so plainly in the PR description or in chat: what you tried, what failed, the exact error. Do not widen scope to get unstuck. Do not weaken a test to make it pass. Do not invent a lock.
