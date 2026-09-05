# Revdesk — Correspondence (lock)

Locked 2026-09-04. Reviewer desk: pick a file or write a letter. Stationery render is Later. This is not `theme.yaml`.

CLI `revdesk instrument attach --file` stays. The desk no longer asks for a server-local path.

## File picker

Browser chooser → upload bytes → copy under `control/instruments/` → sha256 as today.

Used for:

- full-rev **launch instrument** (inbound POI / CAA / vendor letter, or a scanned internal memo)
- **TR letter** (`internal-letter` from `chief-pilot | ae | ceo | do`)

Record shape unchanged: `type`, `authority`, `dated`, `file`, `sha256`.

Typed paths only work when the browser and `REVDESK_DATA` share a box. They die in company mode. Kill the path field even on solo; the picker is the desk. CLI still takes `--file`.

## Compose window

A reviewer window to type a letter. What they are writing depends on `control_class`:

| Class | Window is | Role vs launch |
|---|---|---|
| `internal` | Acceptance **memo** (CP / DO / AE / CEO) | **Is** the launch instrument. Hash the stored source (Markdown + envelope). |
| `faa-accepted` / `faa-approved` / `third-party` | **Request letter** to the authority or vendor | **Not** the launch instrument. Launch still waits for the **inbound** reply, attached with the file picker, hashed as today. |

Do not let a composed request satisfy `issue`. That is the Slice 2 hole.

Both sit on the same reviewer desk: pick a file **or** write here. TR is always a memo (compose-or-pick), never a POI request.

`change approve` stays a status verb. This lock does not add a second artifact called “review acceptance.” If Approve itself needs a document, that is a later packet: internal sign-off, then inbound launch letter.

## Store

Composed body is Markdown plus a YAML envelope (`to`, `from`, `dated`, `subject`, `authority`, `change`). Under `control/instruments/` or `control/correspondence/`. Hash those bytes for an internal memo that *is* the instrument.

Sample files in `data/letters/` stay smoke fixtures. Do not invent live operator prose.

## Stationery — Later

Render memo / request on company letterhead (address block, signature line). That file is **not** `theme.yaml` (book house style: heads, steps, callouts). Do not build PDF letterhead in the dummy-remote slice.
