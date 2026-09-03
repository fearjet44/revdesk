# Revdesk — Slice 2: Launching and TRs

Handoff for the coding agent. Read this whole file before editing.

**Project:** Revdesk  
**Depends on:** Slice 0 UI (keep the theme), Slice 1 CLI/core (same binary, no second CLI)  
**This slice:** Launch order, instruments, full issue, temporary revisions  
**Not this slice:** GitHub remotes, real PDF pipeline, MCP, TipTap schema work, work-repo branch/tag strategy (Slice 3)

---

## Goal

Make **launch** a real, testable event.

- A full revision cannot exist without a **stored instrument** (letter) plus hashes.
- Operating before that instrument is a **temporary revision** against the last launched full rev.
- After launch (full or TR), **withdraw is dead**.
- A Git tag is not a launch. A stored instrument is.

If Slice 1 already has stub `issue` / `tr` commands, replace the stubs with this behavior. Do not add a second CLI.

---

## Locked rules

1. Revision numbers are assigned only at **full launch**. `change start` and `change start --supersedes` never mint `R14` / `R15`.
2. Four `control_class` values on a manual: `faa-approved | faa-accepted | third-party | internal`. All four require an instrument to full-launch. The *kind* of letter changes; the gate does not.
3. States:

```text
draft → review → approved → ready-to-launch → launched
                              ↘ edit
launched ↛ withdrawn
```

4. `ready-to-launch` = internal reviews done **and** a valid instrument attached.
5. `issue` writes `control/issues/`, stores instrument + manual hashes, assigns the next full rev, sets `manual.current_issued`. Git tag may be a stub string in this slice.
6. No instrument + user wants pages out now → **only** `tr issue` against `current_issued`.
7. TR identity: `{MANUAL}-R{N}-TR{k}` e.g. `GOM-R13-TR1`. Parent must already be `launched`.
8. TR requires its own instrument (`internal-letter` from `chief-pilot | ae | ceo | do`).
9. After `issue` or `tr issue`, `change withdraw` exits 2.
10. Regulator/AE kickback **before** full launch → change returns to `edit`; next full number is unchanged.
11. Kickback **after** full launch → new change `--supersedes RN`; next successful `issue` is N+1.
12. Full `issue` of N+1 marks active TRs on N as `incorporated` (default: incorporate all active TRs).

There is no “temporary launch of R14” path. Do not invent POI/CAA letters.

---

## Files this slice owns

```text
control/instruments/<id>.pdf   # or .md letter; hash the bytes
control/issues/<MANUAL>-R<n>.yaml
control/trs/<MANUAL>-R<n>-TR<k>.yaml
manuals/<id>/manual.yaml       # current_issued, next_revision, control_class
```

`instrument attach` copies the file into `control/instruments/` and records `sha256`. Do not keep the only copy on the user’s original desktop path.

---

## Record shapes

### Full issue (`control/issues/GOM-R14.yaml`)

```yaml
id: GOM-R14
kind: full
state: launched
manual: gom
revision: 14
control_class: faa-accepted
supersedes: GOM-R13
change: CHG-2026-014
effective: 2026-09-15
instrument:
  type: acceptance-letter      # approval-letter | acceptance-letter | third-party-letter | internal-letter
  authority: poi
  file: control/instruments/GOM-R14-poi-acceptance.pdf
  sha256: ...
  dated: 2026-09-12
  reference: "POI 2026-0912"
manual_artifact:
  file: artifacts/GOM-R14.pdf  # placeholder allowed this slice
  sha256: placeholder-or-real
git_tag: GOM-R14               # stub ok this slice
incorporated_trs: [GOM-R13-TR1]
launched_at: ...
```

### Temporary revision (`control/trs/GOM-R13-TR1.yaml`)

```yaml
id: GOM-R13-TR1
kind: temporary-revision
state: launched
manual: gom
parent: GOM-R13
seq: 1
change: CHG-2026-014
authority: chief-pilot
instrument:
  type: internal-letter
  authority: chief-pilot
  file: control/instruments/GOM-R13-TR1-cp.pdf
  sha256: ...
expires: 2026-12-15            # or omit / next-full
incorporated_by: null          # set to GOM-R14 on full issue
launched_at: ...
```

