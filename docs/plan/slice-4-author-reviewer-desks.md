# Revdesk — Slice 4: Author / reviewer desks + package kind

Handoff for the coding agent. Read `docs/plan/change-package-model.md` first.

**Project:** fearjet44/revdesk  
**Depends on:** Slice 0–2 UI/CLI already on main. Slice 3 Git adapter is separate and must not be started here.  
**This slice:** Split the change screen. Package kind is TR | Rev. Launch leaves the author desk.  
**Not this slice:** Git tags, stacked PRs, TR incorporate/withdraw matrix at launch, theme restyle, GitHub.

---

## Goal

An author in `draft` / `edit` only **submits** and **withdraws**.  
A reviewer in `review` / `approved` / `ready-to-launch` attaches the instrument and launches.  
Kind is chosen when the packet is opened. A TR is one section. A rev may be many.

---

## Files you will touch

```text
src/components/StartChangeDialog.tsx
src/components/ChangeView.tsx
src/types.ts
src/api.ts
server/types.ts
server/repo.ts          # persist kind; enforce TR touch count
cli/revdesk.ts          # change start --kind tr|rev
docs/plan/change-package-model.md   # already on main; do not rewrite
```

Keep the current dark theme.

---

## 1. Package kind

Add `kind: 'tr' | 'rev'` on `ChangeRecord` and `change.yaml`.

`revdesk change start` / `api.startChange` take `kind` plus `sectionIds`.

Rules (core, not just UI):

- 0 sections → exit 2 / refuse create
- `kind=tr` and `sectionIds.length !== 1` → exit 2  
  message: `A temporary revision touches one section.`
- `kind=rev` allows 1 or more sections
- Start dialog: radio **Temporary revision** / **Full revision**
  - 2+ sections checked → force Rev, disable TR, show the one-line warn
  - 1 section → either kind
- Existing open packets with 2+ touches and no `kind`: treat as `rev` (CHG-2026-001)
- Existing single-touch packets with no `kind`: default `rev` unless you infer otherwise; do not silently make them TRs

Stamp block shows `TR` or `REV` next to status.

---

## 2. Author desk (`draft`, `edit`)

`ChangeView` when status is `draft` or `edit`:

Buttons only:

- **Submit for review** (existing submit transition)
- **Withdraw**

Show: title, reason, touched sections + Edit, packet log.

Do **not** show:

- Launch full revision
- Launch full revision (needs instrument) — delete this button entirely
- Issue temporary revision
- LAUNCH CONTROLS panel (instrument path, TR letter path, effective date)

Banner: working path only.

```text
Working copies live under control/working/CHG-2026-001.
```

No lecture about instruments.

Optional while `draft`: allow adding/removing sections with the same kind rules (TR cannot grow to two sections without flipping kind to rev first). If that is extra work, skip add/remove and only enforce at start. Prefer enforce at start this slice.

---

## 3. Reviewer desk (`review`, `approved`, `ready-to-launch`)

Keep approve / return-to-edit as they exist.

Show **LAUNCH CONTROLS** only here.

- Instrument path + dated + Attach
- If instrument path is empty, that **field** gets the error style (`banner error` / red border). Text: `Launch document required.`
- Launch button label is just **Launch revision** or **Issue temporary revision** based on `change.kind`. Do not put “(needs instrument)” on the button. Disable the button when the field is empty.
- Effective date on this panel only
- TR letter + authority only when `kind === 'tr'`
- Full instrument types when `kind === 'rev'` (acceptance-letter default for faa-accepted manuals is fine)

`kind === 'tr'` → call existing `issueTr` (still requires internal letter).  
`kind === 'rev'` → call existing `issueFull` (still requires stored instrument).

Do not let a two-section packet call `issueTr`.

After `launched` or `withdrawn`: no launch panel, no withdraw.

---

## 4. CLI

```text
revdesk change start --manual gom --title "..." --reason "..." --kind tr --section gom-ident
revdesk change start --manual gom --title "..." --reason "..." --kind rev --section gom-ident --section gom-a
```

Refuse TR + two sections. `--json` includes `kind`.

Do not change Slice 2 launch gates.

---

## 5. Out of scope

- `tr_decisions` incorporate/withdraw UI
- Git / PRs
- File picker vs raw path (path input stays)
- Role-based auth (desk is inferred from **status**, not login)

---

## Done when

- Opening CHG-2026-001 in draft shows Submit + Withdraw only
- That packet displays as REV
- Start dialog cannot create a TR with two sections
- Reviewer states show instrument field; empty field is red; no disabled launch button with parenthetical warning
- `npm run test:slice2` still passes
- Theme unchanged
