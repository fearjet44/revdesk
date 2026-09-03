# Revdesk — Slice 5: Deferred kind + WIP save + reviewer classifies

Handoff for the coding agent. Behavior lock: `docs/plan/deferred-kind-and-wip.md`.

**Project:** fearjet44/revdesk  
**Depends on:** Slice 4 (author/reviewer desks + kind field) already on main.  
**This slice:** Authors edit and Save without naming TR vs rev. Reviewer classifies after submit.  
**Not this slice:** Git tags (3b), TR incorporate/withdraw matrix, gap-analysis CLI, ingest.

---

## Goal

An author opens a packet, edits sections, **Save**s WIP, **submits**, or **withdraws**.  
They do **not** pick Temporary revision vs Full revision at start.  
After submit, the reviewer **classifies** the packet (`tr` | `rev`), then attaches the instrument and launches.

---

## Files touched

```text
server/types.ts
server/repo.ts            # kind nullable; classify(); launch requires kind
server/plugin.ts          # POST /api/changes/:id/classify
cli/revdesk.ts            # change classify; --kind optional on start
src/types.ts
src/api.ts
src/components/StartChangeDialog.tsx   # no kind radio
src/components/ChangeView.tsx          # PACKAGE KIND panel on reviewer desk
src/components/SectionEditor.tsx       # Save (not Write section)
src/index.css
scripts/slice2-acceptance.sh
scripts/slice3-acceptance.sh
fixtures/tiny-gom/control/changes/CHG-014.yaml   # kind: tr
data/control/changes/CHG-2026-001.yaml           # kind: null
docs/plan/ROADMAP.md
```

Keep the current dark theme.

---

## 1. Kind deferred

`ChangeRecord.kind` is `PackageKind | null`.

- `change start` / UI create: **no kind required**. Optional CLI `--kind` still accepted if the operator already knows.
- Missing kind on disk → `null` (do not silently invent `rev` for open packets).
- Author desk never shows TR/Rev radios.
- Stamp shows `—` until classified; then `TR` / `REV`.

---

## 2. Reviewer classifies

`revdesk change classify <CHG> --kind tr|rev`  
`POST /api/changes/:id/classify` `{ kind }`

Allowed only in `review` | `approved` | `ready-to-launch`.

Rules (same as Slice 4, applied at classify time):

- 0 sections → refuse
- `tr` and touch count ≠ 1 → `A temporary revision touches one section.`
- `rev` allows 1+

Launch (`issue` / `tr issue`) refuses if kind is null.  
`tr issue` requires `kind === tr`. Full `issue` requires `kind === rev`.

UI: **PACKAGE KIND** panel on the reviewer desk; **LAUNCH CONTROLS** only after classified.

---

## 3. WIP Save

Section editor primary button is **Save** (persists to `control/working/…`).  
Do not say stash / Git in the UI.

Author verbs remain: Edit · Save · Submit for review · Withdraw.

---

## 4. Out of scope

- Gap analysis CLI (`revdesk gap` / `manuals find`)
- Partial accept / send-back of individual leaves inside one packet
- `tr_decisions` incorporate/withdraw
- Git adapter (Slice 3b)

---

## Done when

- Start dialog has no package-kind radio
- New packets show stamp `—` until classify
- `change classify` works; launch without classify exits 2
- `npm run test:slice2` and `npm run test:slice3` pass
- Theme unchanged
