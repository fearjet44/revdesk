# CLI runbook

Same binary as the desk. No server required. Writes the same YAML/Markdown the UI reads.

## Invoke

From the repo root:

```sh
./bin/revdesk help
./bin/revdesk status
```

`bin/revdesk` is a bash wrapper:

```sh
exec node --experimental-strip-types "$ROOT/cli/revdesk.ts" "$@"
```

Equivalents:

```sh
npm run revdesk -- status
npx revdesk status          # after npm install; package.bin is ./bin/revdesk
```

Needs Node 22+ (`--experimental-strip-types`). Global flag `--json` is valid on every command (machine output; human tables/blocks otherwise).

```sh
./bin/revdesk --json launched gom
```

## Data root

Default: `<repo>/data`.

Override:

```sh
export REVDESK_DATA=/path/to/library
./bin/revdesk status
```

Acceptance scripts copy `fixtures/tiny-gom` to a temp dir and set `REVDESK_DATA` there. That does **not** change the Vite UI, which always uses `<repo>/data`.

`revdesk status` prints the resolved root on the first line (`revdesk · <path>`).

## Exit codes

| Code | Meaning |
|---|---|
| 0 | ok |
| 2 | validation (bad args, wrong state, missing instrument, TR section count, nested git tag, dirty disallowed paths) |
| 3 | not found |
| 4 | not allowed |
| 5 | pipeline |
| 1 | unexpected |

`--json` errors still print `{ "error": "…", "code": N }` on stdout and use the same exit code.

## Commands

```text
revdesk status [--json]
revdesk launched <manual-id>
revdesk manual list | show <id>

revdesk change list
revdesk change start  --manual <id> --title "..." --kind tr|rev --section <id>
                      [--section <id> ...] [--reason "..."] [--reason-type <type>] [--ref <ref>]
                      [--supersedes GOM-Rn]
revdesk change show <CHG>
revdesk change touch <CHG> --section <id> [--action amend]
revdesk change submit <CHG>
revdesk change approve <CHG> [--role <who>]
revdesk change withdraw <CHG> --why "..."
revdesk change return-to-edit <CHG>
revdesk change diff     <CHG> [--section <id>]
revdesk change comments <CHG>
revdesk change comment  <CHG> --section <id> --line N [--side new|old] --body "..."

revdesk instrument attach <CHG> --file <path> --type <type> --authority <who> --dated YYYY-MM-DD
                                [--reference TEXT]
revdesk instrument show   <CHG>

revdesk section get <section-id> --change <CHG> [--out <path>]
revdesk section put <section-id> --change <CHG> --file <path>
revdesk preview <CHG>

revdesk issue <CHG> --effective YYYY-MM-DD
revdesk issue show <GOM-Rn>

revdesk tr issue <CHG> --parent <GOM-Rn> --authority <who> --file <letter> [--expires YYYY-MM-DD]
revdesk tr list [--manual gom]
revdesk tr show <GOM-Rn-TRk>

revdesk git status

revdesk ingest catalogs
revdesk ingest classify <pdf|txt> [--json]
revdesk ingest scaffold --catalog gom-lep|tp [--out dir]
```

`revdesk git` with any other subcommand exits 2. Tags are cut only by `issue` / `tr issue`.

Reviewer comments are **git notes** (`refs/notes/revdesk/review`) on the `change/<CHG>` snapshot commit. The desk paints incoming (green) / outgoing (red) against issued markdown. Inspect outside Revdesk:

```sh
git notes --ref=revdesk/review show change/CHG-2026-003
git show change/CHG-2026-003
```

`ingest classify` inspects control surface (LEP / LES / rev-only) and Nimbl Word house style. It does not copy PDF prose. `ingest scaffold` writes lorem sample books from `fixtures/ingest/catalogs/`.

## Launch model

- A **full revision** exists only after `issue` with a **stored instrument** (letter copied under `control/instruments/` + sha256).
- Operating sooner → `tr issue` against the last launched full rev (`GOM-R13-TR1`).
- After full or TR launch, `change withdraw` exits 2.
- Revision numbers are assigned only at full launch (`manual.next_revision`). `change start` never mints `R14`.
- Four `control_class` values: `faa-approved | faa-accepted | third-party | internal`. All four require an instrument to full-launch. The *kind* of letter changes; the gate does not.

```text
draft → review → approved → ready-to-launch → launched
                              ↘ edit
launched ↛ withdrawn
```

`ready-to-launch` = reviews done **and** a valid instrument attached.

`revdesk launched gom` is the answer to “did it actually launch?”

```text
full:       GOM-R13  launched
active TRs: GOM-R13-TR1
next full:  GOM-R14 (not launched)
```

## Package kind

Chosen at `change start`. Enforced in `server/repo.ts`, not only the UI.

| Kind | Sections |
|---|---|
| `tr` | exactly one (`--section` once) |
| `rev` | one or more |

Zero sections → exit 2. Extra `--section` on a TR → `A temporary revision touches one section.`

Change ids are `CHG-<year>-<nnn>` (next free number in that year). Author stamped on create is currently `Chief Pilot`.

## Worked paths

Sample library in this checkout already has `gom` at `GOM-R13` and open `CHG-2026-001` (rev, draft). The snippets below assume a clean copy (e.g. `fixtures/tiny-gom` via `REVDESK_DATA`) so ids do not collide.

### Open a temporary revision, edit, launch

