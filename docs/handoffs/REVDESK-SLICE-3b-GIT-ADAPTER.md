# Revdesk — Slice 3: Git adapter

Handoff for the coding agent. Read this whole file before editing.

This file **replaces** any earlier Slice 3 draft. Do not implement `GOM-R14` as the Git tag name. Do not add a “posted without instrument” launch path.

**Project:** Revdesk (`fearjet44/revdesk`)  
**Depends on:** Slice 0 UI, Slice 1 CLI, Slice 2 launch + TRs (YAML already real; Git tags still stub strings)  
**This slice:** Local Git adapter. Annotated tags only after a stored instrument.  
**Not this slice:** GitHub Apps, PRs, ForeFlight/VOCUS/OBDS publish, real PDF pipeline, MCP, TipTap work, inventing TRs.json for the work manuals repo.

---

## Goal

When `revdesk issue` or `revdesk tr issue` succeeds **and** an instrument is stored:

1. Control YAML + touched files are committed
2. An **annotated tag** is created
3. The issue/TR record gets a real `source_commit`
4. An existing launch tag is **never moved or deleted**
5. The UI still does not say branch, commit, tag, or push

If there is no instrument, **no tag**. That is the whole product rule.

---

## Locked rules (do not “fix” these to match messy company practice)

The operator’s current manuals repo sometimes **posts a book to crews with no launch letter** and delays the `issued/` tag. That is the behavior Revdesk exists to stop.

Revdesk legal identities:

| Path | Requires | Git |
|---|---|---|
| Full launch (`issue`) | Stored instrument | annotated tag `issued/{CODE}/{rev}` |
| Temporary revision (`tr issue`) | Stored **internal** instrument (CP / AE / CEO / DO letter or memo) | annotated tag `issued/{CODE}/{parent}/TR/{seq}` **or** no tag if `tr_tag` config is empty — still write `control/trs/` |
| Third-party manual employees must hold | At least a **saved email** (`.eml` / PDF) hashed as the instrument | same full-launch tag after that file exists |
| “We already handed crews the PDF” | **Not a launch** | no tag, no `issue` |

No instrument → `issue` and `tr issue` exit 2. Do not add `posted` as a launch state in this slice.

Third-party: `--type third-party-letter` is valid. An email file is enough stationery. Empty `issued/` is not.

---

## Tag spelling (Git)

Work-repo convention to follow. Issue **id** in YAML may stay `GOM-2`. The **Git tag** is a path:

```text
issued/GOM/1
issued/GOM/2
issued/FOTM/2
issued/FSM/4.0
issued/OCC/1
issued/OCC/original
issued/MEL-Lear60/1
issued/HazMat/Original
```

Revision labels are **not** always integers: `1`, `2`, `4.0`, `original`, `Original`.

TR tags (if enabled):

```text
issued/GOM/1/TR/1
```

Do **not** use fixture names as Git refs: `GOM-R14`, `GOM-R13-TR1` are YAML/display ids only unless config maps them.

`main` is not the controlled copy. `issued/` is. Do not ff-merge `main` as a substitute for the tag.

---

## Config

Add `data/.revdesk/git.yaml` and `fixtures/tiny-gom/.revdesk/git.yaml`.

```yaml
enabled: true

change_branch: "change/{change_id}"

# Git tag for a full launch. Tokens: abbrev, revision
full_tag: "issued/{abbrev}/{revision}"

# Git tag for a TR. Empty string = do not tag TRs (YAML only).
tr_tag: "issued/{abbrev}/{parent_revision}/TR/{seq}"

annotated: true
update_ref_on_full_issue: ""    # tags only; do not move main
push_on_launch: false           # no GitHub API; optional git push later
author_name: "Revdesk"
author_email: "revdesk@local"

# Display / YAML issue id (not the git ref)
issue_id: "{abbrev}-{revision}"
```

If the operator later pastes a different grammar, **only this file changes**.

