# Revdesk — Slice 6: Ingest classify + Nimbl scaffold

Handoff for the coding agent. Read `docs/plan/lep-page-ledger.md` and `docs/plan/ROADMAP.md` first.

**Project:** fearjet44/revdesk  
**Depends on:** Slice 0–2 on main. Pillar 3 spike; must not rewrite `server/repo.ts` while Slice 4 is open.  
**This slice:** Classify a source book (LEP / LES / rev-only, pagination regions, house style). Scaffold lorem sample manuals that keep Nimbl section structure. Train classify on the two corpus PDFs.  
**Not this slice:** Copying operator prose out of `corpus/`, `ingest apply` into a live library, Git tags, UI, `writeManual` pagination persist, Word ingest, render / LEP generation.

---

## Goal

A living Nimbl GOM / training program is inspectable on the way **in**.

- `revdesk ingest classify` says what control surface and page scheme the book already uses.
- Gold catalogs under `fixtures/ingest/catalogs/` hold **structure only** (leaves, heading numbers, LEP slots).
- `revdesk ingest scaffold` writes sample manuals with that structure and **lorem ipsum** bodies so the desk/editor can be tested later.
- Real PDFs stay in `corpus/` (gitignored). Never commit them. Never copy their prose into `data/` or `fixtures/`.

---

## Files this slice owns

```text
server/ingest.ts
cli/revdesk.ts                          # ingest classify | scaffold | catalogs
fixtures/ingest/catalogs/gom-lep.json
fixtures/ingest/catalogs/tp.json
fixtures/ingest/expected/*.json
fixtures/ingest/samples/*.txt           # LEP / LES / rev-only text
scripts/slice6-acceptance.sh
scripts/slice6-corpus-check.ts
data/manuals/gom-lep/**                 # generated lorem book
data/manuals/tp/**                      # generated lorem book
docs/plan/lep-page-ledger.md            # already on main; do not rewrite
```

Do **not** touch `src/components/*`, `src/index.css`, or `server/repo.ts` (UI / Slice 4).  
Do **not** change `data/manuals/gom` (the four-section desk sample + open CHG).

---

## 1. Classify

```text
revdesk ingest classify <pdf|txt> [--json]
```

Needs `pdftotext` / `pdfinfo` for PDFs (exit 5 if missing). `.txt` fixtures do not.

Locked checklist (same as `lep-page-ledger.md`):

1. `control_class` guess: GOM → `faa-accepted`; training program → `faa-approved`.
2. `control_surface`: LEP heading → `lep`; LES heading → `les`; neither → `rev-only`.
3. Pagination regions from LEP slot shapes: roman-front, chapter-page (`1-1`), section-page (`A-1`), plus cover.
4. Copy slot names as printed. Do not retitle to a house style. Duplicates on the source LEP are source defects; sample books may be unique.
5. Do not invent an LEP on a `rev-only` book.

Nimbl Word/PDFMaker house style (`nimbl-word`) when **all** of these are present:

- List of Effective Pages
- Record of Revision
- `Section N:` titles
- `N.N.0` heads
- Footer `Revision N DD-Mon-YYYY`

The two corpus books are both `lep` + `nimbl-word` + mixed roman / chapter-page / letter appendix. Classify must still tell LEP apart from LES and rev-only (text fixtures under `fixtures/ingest/samples/`).

---

## 2. Catalogs (structure gold)

`fixtures/ingest/catalogs/gom-lep.json` and `tp.json` are the sanitized maps of the Nimbl samples:

| Catalog | Book | Class | Rev | Leaves |
|---|---|---|---|---|
| `gom-lep` | General Operations Manual | faa-accepted | 11 | RoR, LEP, TOC, sections 1–18, appendix A |
| `tp` | FAR Part 135 Training Program | faa-approved | 9 | RoR, LEP, source-of-training, CTP, TOC, sections 1–12, appendices A–E |

Keep heading numbers and titles. Drop operator name, address, and procedure prose.

`corpus_file` on the catalog is a pointer to the gitignored PDF. It is not copied into `manual.yaml`.

---

## 3. Scaffold (lorem sample manuals)

```text
revdesk ingest scaffold --catalog gom-lep|tp [--out dir]
```

Writes:

- `manuals/<id>/manual.yaml` including `pagination` + `lep_slots` (repo ignores extra keys this slice)
- `manuals/<id>/sections/*.md` — frontmatter `id` / `title` / `rev_last_changed` only; body is lorem, lists, tables, `:::note` / `:::caution` / `:::warning`
- baseline `control/issues/<ABBREV>-R<n>.yaml` + placeholder instrument + placeholder PDF so `revdesk launched` works

Bodies must not contain corpus operator strings (`Premier Air Charter`, Palomar, Carlsbad, …).

Existing `data/manuals/gom` stays the small letter-style desk sample. The Nimbl-shaped books are additional manuals (`gom-lep` / `GOML`, `tp` / `TP`).

---

## 4. Out of scope

- `ingest apply` that transcribes PDF body text into Markdown
- Persisting `pagination` through `Repo.writeManual` (would strip extra YAML today)
- UI changes
- Git `issued/` tags (ingest records what the company believes is current; cutting the tag is pillar 2)
- Changing a live book’s control surface (that is a rev package, not an ingest surprise)

---

## Done when

- `revdesk ingest classify` on the two corpus PDFs reports `lep` + `nimbl-word` + the right class/rev/section titles
- Text fixtures cover `lep`, `les`, and `rev-only`
- `revdesk ingest scaffold` writes lorem books whose section titles match the catalogs
- `npm run test:slice6` passes (corpus checks skip when the PDFs are absent)
- `npm run test:slice2` still passes
- Theme / Slice 4 files untouched
