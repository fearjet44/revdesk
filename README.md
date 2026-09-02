# REVDESK — Controlled Manual Desk

Local editor for controlled manuals. The UI never mentions Git. Persistence is Markdown with YAML frontmatter plus a change YAML in `data/`.

## Run

```sh
npm install
npm run dev
```

Open the URL Vite prints (usually `http://localhost:5173`).

## v0

- List manuals and the current issued revision from `manual.yaml`
- Open a change → `control/changes/CHG-YYYY-NNN.yaml` and a working copy of each touched section
- Edit a section in TipTap (heading, paragraph, note, caution, warning, steps, table)
- Write Markdown with frontmatter `id`, `title`, `rev_last_changed`
- Submit for review → approve → issue
- On issue: bump touched sections, write `control/issues/GOM-Rxx.yaml` with a placeholder SHA-256

No auth, no multiplayer, no AI.

## Sample library

The `data/` tree is the repo:

```
data/
  manuals/gom/
    manual.yaml                 # current issued revision
    sections/*.md               # issued text
  control/
    changes/CHG-YYYY-NNN.yaml   # change packet
    working/CHG-YYYY-NNN/*.md   # editable copies
    issues/GOM-Rxx.yaml         # issued revision record
```

Shipped sample: GOM with four sections, issued **R13**, and draft change **CHG-2026-001** against Section A.
