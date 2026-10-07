# Revdesk — Figures (contract)

Locked 2026-10-07. Raster or vector images that live inside a leaf: org charts, photos, maps, form facsimiles, and anything an imported manual already carries as a picture. T2 (ingest) writes to this contract and T3 (editor/print) reads it. Neither invents its own shape.

**Mermaid still wins for diagrams Revdesk authors.** `mermaid.md` stands. A flowchart someone draws in the desk is a mermaid fence, not a PNG. A figure is for a picture that already exists and cannot be expressed as a mermaid graph, or has not been redrawn yet. An imported flowchart lands as a figure. Turning it into mermaid is a later edit by a person, not ingest's job.

## Markdown

One block per figure, on its own line, with blank lines around it:

```markdown
![Organization chart, Director of Operations reporting line](figures/3f9a1c0b2e7d.png)
```

- The alt text is the **caption**. It is controlled text: it prints under the image and diffs like prose. It may be empty (`![](figures/…)`), but ingest should fill it when the source has a caption.
- `src` is always `figures/<file>`, relative to the manual. No `../`, no absolute paths, no URLs. The parser keeps anything else as a plain paragraph.
- Optional width hint as a trailing attribute: `![Caption](figures/x.png){width=50%}`. Values are `25% | 50% | 75% | 100%`; the default is 100%. The serializer emits it only when the value is not 100%.
- No inline images. `![…](…)` in the middle of a sentence stays text.

Node: `{ type: 'figure', attrs: { src: 'figures/<file>', caption: string, width: '25%'|'50%'|'75%'|'100%' } }`. The block must round-trip exactly through `parseBody` → `serializeBody` (`src/schema/markdown.ts`), the same way the mermaid fence does.

## Storage

```text
manuals/<id>/figures/<sha256-first-12-hex>.<ext>
```

- **Content-addressed.** The filename is the first 12 hex characters of the sha256 of the bytes. The same bytes always produce the same name. A changed picture is a new file.
- **Write-once.** Never overwrite a figure file and never delete one. An unreferenced file is harmless: issued paper only shows what a leaf references. This is why a change packet can add a figure straight into `manuals/<id>/figures/` without touching the launch flow. The working-copy leaf in `control/working/<CHG>/` references it, and nothing issued does until launch.
- Allowed types: `png`, `jpg` (write `.jpg` for jpeg), `gif`, `svg`, `webp`. Anything else is refused (exit 2). Word `emf`/`wmf` are converted to png by ingest, or kept as a placeholder and reported (see Ingest).
- Size cap: 10 MB per file (exit 2 above that).
- `manuals/` is already an allowed snapshot prefix (`server/git.ts`), so figures go with the leaf's commit and tag. Nothing to change there.

Orphan sweeping is a later chore, not part of this contract.

## API

The JSON-plus-base64 upload convention is the same one letters and ingest use (`server/plugin.ts`).

```text
GET  /api/manuals/:id/figures/:file           → bytes, Content-Type from the extension, Cache-Control: immutable
POST /api/manuals/:id/figures   { filename, content: base64 }
                                               → 201 { src: "figures/<hash>.<ext>", bytes, existed: bool }
```

- `:file` must match `^[0-9a-f]{12}\.(png|jpg|gif|svg|webp)$`. Anything else → 404. This is the path-traversal guard; do not "resolve and compare" instead.
- POST hashes, refuses bad types or sizes, writes if absent, and returns `existed: true` when the file was already there.
- Serve SVG with `Content-Security-Policy: script-src 'none'`. An SVG from a Word file is untrusted.

Server module: `server/figures.ts` (T3). Ingest (T2) calls its `writeFigure(dataRoot, manualId, bytes, ext)` instead of writing files itself.

## Editor and Issued

- The figure node renders `<figure><img src="/api/manuals/<id>/figures/<file>"><figcaption>caption</figcaption></figure>`. The node view needs the manual id, so pass it through the editor's extension options; do not parse it out of the URL.
- Editor: the caption is editable inline (plain text, no marks). The image itself is replaced, not edited. Width comes from a small menu.
- Issued rail: read-only, same markup.
- Missing file: draw a bordered box reading "Figure missing: <file>". Never drop the block.

## Print

`renderNode` in `server/print.ts` inlines the bytes as a `data:` URI. Headless Chrome then needs no server and no file URLs.

```html
<figure class="figure" style="width:50%"><img src="data:image/png;base64,…" alt=""><figcaption>Caption</figcaption></figure>
```

- `break-inside: avoid`. The page ledger owns any overflow; images change pagination like any other block.
- Captions use the body font from `theme.yaml`, small and centered. Numbering ("Figure 3-2") is later.

## Ingest

- **.docx:** each embedded image → `writeFigure`. The caption is the next paragraph when its Word style is `Caption`; otherwise the alt text; otherwise empty. Convert `emf`/`wmf` with a pure-JS path if one exists. If none does, write a placeholder figure block with an empty `src`, `![EMF image not converted: <name>]()`, which the parser keeps as text, and list it in the import report.
- **PDF:** no positional image extraction in this era. Each page that had images gets a text placeholder paragraph `[Figure on source page N — place by hand]`, and the import report lists it. Never silently drop.

## Not this contract

Figure numbering and a list of figures, change bars on images, image editing or cropping, linking a figure across manuals, orphan sweep, alt text separate from the caption.
