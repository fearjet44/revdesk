# Revdesk — Slice 7: Dummy remote + fake suite ingest

**Project:** fearjet44/revdesk
**Depends on:** Slices 0–4, 3b, 6 on main. Dual-mode lock `docs/plan/dual-mode.md`. Correspondence lock `docs/plan/correspondence.md`.
**This slice:** Bind a dummy remote manuals library. Ingest a **fake** suite (structure kept, bodies lorem). Config YAML + ingest dialog + CLI file verb.
**Not this slice:** `ingest apply` of corpus prose, stationery PDF, forms service, GitHub Apps as a product, force-push, deleting `issued/` tags, logins / identities, `push_on_launch` of issued tags.

Read `docs/plan/ROADMAP.md` and `docs/plan/dual-mode.md` first.

---

## Goal

Pillar 2 leftover is **remote**, not another local tag grammar. `push_on_launch` stays false.

**Done enough when:**

- `fearjet44/test-manual-repo` holds a fake manual suite (lorem bodies, Nimbl-shaped maps: `gom-lep`, `tp`).
- Desk config can point at that origin (`config.yaml`, later the Config screen).
- `revdesk ingest <file>` (and the desk dialog) classify a PDF/text, keep the section map, write lorem, and record it on the bound library.
- The desk still does not say Git.
- Solo still runs file-backed, no auth, no account.

Real PDFs stay in `corpus/` (gitignored). Never copy operator prose.

Identities / logins are the **next** spawn. Binding a remote does not turn a login wall on in this cut.

---

## Config

Human file, not JSON. The Config screen edits it.

Operator override (wins):

```text
~/.config/revdesk/config.yaml
```

In-tree default (solo sample): `data/.revdesk/config.yaml`.

```yaml
# Empty remote = this checkout’s data/ tree (solo, no account).
remote: https://github.com/fearjet44/test-manual-repo.git
```

Also accepted: `remote: { url: "..." }`.

When `remote` is empty, the library is `<app>/data`. When it is set, the desk clones to `$XDG_DATA_HOME/revdesk/libraries/<owner>-<name>` (default `~/.local/share/revdesk/libraries/…`) and uses that tree as `REVDESK_DATA`. `REVDESK_DATA` still wins for CLI tests.

CLI:

```text
revdesk config [show]
revdesk config set remote <url|"">
```

UI Config (`/config`) is the same two fields. Words: “library origin”, “manuals library URL”, “bind”, “disconnect”. Do not say branch, commit, tag, or push.

Tag grammar stays in `.revdesk/git.yaml` inside the **library**. Desk config does not absorb it.

---

## Ingest

Not `ingest apply` of operator prose. This era: structure + lorem.

```text
revdesk ingest <pdf|txt>
revdesk ingest apply <file>
revdesk ingest --file <file>
```

HTTP `POST /api/ingest` takes `filename` + base64 `content`. Refuse `file` (server path). CLI still takes a path.

Flow:

1. Classify (Slice 6).
2. If the map matches a gold catalog (`gom-lep`, `tp`), write that catalog.
3. Else build leaves from the extracted section map.
4. Scaffold lorem bodies, baseline issue, `theme.yaml`.
5. If the library is its own git tree, commit allowed paths and push `HEAD` to `origin` when origin exists. Never `--force`. Never cut an `issued/` tag.

UI: mast + home “Ingest a book”. File picker → Inspect map → Bring onto the desk.

---

## Dummy remote

Repo: `https://github.com/fearjet44/test-manual-repo` (private throwaway). Layout is a Revdesk library (`manuals/`, `control/`, `artifacts/`, `.revdesk/`), not the application.

Populate with `revdesk ingest` of the corpus PDFs (or `ingest scaffold` when the PDFs are absent). Bodies must not contain corpus operator strings.

---

## Locked (do not “fix”)

- Never `git push --force`. Never delete or move an `issued/` tag.
- No instrument → no tag. Composed **request** letters are not instruments.
- Local `enabled: false` / no-`.git`: YAML launch, `git_skipped`, no tag.
- UI does not say branch, commit, tag, or push.
- Solo unbound stays no-auth.

---

## Tests

`npm run test:slice7`. Keep `test:slice6` and `test:slice3`.

---

## Out of scope

- Transcribing PDF body text into Markdown
- Admin identities / logins
- `push_on_launch` of issued tags
- Stationery letterhead
- GitHub Apps as a product
