# Server runbook

The Revdesk “server” is the Vite dev process. It serves the React desk and mounts the control API as middleware. There is no separate Node HTTP binary.

## Start

On this box the desk is a systemd user unit. Do not also `npm run dev` in a terminal — that fights the unit for the port.

```sh
systemctl --user start revdesk
systemctl --user restart revdesk
systemctl --user stop revdesk
systemctl --user status revdesk
journalctl --user -u revdesk -f
./bin/revdesk desk status
./bin/revdesk desk deploy --pr 2
./bin/revdesk desk origin
./bin/revdesk desk public-demo on
./bin/revdesk desk public-demo off
```

That runs `vite`. Open **http://127.0.0.1:5173**. Restart the unit after a debug change that needs a full Vite process (not just HMR).

### Deploy a PR from a worktree

`origin/main` is the source of truth. `~/Work/revdesk` is the default live desk (fast-forward only from origin). It is **not** a merge target. Cloud and local agents both land via GitHub PR.

To test a branch without merging it:

```sh
./bin/revdesk desk deploy --pr 2
./bin/revdesk desk deploy --branch feat/ingest
./bin/revdesk desk deploy --tree ~/Work/revdesk/.worktrees/feat-ingest
```

Worktrees live at `.worktrees/<job>` inside the repo (gitignored), not under `~/Work/.worktrees`. Same layout on Ready for Duty and other desks. `deploy --pr` / `--branch` creates them there.

That writes `~/.config/systemd/user/revdesk.service.d/tree.conf` (`WorkingDirectory=` the worktree), `daemon-reload`, and restarts the unit. One desk, one port, one tree. Do not `npm run dev`.

```sh
./bin/revdesk desk origin
```

Deletes the drop-in, `git pull --ff-only` in the primary checkout, and restarts. Refuses if primary is dirty — commit or discard; do not stash as part of deploy.

The library is `<tree>/data`. Switching trees switches the sample library with the code. Do not pin `data/` outside the tree yet. Local smoke CHGs on primary will not appear on a PR worktree.

Vite **binds loopback only** (`127.0.0.1:5173`, `strictPort: true`). Do not pass `--host` or bind the Tailscale IP. Remote access is Tailscale Serve in front of loopback:

```sh
tailscale serve --bg --https=5173 http://127.0.0.1:5173
```

Then the desk is also at `https://<magicdns>:5173` on the tailnet. Serve occupies the tailnet `:5173`; Vite still owns localhost. `strictPort` stops Vite from walking 5174 — Ready for Duty owns **:5175**.

A colleague **on the tailnet** uses that `:5173` URL. For a public demo (no Tailscale client on their side):

```sh
./bin/revdesk desk public-demo on
./bin/revdesk desk public-demo off
```

That is Tailscale Funnel on **:8443** → `http://127.0.0.1:5173`. Funnel cannot use `:5173` (public listeners are 443 / 8443 / 10000). It **refuses :443** (Bitwarden on `127.0.0.1:8222`) and **:5175** (RFD). One public demo at a time: if Ready for Duty already Funnels `:8443`, this exits 2 until `rfd desk public-demo off`. It never runs `tailscale serve reset`. URL:

`https://brendanthenavigator.mole-bushmaster.ts.net:8443`

Chrome **Use secure DNS** must be Google (or off). Cloudflare `1.1.1.1` NXDOMAINs the Funnel A record.

If localhost:5173 is dead but Serve is still up, the magicdns URL will 400/fail — `systemctl --user restart revdesk`, not Serve.

First-time install needs Node **20.19+** or **22.12+** (Vite 8). The CLI additionally uses `--experimental-strip-types` (Node 22 is the comfortable target).

Leave Serve in place unless you mean to drop remote access. Without systemd, `npm run dev` from the repo root is the fallback — stop the unit first.

### What this starts

| Piece | Source | Notes |
|---|---|---|
| UI | `src/` via Vite | Routes under `/`, `/manuals/:id`, `/changes/:id`, `/issues/:id` |
| Control API | `server/plugin.ts` | Prefix `/api/` |
| Library | `data/` | Hard-coded in `vite.config.ts` — **not** `REVDESK_DATA` |

