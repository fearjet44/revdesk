# Agent notes

## Desk process

On this box the UI + `/api` is the systemd **user** unit `revdesk.service`. It runs `npm run dev` (Vite) from the repo root.

```sh
systemctl --user start revdesk
systemctl --user restart revdesk
systemctl --user stop revdesk
systemctl --user status revdesk
journalctl --user -u revdesk -f
```

**Do not** also `npm run dev` in a terminal. That fights the unit for `:5173`.

Vite binds **loopback only** (`127.0.0.1:5173`, `strictPort: true`). Ready for Duty owns **:5175**. Remote access is Tailscale Serve in front of loopback — if localhost is dead, restart **revdesk**, not Serve.

HMR covers most UI. Restart the unit after a **plugin / control API** change (`server/plugin.ts` and friends): `configureServer` does not hot-reload.

Without systemd (other machines): `npm run dev` from the repo root. Details: `docs/runbook/server.md`.

## Crew findings (`data/control/findings/`)

YAML notes a crew leaves on an **issued** leaf (Issued rail, read-only paper). One file per finding: `control/findings/<issue-id>/cf-….yaml`. They are **not** written into `manuals/<id>/sections/*.md` and they never ride `issued/` at launch. Lock: `docs/plan/issued-pdf.md`.

This path is **not** in `.gitignore` on purpose. Findings are control records, same family as `control/changes/` and `control/issues/`. In solo file-backed mode there is no separate database: `data/` **is** the library. Ignoring the directory would throw away operator input the next time someone cleans the tree. When the git adapter is on, `control/` is an allowed snapshot prefix, so a real finding can go with the rest of the control YAML.

What **not** to do:

- Do not add `data/control/findings/` to `.gitignore` “to keep main clean.”
- Do not commit **smoke** findings (or smoke CHGs / working copies) that an agent created while poking the desk. Those are local library dirt, same as `CHG-2026-002`… on this box. The **path** stays eligible; the **sample lorem library** on `origin/main` stays empty of live CFs until a real book is using them.

Solo no-auth: one identity (Chief Pilot). Leaving a CF on Issued and seeing it on Manuals/Review is the same person. Company mode later filters by login. Answers (Done/Stand/Later) are later — this cut is create + display.
