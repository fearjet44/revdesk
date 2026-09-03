# Revdesk — LEP / page ledger (lock before ingest)

Captured 2026-09-03 from the dock-pipeline mistake: LEP was treated as something you assemble on the way out of the PDF. It is not. Every page is versionable. Ingest has to know that on the way in.

Do not start pillar 3 ingest until this is in the contract.

---

## The mistake

A section is not a page. A GOM leaf can become 1 page or 7. The **List of Effective Pages** is the control surface the FAA and the crew actually use: each printed page has a revision identity.

If you only version sections, then:

- LEP is a second or third pass after render
- Overflow (text that no longer fits the last page) is discovered too late
- Reflow looks like a content change, or gets hand-patched in Word

That is what the old pipeline forced. Do not repeat it.

---

## Unit of control

| Object | What it is |
|---|---|
| Section | Editable leaf (`gom-a`, one TR target) |
| Page | One printed face in the of-record PDF, owned by a section |
| LEP row | Page identity + revision + whether this rev *changed content* or only *reflowed* |

A TR still touches **one section**. That section may occupy several LEP rows. A rev package may touch many sections and therefore many pages.

---

## Ledger (ingest writes this; render updates it)

Per section, persist a page list in YAML (shape can move; the facts cannot):

```yaml
id: gom-a
title: Section A — Management
pages:
  - slot: A-1          # stable LEP key, not "whatever the PDF engine numbered today"
    seq: 1
    rev_content: 13    # last rev that changed words on this page
    rev_page: 13       # last rev this slot existed in the book
    reflow_of: null    # if this slot was born because A-1 overflowed, point at A-1
    dagger: false      # true = this rev is layout only, not new policy
    overflow: false
```

`slot` is the LEP name crews see (`2-5`, `A-1`, `A-1a`). It must survive a re-render. Engine page numbers are derived, not stored as identity.

Ingest of an existing book: create one slot per effective page already on that book's LEP. Do not invent a single slot per section.

---

## Render loop (before the PDF is of-record)

1. Paginate the section against the current stylesheet.
2. If output page count **equals** the ledger, stamp and emit.
3. If output **overflows** (needs more pages than slots):
   - write `overflow: true` on the last existing slot
   - append a new slot (`A-2`, or `A-1a` if that is house style)
   - set `reflow_of` to the slot that spilled
   - set `dagger: true` and `rev_content` **unchanged** (same words)
   - set `rev_page` to the rev being built
4. If output **underflows** (fits in fewer pages): do not delete history. Mark vacated slots `withdrawn` / omitted on the next LEP; keep the id so an audit can see they existed.
5. Then emit PDF. LEP is generated from this ledger in the **same** pass, not a later grep of the PDF.

Reflow is cheap because it is an append to the list plus a dagger, not a rewrite of the section identity.

---

## Dagger means

Crew-facing LEP mark: this page is in the new rev **only because layout moved**. No policy change. Content rev on that slot stays the parent rev.

Do not use a dagger for a TR or for edited prose. Those bump `rev_content`.

---

## What ingest must capture from the source book

For each page already on the current LEP / footer:

- printed page id (slot)
- revision showing on that page
- date if present
- whether the source marked it changed this rev (asterisk/dagger/bar)

If the source PDF has no LEP, still create slots from the rendered page count of that ingest and flag `lep_inferred: true` so we do not pretend it was of-record control.

---

## Out of scope here

- Choosing A-1 vs 2-1 house style (per-manual config)
- The actual typesetter
- ForeFlight filenames

---

## Done when ingest exists

Opening a real GOM in Revdesk shows sections **and** a page ledger. Building a PDF updates that ledger in place. LEP in the artifact is a print of the ledger, not a separate reconstruction.
