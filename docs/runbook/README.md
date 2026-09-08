# Revdesk runbooks

Operator notes for the local desk. The UI never mentions Git. Persistence is Markdown with YAML frontmatter plus control YAML under the data root.

| Runbook | What it covers |
|---|---|
| [server.md](server.md) | Vite UI + `/api` control plugin + systemd user unit + Tailscale Serve + `revdesk desk deploy` + `revdesk desk public-demo` |
| [cli.md](cli.md) | `revdesk` binary (same verbs, no server required). `desk deploy` points the unit at a worktree. `desk public-demo` Funnels :8443 |

Both talk to the same file library. Default root is `data/` in this checkout. The CLI can point elsewhere with `REVDESK_DATA`; the server always uses `<repo>/data`.
