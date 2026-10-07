# Revdesk — Roadmap

Refreshed 2026-10-07, after the desktop shell (PR #10) smoked on macOS. Locked pillars 2026-09-03. Rules for agents are in [`AGENTS.md`](../../AGENTS.md). This file says **what** gets built, **who owns which files**, and **in what order**.

## Direction

Revdesk is a **desktop app for the people who write and control the book** (macOS, Windows, Linux). The library is a local git working tree. GitHub or GitLab is the shared, multi-user layer. There is no Revdesk-hosted server. Solo file-backed no-auth mode stays.

Next goal: **dogfood on real company manuals.** The operator has written permission to run Revdesk on the company's books. Those books never enter this repo (see AGENTS.md, Invariants). They live in a private library.

The three pillars still explain the product. Tracks are how the work is cut.

```text
1. Editor and review     author desk, reviewer desk, launch, Issued rail
2. Git adapter           commits, issued/ tags, bound origin (hidden from the UI)
3. Existing-manual ingest  a living GOM / FOTM / TP becomes Revdesk leaves
```

Publish is not launch. Launch is not ingest. Ingest is not the editor.

---

## Tracks and file ownership

One agent works one task in one track at a time. **A task edits only the files its track owns, plus additive hunks in Shared files.** A handoff may grant a named exception, and that exception is the only kind there is.

| Track | Owns |
|---|---|
| **T1 Platform** (desktop shell, Windows/macOS/Linux, packaging, CI, dev tooling) | `src-tauri/**` · `.github/**` · `server/standalone.ts` · `server/tools.ts` · `scripts/tools-check.ts` · `server/config.ts` · `vite.server.config.ts` · `vite.config.ts` · `tsconfig*.json` · `.oxlintrc.json` · `bin/**` · `scripts/desk-deploy*` · `src/components/DoctorView.tsx` · `docs/runbook/desktop.md` |
| **T2 Ingest** | `server/ingest.ts` · `server/ingest/**` · `fixtures/ingest/**` · `scripts/slice6*` · `scripts/slice7*` · `scripts/ingest-*` · `src/components/IngestDialog.tsx` · the generated practice books `data/manuals/gom-lep/**` and `data/manuals/tp/**` · the `ingest` verbs in `cli/revdesk.ts` (the `cmd === 'ingest'` branches, `ingestFileArg`, `formatIngestApply`, and the help lines) |
| **T3 Editor & figures** | `src/schema/**` · `src/components/**` (except `IngestDialog.tsx` and `DoctorView.tsx`) · `src/index.css` · `src/status.ts` · `src/main.tsx` · `index.html` · `public/**` · `src/assets/**` · `server/print.ts` · `server/theme.ts` · `server/mermaid.ts` · `server/figures.ts` · `scripts/roundtrip.ts` · `scripts/steps-check.ts` · `scripts/pdf-check.ts` · `scripts/theme-check.ts` · `scripts/mermaid-check.ts` · `scripts/figures-check.ts` · `scripts/bullets-check.ts` |
| **T4 Control & git** | `server/repo.ts` · `server/git.ts` · `server/ledger.ts` · `server/managed.ts` · `server/diff.ts` · `server/marks.ts` · the non-ingest verbs in `cli/revdesk.ts` · `scripts/compose-check.ts` · `findings-check.ts` · `instrument-bytes-check.ts` · `ledger-check.ts` · `managed-leaves-check.ts` · `review-comments-check.sh` · `slice2/3/9/10-acceptance.sh` · `fixtures/tiny-gom/**` · `data/**` (the sample library, except the two T2 practice books) |

**Shared (additive, small hunks, rebase on `origin/main` right before opening the PR):**
`server/plugin.ts` (router) · the `cli/revdesk.ts` dispatch and usage text · `src/App.tsx` · `src/api.ts` · `server/types.ts` · `src/types.ts` · `package.json` + `package-lock.json` (one dependency change per PR; regenerate the lock after rebasing, never hand-merge it) · `README.md` · `docs/runbook/{README,cli,server}.md` · `.gitignore` · `.gitattributes`

**Planner-only (workers do not edit):**
`AGENTS.md` · `CLAUDE.md` · `docs/plan/**` · `docs/handoffs/**` · `corpus/README.md` · `LICENSE` · `NOTICE`

If a task needs to change a file it does not own, stop and say so in the PR or in chat. The planner either grants an exception in the handoff or splits the work.

---

## Waves

Size: **S** ≈ one sitting, **M** ≈ a day, **L** ≈ several days. **★** = hand it to a stronger model; heuristics-heavy or easy to get subtly wrong.

### Priority: the shortest path to dogfood

The operator needs to make real manual corrections soon. **Everything on the critical path below comes first.** Other tasks run only in slots it doesn't need.

```text
W0 ─┬─► T2.1 ───────────────┐
    │                        ├─► T2.2 (.docx import) ─► D1 dogfood
    └─► T3.3 (bullets) ─► T3.1 (figures) ┘
O1 (operator: Acrobat fixture + corpus) ─► T2.2

T2.2 starts after T2.1 + O1; it does its list step after T3.3 and its figure step after T3.1.
```

**PDF-only books go through Acrobat.** The operator converts each PDF-only manual to .docx with Acrobat (Export PDF → Word) and imports the .docx. A native PDF prose importer (T2.3) is parked until dogfood shows it's needed. T2.2 must therefore handle **Acrobat-exported .docx**, not only clean Word: few or no heading styles, direct formatting, running headers and footers baked into the body, text boxes, and hand-typed numbering.

A task starts when everything in its **Needs** column is merged. Tasks whose needs are met run in parallel; critical-path tasks get the first agent slots.

### Critical path

| ID | Task | Track | Size | Needs | Handoff |
|---|---|---|---|---|---|
| W0 | `server/tools.ts` (one place that finds Chrome/Edge, qpdf, poppler, git, plus `doctor()`); CRLF-safe library reads; `.gitattributes` in this repo and in libraries | all (serial) | S | — | [`W0-FOUNDATIONS.md`](../handoffs/W0-FOUNDATIONS.md) |
| O1 | **Operator:** make a practice .docx fixture with Acrobat (steps in the T2.2 handoff) and convert the real PDF-only books into `corpus/` (local, never committed) | operator | S | — | [`T2.2-DOCX-IMPORT.md`](../handoffs/T2.2-DOCX-IMPORT.md#o1--operator-fixture) |
| T2.1 | Practice mode: lorem becomes opt-in (`--practice`); source-body ingest is the default and refuses the in-repo sample library; no silent overwrite | T2 | S | W0 | [`T2.1-PRACTICE-MODE.md`](../handoffs/T2.1-PRACTICE-MODE.md) |
| T3.3 | Bullet lists: `- ` items in the schema, nesting with steps; editor button; paper styling. The schema has none today, so Word bullets would collapse | T3 | S–M | W0 | [`T3.3-BULLET-LISTS.md`](../handoffs/T3.3-BULLET-LISTS.md) |
| T3.1 | Figure node: markdown ↔ node, read-only render in the editor and Issued, print as data URI, `server/figures.ts`, figure GET/POST | T3 | M | T3.3 (same file; T3 runs serially) | [`T3.1-FIGURE-SCHEMA.md`](../handoffs/T3.1-FIGURE-SCHEMA.md) |
| T2.2 ★ | **.docx import**, including Acrobat exports: leaves, headings, steps, callouts, tables, figures; completeness report gate; honest baseline | T2 | L | T2.1, O1 (T3.3 before its list step, T3.1 before its figure step) | [`T2.2-DOCX-IMPORT.md`](../handoffs/T2.2-DOCX-IMPORT.md) |
| D1 | **Operator dogfood:** import one real GOM into a **private** library, check the report, and work a real correction through launch | operator | — | T2.2 | — |
| D2 | Planner triages what broke into fix tasks with handoffs (these jump the queue) | planner | — | D1 | — |

### Alongside (only in slots the critical path doesn't need)

| ID | Task | Track | Size | Needs |
|---|---|---|---|---|
| T1.1 | Windows build in CI (`.exe` installer) + Windows runtime (node lookup, no console window, PATH, config dirs) — [`T1.1-WINDOWS-BUILD.md`](../handoffs/T1.1-WINDOWS-BUILD.md) | T1 | M | W0 |
| T2.4 | Import report in the desk: IngestDialog shows per-leaf coverage and gaps before it writes; "Bring it in anyway" maps to `--accept-gaps`. Until it lands, D1 can read the report from the CLI | T2 | S | T2.2 |
| T3.2 | Editor figure insert: toolbar **Figure** → file picker → POST → node; caption editing; width menu; replace image | T3 | M | T3.1 |
| T1.2 | Prerequisites screen: `GET /api/doctor` + `DoctorView.tsx`, shown at first run and whenever a tool is missing; per-OS install line (brew / winget / apt) | T1 | S | W0, T1.1 |
| T1.3 | Windows smoke checklist for the Windows user (install, prerequisites, open library, edit/submit, Issued PDF via Edge) | T1 | S | T1.1, T1.2 |
| T4.1 | Private origin + `push_on_launch` for `issued/` tags (never force; never delete a tag) | T4 | M | D1 |

### Parked (not scheduled)

- **T2.3 native PDF prose import** (segment `pdftotext -layout`, strip running heads, rejoin lines). Acrobat → .docx covers it for now. Revisit if Acrobat output is too poor on some book, or for OSS users without Acrobat.
- Bundling Node, qpdf, and poppler in the installers (today: prerequisites + the doctor screen).
- Apple Developer ID notarization and Windows code signing (today: ad-hoc / unsigned; right-click → Open / SmartScreen "Run anyway").
- Phase 1 Rust port of `/api` behind the same contract, using `scripts/*-check.ts` as the parity harness; then drop the Node sidecar.
- Crew distribution, standard users via org email (`identities.md`, `dual-mode.md` — parked).
- CF answers (Done/Stand/Later), reviewer TR incorporate/withdraw, stationery render, forms, distribution push (ForeFlight, OBDS, VOCUS), gap-analysis CLI. These are T4/T3 work for when slots free up.
- Figure numbering and list of figures; change bars.

---

## Tests per track

Every PR runs `npx tsc -b`, `npm run lint`, and `npm run test:md`. Add these too:

| Track | Also run |
|---|---|
| T1 | `npm run build && npm run build:server`; `npm run test:desk` if `scripts/desk-deploy*` changed; CI `desktop` workflow green on all rows |
| T2 | `npm run test:slice6`, `npm run test:slice7`, `npm run test:ingest-docx` (from T2.2 on), and `npm run build:server` when a dependency changed |
| T3 | `npm run test:slice10` if print/pagination changed; `npm run test:review` if a review component changed |
| T4 | `npm run test:slice2`, `test:slice3`, `test:slice9`, `test:slice10`, `test:review` |

The bash acceptance scripts (`scripts/*.sh`) run on macOS and Linux only. Windows CI builds the app; it does not run them.

---

## Status

The planner updates this table when a PR merges. Workers report status in their PR description, not here.

| ID | State | PR |
|---|---|---|
| W0 | ready — **start first** | — |
| O1 | ready (operator) | — |
| T2.1, T3.3 | ready after W0 — critical path, in parallel | — |
| T3.1 | ready after T3.3 — critical path | — |
| T2.2 | ready after T2.1 + O1 — critical path | — |
| T1.1 | ready after W0 — alongside | — |
| T2.4, T3.2, T1.2, T1.3, T4.1 | handoff not written | — |

## Done (history)

Slices 0–4, 3b, 6, 7, 9, 10, write marks, nested steps, document theme, Issued rail, launch file picker, compose window, managed control leaves, page ledger, mermaid diagrams, desktop shell Phase 0 (PR #10). Handoffs for those are under `docs/handoffs/REVDESK-SLICE-*`; they are history, not instructions.
