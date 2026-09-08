# Multi-agent prompt

Caution: another agent may be working on fearjet44/revdesk on this host.

**origin/main is the source of truth.** Land path is a GitHub PR, for
local agents and cloud/sandbox agents alike. Do not merge into
`~/Work/revdesk`. That folder is the default live desk
(fast-forward only from origin), not a merge target.

Use a git worktree at `.worktrees/<short-job>` **inside this repo**
off fetched `origin/main`. That directory is gitignored. Do not use
the primary checkout as a workspace. Other desks (ready-for-duty, …)
use the same per-repo `.worktrees/` layout.

```sh
git fetch origin
git worktree add -b <branch> .worktrees/<short-job> origin/main
```

Do not `npm run dev` (systemd owns `:5173`). Ready for Duty owns `:5175`.

If this job's files overlap another **open PR**, do not start. Say so.
Dirty primary is not your problem unless you were asked to
`revdesk desk origin`. Do not commit smoke findings, smoke CHGs, or
working copies that an agent created while poking the desk.

When the job is done:

- Commit on the worktree branch.
- Push and open a PR against `origin/main`.
- Do not merge onto primary. Do not fast-forward primary from this branch.
- Do not delete the worktree until the operator says so (they may deploy it).
- To test on the desk: `./bin/revdesk desk deploy --branch <this>`
  (or `--pr N` once the PR exists). Tell the operator that command if
  you did not run it.

Cloud / sandbox agents: same land path. Open a PR. Do not instruct
anyone to merge into a local folder. The operator tests with
`./bin/revdesk desk deploy --pr N`.

Return the desk to origin with `./bin/revdesk desk origin` (refuses if
primary is dirty).

** prompt to follow **
