# Revdesk — Managed control leaves (lock)

Locked 2026-09-09. ROR, LOEP, LOES, and TOC are **derived paper**, not author pages.

They stay leaves in the book (they occupy slots; crews still open them on Issued). The author does not type the table. Manuals does not Open a working copy.

Page-flow overflow (`lep-page-ledger.md` render loop) and change bars are **not** this cut. This cut stops the lie that those pages are prose.

---

## Which leaves

| `managed` | Title (ingest / infer) | Source of the paper |
|---|---|---|
| `ror` | Record of Revision(s) | Launched full issues + TRs for that book |
| `lep` | List of Effective Pages | Page ledger (`lep_slots`) + each leaf’s `rev_last_changed` |
| `les` | List of Effective Sections | Procedure / appendix leaves + `rev_last_changed` |
| `toc` | Table of Contents | Procedure / appendix leaves (not other managed leaves) |

Do not invent a LEP on a `rev-only` book. Do not invent a ROR if the book has no such leaf. Store the system the book already uses (`lep-page-ledger.md`).

Source of Training, CTP, covers, and procedure leaves stay author pages.

---

## Desk

**Manuals:** no Open / Write. Label **Automatically managed**. **View** shows the derived paper (read-only, no CF, no write dock).

**Issued:** Open still means crew paper. Body is the derived table, not the on-disk lorem. CF is allowed (a note on the list is still a note).

**API / CLI:** `change start` / `touch` / Write on a managed id exits 2. Email is not a back door; neither is a working-copy path.

**PDF:** same derived markdown as Issued.

UI does not say branch, commit, tag, PR, push, or YAML.

---

## On disk

The file remains a leaf (`id`, `title`, `rev_last_changed`). Ingest writes:

```yaml
managed: ror    # ror | lep | les | toc
lep_start: i    # first slot this leaf owns, when known
```

Body on disk is a stub. Read / print **hydrates** the table. Existing books without the keys: infer `managed` from the title.

`writeManual` must keep `pagination` and `lep_slots`. Launch must not strip the ledger.

---

## LEP without page flow

Until pagination stamps overflow slots, each `lep_slots` row takes the owning leaf’s `rev_last_changed` (interval from `lep_start` / inferred `N-1` / `A-1`). Unmapped slots take the current issued rev. That is a **preview ledger**, not a typeset LEP. Do not call it final.

---

## Locked (do not “fix”)

- Author does not edit ROR / LOEP / LOES / TOC as prose.
- Do not upgrade a handbook into an LEP book because we can generate a table.
- Solo no-auth unchanged. Identities (Slice 8) is a different spawn.
- Never `git push --force`. Never delete an `issued/` tag.
- Change bars later, with print/PDF of touched leaves vs issued.

---

## Out of scope

- Change bars
- Stationery
- Company identities
- Transcribing corpus prose
