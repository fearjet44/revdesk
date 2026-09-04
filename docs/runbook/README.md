# Revdesk runbooks

Operator notes for the local desk. The UI never mentions Git. Persistence is Markdown with YAML frontmatter plus control YAML under the data root.

| Runbook | What it covers |
|---|---|
| [server.md](server.md) | Vite UI + `/api` control plugin |
| [cli.md](cli.md) | `revdesk` binary (same verbs, no server required) |

Both talk to the same file library. Default root is `data/` in this checkout. The CLI can point elsewhere with `REVDESK_DATA`; the server always uses `<repo>/data`.
