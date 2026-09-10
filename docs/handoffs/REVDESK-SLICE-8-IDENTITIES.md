# Revdesk — Slice 8: Company identities (stub)

Handoff stub. Fill the implementation contract when this slice is the job. Do not implement from this file until the lock is the job.

**Project:** fearjet44/revdesk
**Depends on:** Slice 7 bind on main. Dual-mode lock `docs/plan/dual-mode.md`. Identities lock `docs/plan/identities.md`.
**This slice:** When a remote is bound, turn auth on. GitHub OAuth (GitLab same shape) for **editors** in the org. Org-email magic link for **standard users**. Editor token checks a packet out and in as that user.
**Not this slice:** GitHub Apps as a product, stacked PRs, CLI device login, org SSO, login wall on solo, `push_on_launch` of issued tags, transcribing corpus prose.

Read `docs/plan/identities.md` first. Do not weaken it.

---

## Goal

Company mode is several desks on one bound library.

**Done enough when:**

- Solo (`remote: ""`) still has no login.
- Bound remote: sign-in is required.
- An org member can sign in with GitHub (if the origin is GitHub) and Open / Save a packet as **themselves**.
- A crew member can sign in with org email and only see Issued. No GitHub account.
- A GitHub user outside the org cannot take the editor door.
- Desk chrome still does not say branch, commit, tag, PR, or push.

Test against `fearjet44/test-manual-repo` (and a throwaway org if GitHub org-membership checks need one).

---

## Spawns inside this slice (when scheduled)

- OAuth App (or GitHub App user-to-server) for GitHub; GitLab OAuth when the remote host is GitLab
- Org/group membership check
- Allowlisted email domains + magic link
- Session on the desk; tokens on the host, not in the library
- Map editor token → fetch/push the change branch (check-out / check-in)
- Role gates on rails (Issued-only for crew)

---

## Locked (do not “fix”)

See `docs/plan/identities.md`. Dual-mode, correspondence, and `issued/` tag rules still hold.

---

## Implementation contract

Empty until this slice is scheduled. When it is: callback URLs, token store, who may bind origin, test org, keep `npm run test:slice3` and `test:slice7`.
