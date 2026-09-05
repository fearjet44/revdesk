# Revdesk — Document theme (lock)

Locked 2026-09-05. House style for a book is `manuals/<id>/theme.yaml`, next to `manual.yaml`. Not `doc-theme.yaml`. It is not the LEP ledger, not the desk chrome, and not company letterhead.

Ingest guesses. A human edits. Re-classify / re-scaffold does not overwrite an existing theme.

## File

Missing file = defaults: five heading levels, `decimal`, stable, restart per leaf; steps `1.` `a.` `(1)` `(a)` `(i)`; desk paper (IBM Plex, cream); current callout inks.

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
font:
  body: IBM Plex Sans
  heading: IBM Plex Sans Condensed
color:
  paper: "#f3eee2"
  ink: "#1c1a14"
callouts:
  note:    { ink: "#3d7ea6" }
  caution: { ink: "#d4891a" }
  warning: { ink: "#c43c32" }
```

`nimbl`: H1 `Section N` (`5`), H2 `5.7.0` / `5.7.1` / `5.7.2`, H3 `5.7.1.1`, H4 `5.7.1.1.1`. The `.0` is the first H2 in a group, not a different depth from `5.7.1`. Decimal: H1 `5`, H2 `5.7`, H3 `5.7.1`. Font guess Verdana / Verdana, white paper. Do not invent `.0` on a decimal book.

TUI rail/mast fonts stay IBM Plex. Paper only follows this file.

## Headings

H1–H5 stamp the next **stable** number at that level from headings **before this line**, then freeze.

After `5.7.1`: H1 → `Section 5`; H2 → `5.7.2` (not `5.8.0`); H3 → `5.7.1.1`; H4 → `5.7.1.1.1`. Wrong button, same line, no Return: retarget at the new level. Already H3+: going **deeper** nests under this line (`5.7.1.1` → H4 → `5.7.1.1.1`). No live reflow. No sibling rewrite.

Leaf number comes from the title (`Section 5`, `Appendix A`) when `leaf_prefix` is on. Front matter with no number starts at `1`.

## Fonts and color

Ingest does its best:

- PDF: `pdffonts` (optional; classify still works without it). Strip subset prefixes and Bold/Italic cuts. Body = the family that shows up most. Heading = that family, unless the body is serif and a sans (Arial / Calibri / Helvetica) is also present.
- No font list: `nimbl-word` → Verdana on white; unknown → desk Plex on cream.
- Color: a real PDF or Nimbl book → white paper, near-black ink. Do not scrape spot color from the PDF this cut.

The stored name is what was found (`Verdana`, `Times New Roman`). CSS applies an open fallback stack so the paper still renders (Liberation / DejaVu / Carlito). **Later (admin / config):** if that face is not installed, suggest those open alternatives and let the human write one into `theme.yaml`. Do not silently rewrite the guessed name.

## Steps and callouts

Tab / Shift+Tab / Shift+Enter unchanged. Marker strings come from the theme. Callout inks bind on the paper only.
