# Revdesk — Deferred kind, WIP save, reviewer classifies

Locked 2026-09-03 morning. This **supersedes** “kind at change start” in `change-package-model.md` and Slice 4.

Slice 4 already shipped `kind` on open. Leave that code until a Slice 5 cut. Do not prescribe Git stash as the implementation. Describe behavior only.

---

## Author: edit first, classify later

An author may open any page or section and write. They do **not** pick TR vs rev to start.

Working copies persist as **Save** in the UI. Internally this may be a stash, a working tree, or a draft packet. The word stash does not appear on the desk.

Why: they often do not know yet whether the edit is a one-page TR or part of a bigger rev. Forcing the choice up front is the wrong moment.

Author desk verbs:

- Edit anywhere they have access
- Save (WIP)
- Submit for review
- Withdraw their own unsubmitted WIP

No launch. No instrument. No TR/Rev radio required.

---

## Reviewer / owner: that is who names it

After submit, the owner looks at the touched pages and decides:

- One page (or one section) + TR letter → **Issue TR** and ship that leaf
- Enough content for a book rev → **Full revision**, attach the launch instrument (regulator / CEO / AE — whoever holds launch codes for that manual)
- Mix: accept some pages, send others back. Ripe work can launch without waiting on the rejected leaves

TR still means one leaf. Rev still means a package that can span the book. The rule did not change. Only **when** the rule is applied: at review, not at first keystroke.

CLI follows the same verbs. `change start --kind` becomes optional / inferred. Reviewer commands set kind.

---

## Why LEP still matters (paper color)

This is leftover from binders and regulators still expect it.

You got a packet. LEP in one hand. Open the binder. Pull old P-1, A-1, B-2, M-9. Drop the new faces. Add the packet to the Record of Revisions at the front. That is how currency was proved on paper. Same dance still happens on a Challenger book in an office.

Electronic manuals that fight this (Word, InDesign, one flowing document) treat a page as layout, not a versionable object. The expensive systems that do play nice keep the source binary, which an agent cannot read. Revdesk is the opposite: Markdown leaves plus a page ledger, LEP printed from that ledger, agents reading the same repo the humans edit.

See `lep-page-ledger.md`. Do not water it down because flow manuals exist. Support LEP, LES, and rev-only. Be a first-class LEP user when the book is an LEP book.

---

## Later: gap analysis CLI (not this slice)

Auditors hand a standard. Operator must show where the policy or process lives. That is a gap analysis against **structured manual text**, not a PDF.

Future CLI shape (do not implement now):

```text
revdesk manuals text --manual gom --section gom-a
revdesk manuals find --q "operational control"
revdesk gap --standard <file> --manuals gom,fotm,mel
```

An agent gets section ids, titles, and body. Suite of company manuals in one Revdesk library. This sits on pillar 1 after the desk works, or beside ingest once real books are in.

---

## Implementation note for agents

Behavior lock. Do not tell the coding agent to use `git stash`. Save WIP however the tree already works (`control/working/…`). Kind moves from create-time to review-time: `change start` omits `--kind` (stores `wip`); reviewer names TR vs rev at launch.