The plugin constructs `new Repo('<repo>/data')` once at process start. Reloading the page re-reads files; restart the process if you swap the tree on disk.

`npm run preview` is a static file server only. It does **not** mount `/api`. Do not use it as the desk.

`npm run build` typechecks and emits a static bundle. It does not start a control server.

## Health

The desk is up when:

1. Vite prints `http://127.0.0.1:5173/` (it will **exit** if that port is taken — it does not walk 5174).
2. `GET /api/desk` returns JSON with `manuals`, `changes`, `issues`, `trs`.

```sh
curl -sS http://localhost:5173/api/desk | head
```

The masthead in the UI reads `LOCAL LIBRARY · NO AUTH · FILE-BACKED`. There is no login.

If the banner says it cannot read the control library, the API failed (wrong cwd, missing `data/`, or the process is preview/static rather than `npm run dev`).

## Data root

Always `<repo>/data` for the server:

```
data/
  manuals/<id>/manual.yaml
  manuals/<id>/sections/*.md
  letters/…                    # sample POI letter + .eml; choose in the launch picker
  control/changes/CHG-*.yaml
  control/working/CHG-*/…
  control/instruments/…
  control/issues/<MANUAL>-R<n>.yaml
  control/trs/<MANUAL>-R<n>-TR<k>.yaml
  artifacts/…
```

Sample bodies in `data/` are lorem ipsum. Real operator manuals for parser training go in `corpus/` (gitignored). Do not commit them.

To drive the **CLI** against a different tree (fixtures, a throwaway copy), set `REVDESK_DATA`. That does not change what the UI sees. Point the UI at another library by copying it over `data/` or changing the path in `vite.config.ts` and restarting.

## API

JSON in, JSON out. `Content-Type: application/json`. No auth. Failed calls return `{ "error": "…", "code": <repo status> }`.

Repo status → HTTP:

| Repo | HTTP | Meaning |
|---|---|---|
| 2, 5 | 409 | validation / pipeline |
| 3 | 404 | not found |
| 4 | 403 | not allowed |
| other | 400 | client error |
| thrown Error | 500 | unexpected |

### Routes

| Method | Path | Same CLI verb |
|---|---|---|
| GET | `/api/desk` | `revdesk status` (richer payload) |
| GET | `/api/launched/:manual` | `revdesk launched` |
| GET | `/api/manuals` | `revdesk manual list` |
| GET | `/api/manuals/:id` | `revdesk manual show` |
| GET | `/api/manuals/:id/sections/:section` | issued section text |
| GET | `/api/changes` | `revdesk change list` |
| POST | `/api/changes` | `revdesk change start` |
| GET | `/api/changes/:id` | `revdesk change show` |
| POST | `/api/changes/:id/touch` | `revdesk change touch` |
| POST | `/api/changes/:id/instrument` | `revdesk instrument attach` (desk: `filename` + base64 `content`; no server path) |
| POST | `/api/changes/:id/return-to-edit` | `revdesk change return-to-edit` |
| POST | `/api/changes/:id/withdraw` | `revdesk change withdraw` |
| GET | `/api/changes/:id/preview` | `revdesk preview` |
| GET | `/api/changes/:id/sections/:section/review` | `revdesk change diff` |
| GET | `/api/changes/:id/comments` | `revdesk change comments` |
| POST | `/api/changes/:id/comments` | `revdesk change comment` |
| POST | `/api/changes/:id/comments/:id/answer` | `revdesk change answer` |
| GET | `/api/changes/:id/sections/:section` | `revdesk section get` |
| PUT | `/api/changes/:id/sections/:section` | `revdesk section put` (body `{ "markdown", "mark", "note" }`) |
| POST | `/api/changes/:id/transition` | `submit` / `approve` |
| POST | `/api/changes/:id/issue` | `revdesk issue` |
| POST | `/api/changes/:id/tr` | `revdesk tr issue` (desk: `filename` + base64 `content`; no server path) |
| GET | `/api/issues` | — |
| GET | `/api/issues/:id` | `revdesk issue show` |
| GET | `/api/trs` | `revdesk tr list` (`?manual=`) |
| GET | `/api/trs/:id` | `revdesk tr show` |