### Manual fields (must exist)

```yaml
id: gom
control_class: faa-accepted    # faa-approved | faa-accepted | third-party | internal
current_issued: GOM-R13        # null if never launched
next_revision: 14
authority: poi
instrument_required: true
```

---

## CLI — same binary, these verbs must be real

```text
revdesk instrument attach <CHG> --file <path> --type <type> --authority <who> --dated YYYY-MM-DD [--reference TEXT]
revdesk instrument show   <CHG>

revdesk issue <CHG> --effective YYYY-MM-DD
revdesk issue show <GOM-R14>

revdesk tr issue <CHG> --parent <GOM-R13> --authority <who> --file <letter> [--expires YYYY-MM-DD]
revdesk tr list [--manual gom]
revdesk tr show <GOM-R13-TR1>

revdesk launched <manual>
revdesk change withdraw <CHG>
revdesk change start --manual gom --supersedes GOM-R14 --reason-type regulator
revdesk change return-to-edit <CHG>    # pre-launch kickback only
```

Behavior:

- `issue` with no attached instrument → **exit 2**, tell the user to attach a letter **or** `tr issue`. No third option.
- `tr issue` if parent is not launched → **exit 2**.
- `tr issue` if manual has **no** launched parent (greenfield) → **exit 2**, tell them to full-launch R1 with an `internal-letter`.
- `change withdraw` after full or TR launch → **exit 2**.
- `change return-to-edit` after launch → **exit 2**.
- `change start --supersedes` creates a new change only. It does **not** write an issue file or bump `next_revision`.

`revdesk launched gom` human output:

```text
full:       GOM-R13  launched
active TRs: GOM-R13-TR1
next full:  14 (not launched)
```

`--json` on every command.

Exit codes (keep Slice 1 contract):

- `0` ok
- `2` validation / illegal state
- `3` not found
- `4` not allowed
- `5` pipeline failed (unused this slice)

---

## UI (Slice 0 wiring only)

Do not restyle the theme.

On the change desk:

- Instrument attached → primary button **Launch full revision**
- No instrument → primary **Issue temporary revision**; Launch disabled with the reason
- After launched (full or TR) → hide **Withdraw**
- Status chip reflects `revdesk launched` (full rev + active TRs)

---

## Fixture (required)

Use / create `fixtures/tiny-gom`:

- `control_class: faa-accepted`
- `current_issued: GOM-R13` with a fixture issue record + dummy instrument hash
- One approved change `CHG-014` touching `gom.2.4.3`
- Sample letter files under `fixtures/tiny-gom/letters/` (any small PDF or text file is fine)

---

## Acceptance path (must pass)

Script this as tests or a documented command sequence.

| # | Action | Expect |
|---|---|---|
| 1 | `issue CHG-014` with no instrument | exit 2, hint TR |
| 2 | `tr issue CHG-014 --parent GOM-R13` + CP letter | `GOM-R13-TR1` launched; withdraw dies |
| 3 | `launched gom` | R13 + TR1, next full 14 not launched |
| 4 | `instrument attach` POI letter on a change that can full-launch, then `issue` | `GOM-R14` launched; TR1 `incorporated_by: GOM-R14` |
| 5 | `withdraw` that change after launch | exit 2 |
| 6 | `change start --supersedes GOM-R14` | new CHG, **no** R15 issue file |
| 7 | `issue` that new CHG without letter | exit 2 (still no R15) |
| 8 | Change in `ready-to-launch` (letter attached, not issued), `return-to-edit` | state `edit`; next full number **unchanged** |
| 9 | Greenfield manual, no `current_issued`, `tr issue` | exit 2 |
| 10 | Greenfield + `internal-letter` + `issue` | creates `GOM-R1` launched |

---

## Out of scope

- Do not generate or invent POI/CAA letters
- Placeholder manual PDF hash is fine
- Do not implement Git tag push
- Do not auto-expire TRs on a timer; store `expires` and list them

---

## Done when

- `revdesk launched` is the answer to “did it actually launch?”
- A tag-shaped id cannot appear in `control/issues/` without an instrument hash
- Crews can be on R13+TR without the tool claiming R14
- Slice 0 theme is unchanged; Slice 1 CLI is the same binary
