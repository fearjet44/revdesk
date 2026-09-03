# Revdesk — Change package model (lock)

Captured 2026-09-02 from operator notes on the CHG-2026-001 desk.

This is design, not an implementation slice. Git/PR stacking is parked.

---

## Unit of work is the change package

At `change start` the author picks **package kind**:

| Kind | Scope | Many can be live |
|---|---|---|
| **TR** | Exactly **one** section (one page) | Yes. GOM may have TR 3, TR 18, TR 27 active at once |
| **Rev** | One or more sections | One open rev package per manual at a time (recommended) |

A revision is not “a TR that grew.” It is a package that is allowed to span the book.

---

## UI rules

- Section picker: 0 sections → cannot submit.
- **1 section** → kind may be TR or Rev.
- **2+ sections** → kind is Rev. TR control disabled. If they flip kind to TR, warn and refuse: “A temporary revision touches one section.”
- Changing kind after start is allowed only while `draft` and only if the touch list still fits the kind.
- Author desk in `draft` / `edit`:
  - **Submit for review**
  - **Withdraw**
  - Edit touched sections
  - No launch button
  - No “needs instrument” on a button
- Instrument + effective date + Launch / Issue TR live on the **reviewer** desk (`review` → `approved` → `ready-to-launch`). Red field-level warning on the instrument path if empty. Do not decorate the button.

Working-copy banner can stay factual (`control/working/CHG-…`). Do not use it to lecture about instruments.

---

## Why this matches paper TRs

A TR replaces **one leaf**. That is why several TRs ride on one launched rev. A full rev is the event that looks at every open TR and either **incorporates** or **withdraws** it, then ships many section diffs as one new full identity.

Before a rev is staged to launch, reviewer must answer per active TR:

- incorporate into this rev, or
- withdraw (no longer in force), or
- leave active (only if the rev does not touch that section — default: incorporate-or-withdraw, do not silently keep)

---

## Parked: Git without saying Git

Not this week. When the adapter exists:

- **TR package** → one branch, one reviewable PR, mergeable to `main` (or to the last `issued/` tree). One section in the diff.
- **Rev package** → umbrella. By rule it folds incorporated TRs, then each touched section is a stacked PR under that umbrella so a reviewer can read one section at a time. The author still sees one package.
- Launch tag is still only after the instrument, on the reviewer desk.

Do not expose branch/PR language in the UI.

---

## Model fields to add later

```yaml
# change.yaml
kind: tr | rev
touches:              # TR: length === 1
  - id: gom-ident
tr_decisions:         # rev packages only, at stage-to-launch
  - tr: GOM-1-TR-3
    action: incorporate | withdraw | leave
```

Fixture `CHG-2026-001` touching `gom-ident` + `gom-a` is a **rev**, not a TR.
