# Revdesk — Slice 9: Managed control leaves

**Project:** fearjet44/revdesk
**Depends on:** Slices 0–4, 3b, 6, 7 on main. Locks: `docs/plan/managed-leaves.md`, `docs/plan/lep-page-ledger.md`, `docs/plan/issued-pdf.md`.
**This slice:** ROR, LOEP, LOES, TOC are automatically managed. No author Open. Derived paper on View / Issued / PDF.
**Not this slice:** page-flow overflow, change bars, identities, stationery, `push_on_launch`, ingest of corpus prose.

Read `docs/plan/managed-leaves.md` first. Do not weaken it.

---

## Goal

The editor cannot pretend the control lists are procedure pages.

**Done enough when:**

- Manuals shows **Automatically managed** (no Open) on ROR / LEP / LES / TOC.
- View / Issued / PDF show a table from launched issues (ROR), `lep_slots` (LEP), or the leaf map (LES / TOC).
- `revdesk change start --section <ror-id>` exits 2.
- A procedure leaf still Opens.
- `gom` (no such leaves) is unchanged.
- Ingest writes `managed:` + `lep_start` and does not author a fake LEP table.
- `writeManual` / launch keep `pagination` + `lep_slots`.
- Desk chrome still does not say Git.

---

## Tests

`npm run test:slice9`. Keep `test:slice3`, `test:slice6`, `test:slice7`, `test:md`.

---

## Locked (do not “fix”)

See `docs/plan/managed-leaves.md`. Dual-mode, correspondence, and `issued/` tag rules still hold.
