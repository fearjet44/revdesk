# Revdesk — Slice 7: Dummy remote + fake suite (stub)

Handoff stub. Fill the implementation contract when this slice is the job. Do not implement from this file.

**Project:** fearjet44/revdesk
**Depends on:** Slices 0–4, 3b, 6 on main. Dual-mode lock `docs/plan/dual-mode.md`. Correspondence lock `docs/plan/correspondence.md`.
**This slice:** Bind a dummy remote git repo. Ingest a **fake** manual suite into it. Company mode gets admin + logins. Launch tags may push.
**Not this slice:** `ingest apply` of corpus prose, stationery PDF, forms service, GitHub Apps as a product, force-push, deleting `issued/` tags, a login wall on solo.

Read `docs/plan/ROADMAP.md` and `docs/plan/dual-mode.md` first.

---

## Goal

Pillar 2 leftover is **remote**, not another local tag grammar. `push_on_launch` is already a flag and is false.

**Done enough when:**

- A dummy GitHub (or other) repo holds a fake manual suite (lorem bodies, Nimbl-shaped maps we already have: `gom-lep`, `tp`, maybe a third).
- Revdesk talks to that origin.
- `issue` / `tr issue` can push the annotated `issued/…` tag.
- The desk still does not say Git.
- Solo still runs file-backed, no auth, no GitHub account.

Work **with** ingest on that fake suite. That is how the editor gets a first-class book that is not `data/` on one laptop. Real PDFs stay in `corpus/` (gitignored). Never copy operator prose.

---

## Spawns (company mode only)

- Origin bind (admin)
- Identities / logins
- Real `git push` of launch tags when `push_on_launch` is on

Auth turns on when a remote is bound, not when the app is installed. Admin is not a settings graveyard on the solo desk.

---

## Locked (do not “fix”)

- Never `git push --force`. Never delete or move an `issued/` tag.
- No instrument → no tag. Composed **request** letters are not instruments (`correspondence.md`).
- Local `enabled: false` / no-`.git`: YAML launch, `git_skipped`, no tag.
- UI does not say branch, commit, tag, or push.

---

## Implementation contract

Empty until this slice is scheduled. When it is: clone/fetch rules, token storage, who may bind origin, test against a throwaway repo, keep `npm run test:slice3`.