```sh
./bin/revdesk change start \
  --manual gom \
  --title "Ops control TR" \
  --reason "crew procedure" \
  --kind tr \
  --section gom-ident

./bin/revdesk section get gom-ident --change CHG-2026-002 --out /tmp/gom-ident.md
# edit /tmp/gom-ident.md — keep YAML frontmatter id/title/rev_last_changed
./bin/revdesk section put gom-ident --change CHG-2026-002 --file /tmp/gom-ident.md

./bin/revdesk change submit CHG-2026-002
./bin/revdesk change approve CHG-2026-002

./bin/revdesk tr issue CHG-2026-002 \
  --parent GOM-R13 \
  --authority chief-pilot \
  --file fixtures/tiny-gom/letters/cp-tr-letter.txt

./bin/revdesk launched gom
./bin/revdesk tr show GOM-R13-TR1
```

TR instrument authorities: `chief-pilot | ae | ceo | do`. File is hashed and stored; the original desktop path is not the record.

### Open a full revision, attach letter, issue

```sh
./bin/revdesk change start \
  --manual gom \
  --title "R14" \
  --reason-type regulator \
  --ref "POI 2026-09" \
  --kind rev \
  --section gom-ident \
  --section gom-a

./bin/revdesk change submit CHG-2026-003
./bin/revdesk change approve CHG-2026-003

./bin/revdesk instrument attach CHG-2026-003 \
  --file fixtures/tiny-gom/letters/poi-acceptance.txt \
  --type acceptance-letter \
  --authority poi \
  --dated 2026-09-01

./bin/revdesk issue CHG-2026-003 --effective 2026-09-15
./bin/revdesk issue show GOM-R14
./bin/revdesk launched gom
```

Instrument `--type`: `approval-letter | acceptance-letter | third-party-letter | internal-letter`. Third-party may be a saved `.eml` or PDF; empty `issued/` is not a launch.

Smoke files for the live desk (paste these paths in LAUNCH CONTROLS):

```text
data/letters/poi-approval.txt     # POI letter  (.txt)
data/letters/poi-approval.eml     # POI email   (.eml)
data/letters/chief-pilot-tr.txt   # TR internal letter
```

Attach copies live under `control/instruments/`. Do not edit those; edit the sources in `data/letters/`. The UI path is resolved from the process cwd (repo root when you `npm run dev`).

`issue` of N+1 marks active TRs on N as `incorporated` (default: all active TRs).

### Kickback and withdraw

```sh
# pre-launch only — returns to edit; next full number unchanged
./bin/revdesk change return-to-edit CHG-2026-003

./bin/revdesk change withdraw CHG-2026-003 --why "dropped"
```

Kickback **after** full launch is a new change `--supersedes GOM-R14`; the next successful `issue` is N+1. There is no “unlaunch”.

### Inspect

```sh
./bin/revdesk status
./bin/revdesk manual list
./bin/revdesk manual show gom
./bin/revdesk change list
./bin/revdesk change show CHG-2026-001
./bin/revdesk preview CHG-2026-001
./bin/revdesk instrument show CHG-2026-001
./bin/revdesk tr list --manual gom
./bin/revdesk git status
```

`preview` compares working copies to issued section text. It does not launch.

`change touch` adds a section to an open packet (`--action` currently only `amend`). A TR that already has a section refuses a second touch.

## Git (operator, not UI)

If the data root sits in a manuals git repo, `issue` / `tr issue` commit allowed paths and cut an **annotated** tag after the instrument is stored. No instrument → no tag.

Default refs (overridable in `<data>/.revdesk/git.yaml`):

```text
issued/{abbrev}/{revision}                 # full
issued/{abbrev}/{parent_revision}-TR/{seq} # TR (hyphen form; Git cannot nest under the full tag)
```

YAML/display ids stay `GOM-R14` / `GOM-R13-TR1`. Those strings are never the git ref unless config maps them that way.

`revdesk git status` shows enabled/root/dirty/disallowed. Porcelain outside `manuals/`, `control/`, `artifacts/`, `.revdesk/` blocks a snapshot (exit 2).

If no `.git` is found (or the walk would tag *this* application repo), launch YAML still writes, `source_commit` is null, `git_skipped` is true. The adapter does not `git init` an operator tree.

Never force-move or delete an `issued/` tag. `push_on_launch` defaults false.

Walking up from `data/` in this development checkout finds revdesk’s own `.git`. That is skipped on purpose so sample `issue` does not tag the application.

## Library layout the CLI writes

```
<REVDESK_DATA or data/>
  manuals/<id>/manual.yaml
  manuals/<id>/sections/*.md
  control/changes/CHG-*.yaml
  control/working/CHG-*/…
  control/instruments/…
  control/issues/<MANUAL>-R<n>.yaml
  control/trs/<MANUAL>-R<n>-TR<k>.yaml
  artifacts/…
  .revdesk/git.yaml          # optional
```

## Tests

```sh
npm run test:md
npm run test:slice2    # fixtures/tiny-gom copy; launch + TR YAML
npm run test:slice3    # throwaway git repo in $TMPDIR; does not tag this checkout
npm run test:slice6    # ingest classify + lorem Nimbl sample books
```

Both slice scripts invoke `node --experimental-strip-types cli/revdesk.ts` with `REVDESK_DATA` set to a temp tree.

## Troubleshooting

| Symptom | Check |
|---|---|
| `Unknown command` | `./bin/revdesk help` — subcommand spelling (`change start`, not `start`) |
| `Missing --manual` / `--why` / `--effective` | required flags; `--json` does not skip them |
| Exit 2 on `issue` | no stored instrument, or status is not `approved` / `ready-to-launch` |
| Exit 2 on `tr issue` | parent not launched, wrong authority, TR with ≠1 section |
| Exit 2 on withdraw | already launched (full or TR) |
| UI does not show CLI work | UI reads `<repo>/data`; CLI used another `REVDESK_DATA` |
| `git_skipped` on a real launch | no manuals `.git`, or adapter refused the application repo |
| Tag already exists | exit 2; do not `-f`. Inspect `revdesk git status` and `issue show` |
