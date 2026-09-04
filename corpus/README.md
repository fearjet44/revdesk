# Parser training corpus (local only)

Put operator manuals, scans, and other third-party pages **here** to train the parser. This directory is gitignored except this file.

Do not copy those materials into `data/`, `fixtures/`, or anywhere else in the repo. Demo manuals under `data/` and `fixtures/` are synthetic lorem ipsum.

Nimbl sample PDFs in this folder are classify gold only. `revdesk ingest classify` reads them; `ingest scaffold` writes structure-matching lorem books. Never transcribe their prose into the sample library.
