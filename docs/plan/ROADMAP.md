# Revdesk — Three pillars

Locked 2026-09-03. Numbered slices under this (0–4, 3b) are implementation cuts. These three are the system.

```text
1. Editor and review
2. Git adapter
3. Existing-manual ingest

Later: distribution (read receipts) + push (ForeFlight / VOCUS / OBDS)
```

Publish is not launch. Launch is not ingest. Ingest is not the editor.

---

## 1. Editor and review

The desk people sit at. Git never appears.

**In:** constrained section editor, change packages (`tr` | `rev`), author desk vs reviewer desk, instruments, TR vs full launch, CLI that is the same verbs.

**Done enough when:** an author opens a TR or rev, edits one or many sections, submits; a reviewer attaches a letter and launches; `revdesk launched` tells the truth.

**Where we are:** Slice 0 UI + Slice 1 CLI + Slice 2 launch/TR YAML are on main. Slice 4 (author/reviewer split + package kind) is the next cut — `docs/plan/slice-4-author-reviewer-desks.md`. Package rules live in `docs/plan/change-package-model.md`.

**Still inside this pillar, after Slice 4:** tighter TipTap schema, reviewer TR incorporate/withdraw before a rev launches, roles if we ever need more than status-as-desk.

---

## 2. Git adapter

Storage and review plumbing. Hidden.

**In:** local commit + annotated `issued/{CODE}/{rev}` only after a hashed instrument. `tag_ok`. Change branches. Later: one PR per TR; rev = umbrella + stacked per-section PRs. No force-move of `issued/`.

**Done enough when:** `issue` / `tr issue` cut a real tag or refuse; a hand-moved tag shows `tag_ok: false`; UI still does not say Git.

**Where we are:** `git_tag` is still a YAML string. Spec is Slice 3b (feed that, not the first Slice 3 draft). Work-repo `issued/` spelling is the tag template. Company-post-without-letter is **not** a Revdesk verb.

Do this after Slice 4 unless two agents will collide on `server/repo.ts`.

---

## 3. Existing-manual ingest

How a living GOM / FOTM / MEL becomes Revdesk sections instead of a toy fixture.

**In:** map a pipeline book (already-sectioned Markdown + frontmatter, or Word/PDF ingest) onto `manuals/<id>/sections/`, `manual.yaml` (control class, current issued, next rev), and a baseline issue record. Stable section ids. Do not invent `issued/` tags here — ingest can record *what the company believes is current* as data; cutting the tag is pillar 2 after an instrument exists.

**Done enough when:** one real book (start with GOM) opens in the desk with the right leaves, and a change packet can touch those leaves.

**Where we are:** `data/manuals/gom` and `fixtures/tiny-gom` only. The work manuals library and `CURRENT-REVISIONS.md` stay outside this repo until ingest has a contract.

---

## Later (not a fourth pillar yet)

- Required-read / read receipts (VOCUS-shaped)
- Push of-record PDF to ForeFlight S3, OBDS, VOCUS
- Stable current filename vs superseded archive

`publish ≠ issued/`. An accepted book may be pushed to crews only after Revdesk will allow a TR or a launched rev — not as a bypass.

---

## Build order

1. Finish pillar 1 through Slice 4 (desk matches the paper TR/rev rule).
2. Pillar 2 Git adapter (3b) so launch leaves a tag.
3. Pillar 3 ingest so the desk is the GOM, not Foo/Bar.

Ingest can start as a spike in parallel if it does not rewrite `server/repo.ts` while Slice 4 is open.
