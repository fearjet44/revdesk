# Revdesk — Slice 5: Deferred kind + WIP save + reviewer classifies

Handoff for the coding agent. Behavior lock: `docs/plan/deferred-kind-and-wip.md`.

**Project:** fearjet44/revdesk  
**Depends on:** Slice 4 (author/reviewer desks + kind field) already on main.  
**This slice:** Authors edit and Save without naming TR vs rev. Reviewer classifies after submit.  
**Not this slice:** Git tags (3b), TR incorporate/withdraw matrix, gap-analysis CLI, ingest.

---

## Goal

An author opens a packet, edits sections, **Save**s WIP, **submits**, or **withdraws**.  
They do **not** pick Temporary revision vs Full revision at start.  
After submit, the reviewer **classifies** the packet (`tr` | `rev`), then attaches the instrument and launches.

---

## Files touched

```text
server/types.ts
server/repo.ts
server/plugin.ts
cli/revdesk.ts
src/types.ts
src/api.ts
src/components/StartChangeDialog.tsx
src/components/ChangeView.tsx
src/components/SectionEditor.tsx
scripts/slice2-acceptance.sh
scripts/slice3-acceptance.sh
docs/plan/slice-5-deferred-kind.md
docs/plan/ROADMAP.md
```

Keep the current dark theme.

---

## Behavior

1. **Start** — no kind radio. Optional CLI `--kind` only.
2. **Author desk** — Submit / Withdraw / Edit / Save. Stamp `—` if unclassified.
3. **Reviewer desk** — PACKAGE KIND → classify → LAUNCH CONTROLS.
4. **Gates** — `issue` needs `kind=rev`; `tr issue` needs `kind=tr`.

## Done when

- Start dialog has no package-kind radio
- Classify before launch is required
- `npm run test:slice2` and `npm run test:slice3` pass