---

## Current code (do not regress)

- `server/repo.ts` — state machine + YAML
- `server/types.ts` — `IssueRecord.git_tag: string` (stub)
- `cli/revdesk.ts`
- `scripts/slice2-acceptance.sh` must still pass
- UI theme unchanged; no Git words

Slice 2 already refuses `issue` without an instrument. Slice 3 must not punch a hole in that.

---

## Adapter

New `server/git.ts`, called from `repo.ts` **after** Slice 2 validation succeeds.

| Verb | Git |
|---|---|
| `change start` | `git switch -c change/CHG-014` from last issued commit or HEAD |
| dirty control/manual files | commit if dirty, only allowed paths |
| `issue` | commit, `git tag -a issued/{CODE}/{rev} -m "Launch …"`, write `source_commit` |
| `tr issue` | commit; tag only if `tr_tag` non-empty |
| tag already exists | exit 2, do not `-f` |

Discover git root by walking up from `REVDESK_DATA`. If no `.git` and `enabled: true`, launch YAML still writes, `source_commit: null`, `git_skipped: true`, stderr warning. Do not `git init` the operator’s tree except in tests.

Refuse snapshot if porcelain includes paths outside `manuals/`, `control/`, `artifacts/`, `.revdesk/`. Exit 2 and list them.

Never `git push --force`. Never delete an `issued/` tag.

---

## Records

Add to `IssueRecord` and `TrRecord`:

```ts
source_commit: string | null
git_skipped?: boolean
```

`git_tag` becomes the **actual ref** (`issued/GOM/2`), not the YAML id.

`revdesk launched --json` includes `tag`, `source_commit`, `tag_ok`.  
`tag_ok` is false if the record names a tag that is missing or points at a different commit.

---

## CLI

Same binary. Add only:

```text
revdesk git status     # enabled, root, dirty paths — agent/debug
```

No `revdesk git tag` / `revdesk git push`. The only legal tag cut is `issue` / `tr issue`.

Instrument attach already exists. Accept email files (`.eml`, `.txt`, `.pdf`) as `--file` for third-party and internal letters. Hash bytes the same way.

---

## Tests

Keep `npm run test:slice2`.

Add `scripts/slice3-acceptance.sh` / `npm run test:slice3`:

1. Temp dir, `git init`, copy `fixtures/tiny-gom`, commit baseline, tag `issued/GOM/1` to match fixture current issued (map fixture `GOM-R13` → display R13 / revision `1` **or** keep fixture revision numbers but tags must be `issued/GOM/…` — pick one mapping, document it in the script comments, stay consistent).
2. `issue` with no instrument → exit 2, **no new tag**.
3. `tr issue` with CP letter → TR yaml written; tag created only if `tr_tag` set; withdraw dies.
4. Full `issue` with POI/acceptance letter → `issued/GOM/2` (or next rev) exists, annotated, `source_commit` matches.
5. Second tag of the same name → exit 2, first tag SHA unchanged.
6. Hand `git tag -f` in the test, then `launched --json` → `tag_ok: false`.
7. `enabled: false` → YAML launch, no tags, `git_skipped`.
8. Dirty `scratch.tmp` at repo root → launch exit 2.
9. Third-party path: attach `.eml` / txt email, `issue` succeeds, tag exists.

---

## UI

No Git chrome. Do not add a “Post anyway” or “Issued without letter” button.

---

## Out of scope

- Encoding the work-repo backfill worksheet
- Publish to ForeFlight / VOCUS / OBDS
- Tagging `baseline/` or `historical/`
- GitHub tag protection settings (operator does that on the remote)
- Generating POI letters

---

## Done when

- No `issued/` tag exists without a hashed instrument on the issue/TR record
- Tag names are `issued/{abbrev}/{revision}`
- `test:slice2` and `test:slice3` pass
- UI still does not mention Git
- There is no verb that means “crews have it, so it launched”
