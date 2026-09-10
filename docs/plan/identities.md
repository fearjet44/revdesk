# Revdesk — Identities (lock)

Locked 2026-09-10. Company mode only. Dual-mode still holds: solo is no-auth and is not deleted.

Auth turns on when a **remote is bound**, not when the app is installed. Do not make a login wall the only binary. Admin is not a settings graveyard on the solo desk.

The bound library is a real origin (dummy now: `fearjet44/test-manual-repo`; then the certificate holder’s). Packets will become pull requests (`change-package-model.md`, parked). Editors who write those packets should do so **as themselves**, as members of the org that owns the book — not as a shared bot. Crew and other standard users should not need a forge account.

UI still does not say branch, commit, tag, PR, or push on the author / reviewer / crew chrome. Sign-in may name GitHub or GitLab because that is the door. Packet verbs stay Open / Save / Submit.

---

## Two doors

| Who | How they sign in | What that buys |
|---|---|---|
| **Editor** | OAuth with the forge that **hosts the bound library** (GitHub first; GitLab the same shape) | Membership in the org/group that owns the manuals remote. Their user on **check-out / check-in** of open packets. |
| **Standard user** | **Org email** on an allowlisted domain | A desk identity and a role. No forge token. Issued rail (`issued-pdf.md`). |

Do not make GitHub the only door. Do not make email the editor door when the library is GitHub-backed — then every packet would check in as a bot.

A person can have both (org email for crew paper, GitHub for editing). The **editor** role is what requires the forge.

---

## Org membership (editors)

The product **encourages** editors to belong to an org by making that the gate, not a suggestion.

- Bound remote `github.com/acme-air/manuals` → editor must be a member of `acme-air`.
- Bound remote `gitlab.com/acme-air/manuals` → editor must be a member of that GitLab group.
- Personal GitHub / GitLab outside the org → not an editor. They may still be a standard user via org email if the domain matches.
- Company mode is not “any GitHub user against a random repo.”

Admin lists:

- the forge org/group (usually inferred from the bound URL)
- allowlisted email domains for standard users (`@acmeair.com`)

---

## Check-out / check-in (GitHub-backed)

When the library origin is GitHub (or GitLab), the editor’s OAuth token is how the desk talks to the forge **as that person**:

| Desk (what they see) | Forge (hidden) |
|---|---|
| Open a packet | Fetch the change branch / open PR (or MR); work as that user |
| Save / Submit | Push their work onto that packet (update the PR) |
| Start a packet | Open the change branch; later, open the PR |

The actor on the PR is the editor. That is the point. A bot installation can watch, comment, or run checks later. It does not author the packet.

This is the **identity** half of the parked stacking in `change-package-model.md` (TR → one PR; rev → umbrella + stacked per-section PRs). Stacked PRs are not this spawn. The identity is.

Never `git push --force`. Never delete or move an `issued/` tag.

---

## Providers

**GitHub — first.** User OAuth (OAuth App, or GitHub App **user-to-server**). Scopes must cover: org membership, read the manuals repo, push the change branch, open/update PRs. The actor is the editor.

A GitHub App **as a product** (installation, checks, webhooks) is later. Slice 7 already parked it. Do not require an App to sign in.

**GitLab — same shape**, when the bound remote is GitLab. Group membership instead of org. Merge requests instead of PRs, still hidden on the desk.

The provider is implied by the bound remote host. Do not offer GitHub sign-in against a GitLab origin, or the reverse.

---

## Standard users (org email)

Crew, readers, auditors who should not push the library.

- Sign in with work email on an allowlisted domain.
- First cut: magic link to that address. Not a password file as the long-term path. Org SSO (Google Workspace / Entra OIDC) may replace the magic link later.
- No GitHub or GitLab account required.
- Rails: **Issued** only unless an admin grants more. Matches `issued-pdf.md` (read-only login only sees Issued).

Crew findings (CF) are notes on issued paper. They must not require a forge login. How those YAML notes reach the origin (desk service identity vs later) is an implementation detail of the identities slice; do not send crew to GitHub to leave a CF.

---

## Roles (company)

| Role | Door | Rails |
|---|---|---|
| Admin | Editor (forge) | Bind origin, identities, who may approve/launch, allowlisted domains |
| Author | Editor (forge) | Manuals + packets |
| Reviewer | Editor (forge) | Packets, letter, launch. They write control YAML; that is a library mutation. |
| Crew | Standard (org email) | Issued |

Anyone who **mutates a packet or launch record** is an editor and uses the forge door. Email is not a back door onto `issue`.

---

## Solo

No login. No GitHub account. `remote: ""` in desk config. Unchanged.

Unbinding the remote returns to the solo tree and drops the login wall.

---

## Secrets

OAuth client id/secret and user tokens are **not** in the manuals library and **not** in committed `config.yaml`. They live on the desk host (`~/.config/revdesk/` or environment). Never log tokens. `config.yaml` may name `provider` and `org`; it does not hold the secret.

CLI in company mode does not get a shared PAT. Device login / token for `revdesk` is a later cut. Browser OAuth is the first cut.

---

## Locked (do not “fix”)

- Solo stays no-auth.
- Binding a remote is what turns auth on.
- Editors belong to the org that owns the bound library and sign in with that forge.
- Standard users sign in with org email; they do not need GitHub.
- The editor’s user is the actor on check-out / check-in. No shared bot authoring packets.
- UI does not say branch, commit, tag, PR, or push on the desk chrome.
- Never `git push --force`. Never delete an `issued/` tag.
- No instrument → no tag. Unchanged.

---

## Out of scope (later)

- GitHub Apps as a product (checks, webhooks, installation)
- Stacked per-section PRs
- CLI device login
- Org SSO (OIDC) replacing magic link
- Login wall on solo
- Forcing crew onto GitHub
