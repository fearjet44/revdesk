# Revdesk — Write marks (lock)

Locked 2026-09-04. The author stamps **why this leaf changed** on Write. That is not a review query (`review-queries.md`) and not the packet `reason` on `change start`.

S1000D analog: reason-for-update on the data module, used to build the revision summary. We dump the same text into the `change/<CHG>` snapshot message. The desk does not say commit.

## Codes

| Code | Meaning | Note |
|---|---|---|
| RF | Regulator finding | required (finding / letter id) |
| AEF | Accountable Executive finding | required |
| RAP | Remedial action plan | required |
| IA | Internal audit / SMS finding | required |
| PC | Policy change | optional |
| OS | OpSpecs / LOA / authorization | optional |
| EQ | Equipment, AFM, MEL, or config | optional |
| GS | Grammar / spelling / punctuation | optional |
| CL | Clarify; no policy change | optional |
| M | Moved | optional |
| NLN | No longer needed | optional |
| XR | Cross-reference | optional |
| CF | Crew or user feedback | optional |
| SB | Manufacturer / service bulletin / vendor | optional |
| SE | Same edit | none. Checkpoint only; not a why. |

No Other. If it does not fit: PC or CL plus a note. Do not grow the list without a packet that needed a new code.

## Rules

- Dirty Write requires a code. Unchanged Write is a no-op.
- Later Writes on the same leaf default to the last code on that touch.
- **SE** is “I wasn’t done, I just needed to save.” It is hidden until this leaf has been Written once with a real code. First dirty Write cannot be SE.
- Not stored in issued section Markdown.
- Packet log: `wrote <section> RF — POI 2026-0912`
- Snapshot message: one line per marked leaf, `CHG-… <section> RF POI 2026-0912`
