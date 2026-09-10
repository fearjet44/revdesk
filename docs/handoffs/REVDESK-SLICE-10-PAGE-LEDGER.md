# Revdesk — Slice 10: Page ledger

**Project:** fearjet44/revdesk
**Depends on:** Slice 9 managed leaves on main. Lock: `docs/plan/lep-page-ledger.md`.
**This slice:** Persist a per-leaf page ledger. Paginate → overflow/underflow → write YAML → emit PDF and LEP from that ledger in one pass. Slot identity, not PDF index.
**Not this slice:** typesetter choice, dagger glyph vs asterisk, change bars, identities, stationery, `push_on_launch`, ingest of corpus prose.

Read `docs/plan/lep-page-ledger.md` first. Do not weaken it.

---

## Goal

An LEP book’s List of Effective Pages is the ledger, not a guessed `lep_slots` dump.

**Done enough when:**

- `manuals/<id>/ledger.yaml` holds per-leaf slots (`rev_content`, `rev_page`, `reflow_of`, `dagger`, `overflow`, `omitted`, `printed_as`).
- PDF render paginates, appends overflow slots (`1-2` / `A-2`, or `A-1a` when `overflow_style: suffix`), does not delete underflow history, stamps `printed_as`, writes the ledger, and puts **slot · rev** in the footer.
- Managed LEP reads effective (non-omitted) ledger rows. LES has no page slots. `rev-only` does not invent an LEP.
- Ingest seeds the ledger from `lep_slots`.
- `revdesk ledger show | refresh <manual>`.
- Desk chrome still does not say Git. Never `--force`. Never delete an `issued/` tag.

---

## Tests

`npm run test:slice10`. Keep `test:slice3`, `test:slice6`, `test:slice7`, `test:slice9`, `test:md`.

---

## Locked (do not “fix”)

See `docs/plan/lep-page-ledger.md` and `docs/plan/managed-leaves.md`.
