# REVDESK — Controlled Manual Desk

Local editor for controlled manuals. The author desk never mentions Git. The reviewer screen shows a line diff and stores comments as git notes. Persistence is Markdown with YAML frontmatter plus control YAML under `data/`.

## Run (UI)

```sh
npm install
npm run dev
```

## CLI

Same binary for Slice 1 + Slice 2. No server required. Override the library with `REVDESK_DATA`.

```sh
./bin/revdesk status
./bin/revdesk launched gom
npm run test:slice2   # Slice 2 acceptance path
npm run test:slice6   # Slice 6 ingest classify + lorem scaffold
npm run test:review   # reviewer diff + git-notes comments
```

### Launch model

- A **full revision** exists only after `issue` with a **stored instrument** (letter + sha256).
- Operating sooner → `tr issue` against the last launched full rev (`GOM-R13-TR1`).
- After full or TR launch, `change withdraw` exits 2.
- Revision numbers are assigned only at full launch (`manual.next_revision`).

```text
draft → review → approved → ready-to-launch → launched
                              ↘ edit
```

### Commands

```text
revdesk instrument attach <CHG> --file <path> --type <type> --authority <who> --dated YYYY-MM-DD
revdesk instrument show   <CHG>

revdesk issue <CHG> --effective YYYY-MM-DD
revdesk issue show <GOM-R14>

revdesk tr issue <CHG> --parent <GOM-R13> --authority <who> --file <letter> [--expires YYYY-MM-DD]
revdesk tr list [--manual gom]
revdesk tr show <GOM-R13-TR1>

revdesk launched <manual>
revdesk change withdraw <CHG>
revdesk change start --manual gom --supersedes GOM-R14 --reason-type regulator
revdesk change return-to-edit <CHG>
```

Exit codes: `0` ok · `2` validation · `3` not found · `4` not allowed · `5` pipeline.

## Layout

```
data/
  manuals/<id>/manual.yaml
  manuals/<id>/sections/*.md
  letters/…                    # sample POI letter + .eml for smoke attach
  control/changes/CHG-*.yaml
  control/working/CHG-*/…
  control/instruments/…        # hashed copies after attach; do not edit
  control/issues/<MANUAL>-R<n>.yaml
  control/trs/<MANUAL>-R<n>-TR<k>.yaml
  artifacts/…                  # placeholder PDF this slice
```

Fixture for acceptance: `fixtures/tiny-gom`.

Sample section bodies in `data/` and `fixtures/` are **lorem ipsum**. Put real operator manuals for parser training in `corpus/` (gitignored). Do not commit them.

Nimbl-shaped samples `gom-lep` (LEP GOM) and `tp` (training program) keep the supplier’s section map; bodies are lorem. Classify a corpus PDF with `revdesk ingest classify <pdf>`.

## License

Copyright 2026 fearjet44

Licensed under the Apache License, Version 2.0. See [`LICENSE`](LICENSE) and [`NOTICE`](NOTICE).
