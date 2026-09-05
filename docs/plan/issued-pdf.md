# Revdesk — Three rails, issued PDF, crew findings (lock)

Locked 2026-09-05. The launched book in Revdesk is the controlled copy. A PDF is a derivative.

The left rail is already the stub for multi-user.

| Rail | Who lives here | Open means |
|---|---|---|
| **Manuals** | Author | Print view **with editor**. Dirties one leaf into a working copy. |
| **Open changes** | Author / reviewer | The packet. |
| **Issued** | Crew / read-only (pilot stub) | Print-only paper. No dirty. No line gutter. May leave a **CF**. **PDF** lives here. |

Solo still shows all three. Company mode later: a read-only login **only** sees Issued. An auditor / regulator rail can reuse this paper later (comments, not edits).

## Manuals (author)

- No PDF button. No CF composer.
- Section title is not a crew view.
- **Open** → Print with B/I/U, write dock, line gutter (review queries). Starts a one-page `wip` if the leaf is free; otherwise `On CHG-…`.
- Do not offer “Open several pages.”

CFs on that leaf are **visible** here as incoming notes. Author does not leave CFs here.

## Issued (crew)

Rail lists the **current** launched book per manual (GOM R13, TP R9), not the instrument ledger. Letter hash / artifact sha sit in a quiet stamp.

- **PDF** at the top → new tab, Download, watermark below.
- **Open** (or the leaf) → read-only paper. House theme. No write dock, no B/I/U, no Review toggle, **no line numbers**. Cannot start a change.

## PDF

Every crew / desk download is stamped in the header on every page:

```text
Reference Only - This is not a controlled copy - Downloaded: YYYY-MM-DD HH:MM UTC
```

`GET /api/issues/:id/pdf` and `GET /api/manuals/:id/pdf` default to `kind=reference`. `download=1` is an attachment.

The only unwatermarked PDF is `kind=regulator` (of-record for signature). Not the Issued Download button.

## Crew finding (CF)

Only composable on Issued paper. One thread **per leaf** this cut (highlighted passage later).

Does not write `manuals/<id>/sections/*.md`. Never launched onto `issued/`. Store `control/findings/<issue-id>/cf-….yaml`.

```yaml
id: cf-…
issue: GOM-R13
manual: gom
section: gom-ident
author: Chief Pilot
at: …
body: …
status: open
```

Distinct from review queries (line + Done/Stand/Later on a change) and from write marks (RF / AEF / IA). **Later (not this cut):** a CF gets the **same author answers** as an auditor query (Done / Stand / Later). Crew then see their note close — feedback that it was received. That also stubs an auditor rail. Do not promote CF → query this cut.

### Visibility this cut

| Viewer | Sees |
|---|---|
| The crew who wrote it | Own CFs on that leaf |
| Other crew | Nothing. The paper is clean. |
| Author (Manuals / editor) | CFs on that leaf |
| Reviewer (packet, if the leaf is touched) | CFs on that leaf |

Solo no-auth: you are the author, so you see CFs, and you may leave one from Issued. Company mode later enforces the table. No role switcher this cut. CFs are not on the PDF.

## Not this lock

CF answer (Done/Stand/Later), selected-text cites, historical-revision PDFs, hiding Manuals/Open changes behind a crew login, auditor rail UI, stationery, ForeFlight/OBDS push.
