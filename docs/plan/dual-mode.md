# Revdesk — Dual mode (lock)

Locked 2026-09-04. Company remote git is an add-on. Solo file-backed, no-auth is not a prototype and is not deleted.

Same editor, same change machine, same CLI verbs.

| | **Solo** | **Company** |
|---|---|---|
| Who | One person getting a controlled book into git | Certificate holder, several desks |
| Data | File-backed `REVDESK_DATA` on disk | Same layout, bound to a remote origin |
| Auth | **None** | Logins, roles, admin |
| Git | Optional local adapter (Slice 3b) | Fetch/push to the dummy (then real) origin |
| Instrument | CLI `--file` and/or picker upload to local server | Picker upload (a path on the reviewer’s laptop is not the record) |

Solo is the default. Connecting a remote is what turns auth on — not installing the app. Do not make a login wall the only binary.

Admin exists **only** in company mode: bind origin, identities, who may approve/launch. Not a settings graveyard on the solo desk.

Local `enabled: false` / no-`.git` stays: YAML launch, `git_skipped`, no tag. Solo does not require a GitHub account.

Never `git push --force`. Never delete an `issued/` tag. UI still does not say Git.
