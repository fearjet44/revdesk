# Revdesk — Three pillars

Locked 2026-09-03. Refreshed 2026-09-04. Numbered slices under this are implementation cuts. These three are the system.

```text
1. Editor and review
2. Git adapter
3. Existing-manual ingest

Later: stationery render, digital forms (78B-shaped), distribution, push
```

Publish is not launch. Launch is not ingest. Ingest is not the editor.

Solo file-backed, no-auth mode is not a prototype. It stays. Company remote git is an add-on. See `dual-mode.md`.

---

## 1. Editor and review

The desk people sit at. Git never appears.

**In:** constrained section editor, change packages (`wip` then `tr` | `rev` at review), author desk vs reviewer desk, instruments, TR vs full launch, CLI that is the same verbs.

**Done enough when:** an author opens a packet, edits one or many sections, submits; a reviewer attaches or composes the right letter and launches; `revdesk launched` tells the truth.

**Where we are:** Slices 0–2, 4, write marks, nested steps, and document theme are on main. Kind is named at review (`deferred-kind-and-wip.md`). Theme is `manuals/<id>/theme.yaml` (stable H1–H5, paper font + color, not LEP). The reviewer still pastes a server-local path to attach an instrument.

**Still inside this pillar:**

- Editor polish (current work). Do not freeze the desk for remote git.
- Issued print-only view + reference PDF (watermarked). Regulator of-record PDF is the unwatermarked exception — `issued-pdf.md`.
- File picker (upload) for the launch instrument and the TR letter — `correspondence.md`.
- Compose window keyed off `control_class`: internal **memo** (that letter *is* the instrument) vs regulator/third-party **request** (inbound reply still gates `issue`).
- Reviewer TR incorporate/withdraw before a rev launches (`change-package-model.md`).
- Stationery render of memo / request on company letterhead — Later, not theme.yaml.

---

## 2. Git adapter

Storage and review plumbing. Hidden.

**In:** local commit + annotated `issued/{CODE}/{rev}` only after a hashed instrument. `tag_ok`. Change branches. Remote origin (dummy, then real). Company mode: admin + logins. Later: one PR per TR; rev = umbrella + stacked per-section PRs. No force-move of `issued/`.

**Done enough when:** `issue` / `tr issue` cut a real tag or refuse; a hand-moved tag shows `tag_ok: false`; a dummy remote can receive the launch tag; UI still does not say Git; solo still runs with no account.

**Where we are:** Slice 3b is on main. Local adapter writes annotated tags, `source_commit`, `tag_ok`. `push_on_launch` exists and is **false**. No origin bind, no identities.

**Still inside this pillar:** dummy remote + fake suite (next **big** slice — `docs/handoffs/REVDESK-SLICE-7-DUMMY-REMOTE.md`). That slice spawns admin and logins **only** when a remote is bound. Solo stays no-auth. Never `git push --force`. Never delete an `issued/` tag.

Company-post-without-letter is **not** a Revdesk verb.

---

## 3. Existing-manual ingest

How a living GOM / FOTM / MEL becomes Revdesk sections instead of a toy fixture.

**In:** map a pipeline book onto `manuals/<id>/sections/`, `manual.yaml`, `theme.yaml`, and a baseline issue record. Stable section ids. Do not invent `issued/` tags here — ingest can record *what the company believes is current* as data; cutting the tag is pillar 2 after an instrument exists.

**Done enough when:** a fake suite in the dummy remote opens in the desk with the right leaves, and a change packet can touch those leaves. After that: one real book (start with GOM).

**Where we are:** Slice 6 scaffold is on main. `revdesk ingest classify` inspects LEP/LES/rev-only + Nimbl Word house style and guesses `theme.yaml`. Gold catalogs + lorem sample books (`gom-lep`, `tp`) sit beside the tiny desk `gom`. Real PDFs stay in `corpus/` (gitignored). `ingest apply` (transcribe operator prose) is not this era.

**Still inside this pillar:** ingest the **fake** suite into the dummy remote (work this with Slice 7). Then `ingest apply` for a real book.

---

## Later (not a fourth pillar yet)

- Admin: if a guessed paper font is not installed, suggest an open alternative (`document-theme.md`)
- Stationery: render composed memo / request on company letterhead (`correspondence.md`)
- Digital forms + sign, AC 120-78B-shaped, optional webhook-out (`forms.md`)
- Required-read / read receipts (VOCUS-shaped)
- Push of-record PDF to ForeFlight S3, OBDS, VOCUS
- Stable current filename vs superseded archive
- Gap-analysis CLI (`deferred-kind-and-wip.md`)

`publish ≠ issued/`. An accepted book may be pushed to crews only after Revdesk will allow a TR or a launched rev — not as a bypass.

Blank forms in the book are leaves. Filled, signed instances are records. Do not mix them.

---

## Build order

Editor work continues in parallel. Do not stop the desk for remote git.

1. Keep polishing the editor (current).
2. File picker (upload) on the reviewer desk.
3. Compose window (memo vs request by `control_class`). Store source; no letterhead yet.
4. Dummy remote + fake suite ingest (next big slice). Admin + logins only in company mode.
5. Stationery render.
6. Later: forms service, distribution, push.

Solo file-backed no-auth never drops off this list.
