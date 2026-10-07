# Parser training corpus (local only)

Put operator manuals, scans, and other third-party pages **here** to train and test the parser. This directory is gitignored except this file.

Do not copy those materials into `data/`, `fixtures/`, test snapshots, PR descriptions, or anywhere else in the repo. The sample library under `data/` and the fixtures under `fixtures/` are **practice** books: real section maps, placeholder (lorem) text.

Real company manuals that the operator has permission to use go into a **private library**: a folder outside this repo, or a private repository bound as the library origin. Open it in the desktop app (**Library → Open Library…**) or point the CLI at it with `REVDESK_DATA`. From T2.1 on, ingest refuses to write source text into the in-repo `data/` library.

Nimbl sample PDFs in this folder are classify gold. `revdesk ingest classify` reads them; practice mode (`ingest scaffold`, `ingest --practice`) writes structure-matching placeholder books.
