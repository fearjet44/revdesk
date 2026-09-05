# Revdesk — Issued view and reference PDF (lock)

Locked 2026-09-05. The launched book in Revdesk is the controlled copy. A PDF is a derivative.

## Pile of pages

Open dirties **one** issued leaf into a working copy. Do not offer “Open several pages.” A reviewer reads a pile of pages, not a multi-select packet minted at start. Kind is still named at review (`deferred-kind-and-wip.md`).

## Issued screen

The issued manual screen is view-first:

- Click a section → print-only, non-editable paper of that leaf. No write dock, no B/I/U, no Review toggle.
- **Open** on that leaf still starts a one-page working copy. Do not bury Open.
- **PDF** on the issued screen opens a **new tab** of the whole book.

## PDF

The new tab shows the generated PDF and a **Download** button.

Every crew / desk download is stamped in the header:

```text
Reference Only - This is not a controlled copy - Downloaded: YYYY-MM-DD HH:MM UTC
```

That stamp is the point. This is a first-class electronic manual. Walking around with a PDF does not make you current.

`GET /api/manuals/:id/pdf` defaults to `kind=reference` (watermarked). `download=1` is an attachment.

## Regulator exception

The only unwatermarked PDF is the of-record copy that goes to the regulator for digital signature.

`GET /api/manuals/:id/pdf?kind=regulator` — not the issued-screen Download button. Do not put a clean PDF on the crew/desk download path. Launch may later write that file to `artifacts/<issue>.pdf`. Until then the API is the exception.

## Not this lock

Stationery, ForeFlight/OBDS push, historical-revision PDFs from superseded markdown, and signing the of-record bytes are Later (`ROADMAP.md`).