`POST /api/changes` body:

```json
{
  "manual": "gom",
  "title": "…",
  "reason": "…",
  "reasonType": "regulator",
  "reasonRef": "…",
  "kind": "tr",
  "sectionIds": ["gom-ident"],
  "supersedes": "GOM-R13"
}
```

`kind` is `tr` or `rev`. A TR must touch exactly one section. A rev must touch one or more. Zero sections is refused.

`POST /api/changes/:id/transition` body: `{ "action": "submit" | "approve", "role": "…" }`.

Instrument attach copies the letter into `control/instruments/` and records sha256. The HTTP desk sends `filename` + base64 `content` (no server path). CLI still uses `--file`. `issue` / `tr` require a stored instrument; there is no “posted without letter” path.

## Shared state with the CLI

The UI and `./bin/revdesk` are two fronts on `server/repo.ts`. If the CLI’s data root is the default `data/`, a launch in the terminal shows up after a UI refresh, and the reverse.

Do not run two writers against the same change package on purpose (editor + `section put`, or two Vite processes). Last write wins; there is no lock server.

Git tags (when a manuals repo is discovered) are cut only by `issue` / `tr issue`. The reviewer screen is the exception: it shows a GitHub-style line diff and writes comments as git notes (`revdesk/review`) on `change/<CHG>`. `revdesk git status` is still the operator check for launch dirtiness.

## Typical desk path

1. Open http://localhost:5173.
2. Home lists manuals, open changes, issued revs.
3. Author opens a TR or rev, edits working copies under `control/working/<CHG>/`, submits.
4. Reviewer attaches an instrument and launches (full `issue` or `tr issue`).
5. Confirm with `revdesk launched gom` or `GET /api/launched/gom`.

States:

```text
draft → review → approved → ready-to-launch → launched
                              ↘ edit
launched ↛ withdrawn
```

`ready-to-launch` = internal reviews done **and** a valid instrument attached. After full or TR launch, withdraw is refused.

## Troubleshooting

| Symptom | Check |
|---|---|
| Page loads, masthead error about the library | Process is not the `revdesk` unit / `npm run dev`, or `data/` is missing |
| Port already in use | Vite **exits**. Stop the other process (usually a leftover `npm run dev`). Do not walk onto 5175 (RFD) |
| CLI changes do not appear in the UI | CLI used `REVDESK_DATA`; UI always reads `data/` |
| `npm run preview` 404s `/api/desk` | Expected. Use `npm run dev` |
| Launch from the UI fails with validation | Same rules as the CLI: instrument, status, TR one-section |
| Git words in the UI | Bug. Git stays in `server/git.ts` + `revdesk git status` |
| Desk attach still asks for a path | Old tree. `revdesk desk origin` or deploy this branch. HTTP body is `filename` + `content`, not `file` |
| `revdesk desk origin` exit 2, primary is dirty | Commit or discard. Do not stash as part of deploy |
| `revdesk desk deploy` — Vite did not answer | `journalctl --user -u revdesk -n 80`. Do not `npm run dev` |
| DNS_PROBE_FINISHED_NXDOMAIN | Wrong hostname (`ready-for-duty…` is not this machine). Off-tailnet needs `public-demo on` and **:8443**. Chrome secure DNS: Google, not 1.1.1.1 |
| `public-demo on` exit 2, already proxies :5175 | RFD owns Funnel :8443. `rfd desk public-demo off` first |
| Public demo 404/timeout | Funnel is off, or you hit `:5173` from the open internet. `:5173` is tailnet-only |

## Tests that exercise the same code

```sh
npm run test:md       # markdown roundtrip
npm run test:slice2   # launch / TR YAML (temp copy of fixtures/tiny-gom)
npm run test:slice3   # git adapter (throwaway repo in $TMPDIR)
npm run test:slice6   # ingest classify + lorem Nimbl sample books
npm run test:desk     # desk deploy drop-in / worktree (no systemd)
```

Those scripts call the CLI, not Vite. They do not require the server to be running.
