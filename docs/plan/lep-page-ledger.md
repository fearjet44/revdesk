# Revdesk — Page / section control ledger (lock before ingest)

Captured 2026-09-03. Updated the same day with pagination schemes and LEP vs LES vs no-list.

Do not start pillar 3 ingest until the agent has this file.

---

## The dock-pipeline mistake

LEP was assembled on the way *out* of the PDF. Every **page** (or every **section**, if that is the book’s system) is versionable. Ingest has to classify the book on the way *in*.

---

## What the regs actually say

14 CFR **§ 121.135(a)** does not invent “LEP” or “LES” by name. It requires:

- Paper manual: **date of last revision on each page**.
- Electronic manual: date of last revision displayed so a person can **immediately ascertain it**.

Same idea appears for part 135 (§ 135.23) and 91K (§ 91.1025).

Industry + FAA guidance fill in the *how*:

- **AC 120-78B** § 4.1.4: a typical manual includes revision-control pages and a **list of effective pages**.
- **AC 120-78B** § 4.3.7.2.2: electronic manuals in **continuous-flow** format (not page-by-page) should show revision status on each **section or block of information**. That is the List of Effective **Sections** pattern — replace the whole leaf, do not version faces.

Part 135 operators copy the same habits for FAA-accepted/approved books even when 121 is not the certificate. Company-controlled books often have **neither** list.

Revdesk stores the *system the book already uses*. It does not upgrade a handbook into an LEP book on ingest.

---

## Control style (inspect on ingest; persist on `manual.yaml`)

| `control_surface` | What is versioned | Typical books |
|---|---|---|
| `lep` | Each printed page (slot) | Most FAA ops manuals still paginated |
| `les` | Whole section / leaf | Continuous-flow / electronic; “replace section A” |
| `rev-only` | The manual revision only | Many internal / company books, no LEP |

A book can be `lep` in front matter + body and still have a cover that is not in the LEP. Record that; do not force one grid on the cover.

`les` means a TR still targets one section, and launch replaces that section as one effective unit. No per-page overflow ledger unless they also paginate for print.

`rev-only` means ingest creates sections, stamps the book rev on render, and does **not** invent LEP rows.

---

## Pagination schemes (also inspect; persist)

Page numbers are not “1, 2, 3” from the engine.

| `page_scheme` | Examples |
|---|---|
| `roman-front` | i, ii, iii — front matter |
| `letter-cover` | Cover / title as `C` or unnumbered |
| `section-page` | A-1, A-2, P-1, P-2 (section letter + face) |
| `chapter-page` | 2-1, 2-2 |
| `running` | 1 … N through the book |
| `none` | `rev-only` books; screen flow |

One manual usually **mixes** these (Roman front + A-1 body). Store a list of regions:

```yaml
pagination:
  control_surface: lep          # lep | les | rev-only
  regions:
    - name: cover
      scheme: letter-cover
      slots: [C]
    - name: front-matter
      scheme: roman-front
      slots: [i, ii, iii, iv]
    - name: body
      scheme: section-page      # slot = {section_letter}-{seq}
```

`slot` is the LEP name crews already know. Engine ordinals are derived at render and **stamped back** into YAML (`printed_as`, overflow notes). Identity is the slot, not the PDF page index.

---

## Ledger when `control_surface: lep`

Per section:

```yaml
id: gom-a
letter: A
pages:
  - slot: A-1
    seq: 1
    rev_content: 13
    rev_page: 13
    reflow_of: null
    dagger: false
    overflow: false
```

Render loop (same as before): paginate → if overflow, append slot (`A-2` or `A-1a` per house style), `reflow_of` + `dagger: true`, `rev_content` unchanged → write YAML → emit PDF and LEP from the ledger in **one** pass.

Underflow: do not delete slot history; omit on the next LEP.

---

## Ledger when `control_surface: les`

No page slots required. Section record carries `rev_content`. Continuous-flow stamp is the section rev/date (§ 121.135 electronic + AC 120-78B 4.3.7.2.2). If they also print, they may add an LEP region later; do not invent one at ingest.

---

## Ledger when `control_surface: rev-only`

Manual-level rev/date only. Render may still number pages for a PDF, but those numbers are **not** control objects. Stamp them as `printed_as` if useful for debug; they do not enter an LEP.

---

## Ingest checklist (first job of pillar 3)

For each source book:

1. Control class (already locked: approved / accepted / third-party / internal).
2. `control_surface`: LEP, LES, or rev-only. Look for an LEP page, an LES / revision-control section list, or neither.
3. Pagination regions (Roman, cover letters, A-1, running).
4. Copy existing LEP/LES rows into the ledger. If none and surface is `lep`, infer slots from the source PDF and set `lep_inferred: true`.
5. Do not retitle slots to a house style on ingest. Keep what the book already prints.

Render later **stamps** chosen page numbers into YAML and into the footer. That is allowed. Changing the control surface of a live FAA book is not an ingest surprise; it is a rev package.

---

## Out of scope

- Typesetter choice
- Exact dagger glyph vs asterisk (per-manual)
- Publish filenames
