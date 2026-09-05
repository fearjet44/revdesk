# Revdesk — Document theme (lock)

Locked 2026-09-05. House style for a book is `manuals/<id>/theme.yaml`, next to `manual.yaml`. It is not the LEP ledger and not the desk chrome.

Ingest guesses. A human edits. Re-classify / re-scaffold does not overwrite an existing theme.

## File

Missing file = defaults: five heading levels, `decimal`, stable, restart per leaf; steps `1.` `a.` `(1)` `(a)` `(i)`; current paper callout inks.

```yaml
heading:
  levels: 5
  scheme: decimal          # decimal | nimbl
  persist: stable
  restart: leaf
  leaf_prefix: true
steps:
  levels: 5
  markers: ["1.", "a.", "(1)", "(a)", "(i)"]
callouts:
  note:    { ink: "#3d7ea6" }
  caution: { ink: "#d4891a" }
  warning: { ink: "#c43c32" }
```

`nimbl`: H1 `Section N: Title`, H2 `N.N.0`, H3+ `N.N.N`. Do not invent `.0` on a book that does not use it.

## Headings

H1–H5 in the editor and in Markdown. H1 is the printed chapter head (not auto-numbered). H2–H5 stamp the next **stable** number into the heading text on insert, then freeze. No live reflow. No sibling rewrite on promote/demote.

Leaf number comes from the title (`Section 5`, `Appendix A`) when `leaf_prefix` is on. Front matter with no number starts at `1`.

## Steps and colors

Tab / Shift+Tab / Shift+Enter unchanged. Marker strings come from the theme. Callout inks bind on the paper only.
