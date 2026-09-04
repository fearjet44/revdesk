# Revdesk — Review queries (lock)

Locked 2026-09-04. Comments on a change packet are **author queries**, not edits. This supersedes the informal “git note with no disposition” that shipped with the reviewer diff.

Gap-analysis CLI stays parked in `deferred-kind-and-wip.md`. That CLI will write this same object; it will not `section put`.

## A query never writes the leaf

The working copy changes only when someone on the **author desk** types in Print and writes the section. Reviewer, agent, and a future gap command may only attach a query (optional suggested wording in `suggest`). Suggested wording is a prompt, not a patch.

## Three author answers

| Action | Means | Page |
|---|---|---|
| **Done** | The query is answered **by a change to the text**. The working copy of that section must differ from the markdown hashed when the query was opened (`basis`). | Changed |
| **Stand** | stet. Keep the text. One-line reason required. | Unchanged |
| **Later** | Not this packet. One-line reason required. | Unchanged |

Done is not “I looked at it and the existing sentence is fine.” That is Stand. If the hashes match, Done is refused.

Reviewer may add another query after resubmit. They do not overwrite Stand.

## What suppresses them

- **Crew / issued book:** queries are draft-only. They never live in `manuals/<id>/sections/*.md`. Launch does not copy notes onto `issued/`.
- **Desk:** Done / Stand / Later **closes** the query. Closed queries stay in git notes (not deleted). Print gutter shows **open** queries only.

Store: git notes `refs/notes/revdesk/review` on `change/<CHG>`. Inspect: `git notes --ref=revdesk/review show change/<CHG>`.

## Gate

- Submit / resubmit: allowed with open queries.
- **Approve: refuse while any query is `open`.**
- Launch: queries are already closed; they are not part of the issued tree.

## Record

```json
{
  "id": "rc-…",
  "from": "reviewer",
  "cite": null,
  "suggest": null,
  "status": "open",
  "reason": null,
  "basis": "<sha256 of working markdown when opened>",
  "section": "gomlep-5",
  "path": "data/manuals/…/foo.md",
  "line": 57,
  "side": "new",
  "body": "…",
  "author": "Chief Pilot",
  "at": "…"
}
```

`from` is `reviewer | gap | author`. `cite` is required later when `from=gap`. Missing `status` on old notes is `open`.

CLI: `revdesk change answer <CHG> --comment rc-… --status done|stand|later [--reason "…"]`.
