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
