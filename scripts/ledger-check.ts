import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  applyPageCount,
  effectivePages,
  lepRows,
  nextSlot,
  seedLedger,
  type LedgerLeaf,
} from '../server/ledger.ts'
import { scaffoldCatalog } from '../server/ingest.ts'
import { renderIssuedPdf } from '../server/print.ts'
import { Repo } from '../server/repo.ts'

let failed = 0

function check(label: string, ok: boolean, detail?: string) {
  if (ok) console.log(`ok ${label}`)
  else {
    failed += 1
    console.error(`FAIL ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

check('next chapter seq', nextSlot('1-1', 'seq', 'chapter-page', '1') === '1-2')
check('next appendix seq', nextSlot('A-1', 'seq', 'section-page', 'A') === 'A-2')
check('next roman', nextSlot('xiv', 'seq', 'roman-front', null) === 'xv')
check('next suffix', nextSlot('A-1', 'suffix', 'section-page', 'A') === 'A-1a')
check('next suffix b', nextSlot('A-1a', 'suffix', 'section-page', 'A') === 'A-1b')

const leaf: LedgerLeaf = {
  id: 's1',
  title: 'Section 1 — Policy',
  scheme: 'chapter-page',
  letter: '1',
  rev_content: 11,
  pages: [
    {
      slot: '1-1',
      seq: 1,
      rev_content: 11,
      rev_page: 11,
      reflow_of: null,
      dagger: false,
      overflow: false,
      omitted: false,
      printed_as: null,
    },
  ],
}

const overflow = applyPageCount(leaf, 3, 12, 'seq')
check('overflow length', overflow.pages.filter((page) => !page.omitted).length === 3)
check('overflow 1-2', overflow.pages[1]?.slot === '1-2')
check('overflow dagger', overflow.pages[1]?.dagger === true && overflow.pages[1]?.overflow === true)
check('overflow reflow', overflow.pages[1]?.reflow_of === '1-1')
check('overflow rev_content stays', overflow.pages[1]?.rev_content === 11)
check('overflow rev_page current', overflow.pages[1]?.rev_page === 12)
check('first face not dagger', overflow.pages[0]?.dagger === false)

const under = applyPageCount(overflow, 1, 12, 'seq')
check('underflow keeps history', under.pages.length === 3)
check('underflow omits extra', under.pages.filter((page) => page.omitted).length === 2)
check('underflow visible 1', under.pages.filter((page) => !page.omitted).length === 1)

const restore = applyPageCount(under, 2, 12, 'seq')
check('reopen omitted slot', restore.pages[1]?.omitted === false && restore.pages[1]?.slot === '1-2')

const dir = mkdtempSync(path.join(tmpdir(), 'revdesk-ledger-'))
try {
  scaffoldCatalog('gom-lep', dir)
  check('ingest wrote ledger.yaml', readFileSync(path.join(dir, 'manuals', 'gom-lep', 'ledger.yaml'), 'utf8').includes('control_surface: lep'))
  const repo = new Repo(dir)
  const ledger = repo.readLedger('gom-lep')
  check('seeded surface lep', ledger.control_surface === 'lep')
  const rows = lepRows(ledger)
  check('lep rows from ledger', rows.some((row) => row.slot === '1-1'))
  check('section 1 owns 1-1', rows.some((row) => row.slot === '1-1' && /Section 1/.test(row.section)))
  const paper = repo.issuedSection('gom-lep', 'gomlep-lep')
  check('hydrated LEP uses ledger slot', paper.markdown.includes('| 1-1 |'))
  check('pages on issued section', paper.pages.some((page) => page.slot === 'iii' || page.slot.startsWith('i')))
  const ident = repo.issuedSection('gom-lep', 'gomlep-1')
  check('body leaf has slot stamp', ident.pages.some((page) => page.slot === '1-1'))
} finally {
  rmSync(dir, { recursive: true, force: true })
}

const revDir = mkdtempSync(path.join(tmpdir(), 'revdesk-ledger-rev-'))
try {
  mkdirSync(path.join(revDir, 'manuals', 'hb', 'sections'), { recursive: true })
  writeFileSync(
    path.join(revDir, 'manuals', 'hb', 'manual.yaml'),
    `id: hb
title: Handbook
abbrev: HB
control_class: internal
owner: Chief Pilot
authority: chief-pilot
instrument_required: false
current_issued: HB-R1
next_revision: 2
effective: 2026-01-01
`,
  )
  writeFileSync(
    path.join(revDir, 'manuals', 'hb', 'sections', '000-ident.md'),
    `---
id: hb-1
title: Identification
rev_last_changed: R1
---

# Identification
`,
  )
  const repo = new Repo(revDir)
  const ledger = seedLedger(repo.readManual('hb'), repo.listSections('hb'))
  check('rev-only surface', ledger.control_surface === 'rev-only')
  check('rev-only no page slots', ledger.leaves.every((leaf) => leaf.pages.length === 0))
  check('rev-only LEP empty', effectivePages(ledger).length === 0)
} finally {
  rmSync(revDir, { recursive: true, force: true })
}

const flowDir = mkdtempSync(path.join(tmpdir(), 'revdesk-ledger-flow-'))
try {
  mkdirSync(path.join(flowDir, 'manuals', 'mini', 'sections'), { recursive: true })
  writeFileSync(
    path.join(flowDir, 'manuals', 'mini', 'manual.yaml'),
    `id: mini
title: Mini LEP
abbrev: MINI
control_class: internal
owner: Chief Pilot
authority: chief-pilot
instrument_required: false
current_issued: MINI-R1
next_revision: 2
effective: 2026-01-01
pagination:
  control_surface: lep
  regions:
    - name: body
      scheme: chapter-page
lep_slots:
  - 1-1
`,
  )
  const paras = Array.from({ length: 80 }, (_, i) => `Paragraph ${i + 1}. ${'lorem '.repeat(40).trim()}.`).join('\n\n')
  writeFileSync(
    path.join(flowDir, 'manuals', 'mini', 'sections', '100-section-01.md'),
    `---
id: mini-1
title: Section 1 — Policy
rev_last_changed: R1
lep_start: 1-1
---

# Section 1: Policy

${paras}
`,
  )
  const repo = new Repo(flowDir)
  await renderIssuedPdf(repo.issuedBook('mini'), { kind: 'regulator' }, {
    persistLedger: (ledger) => repo.writeLedger('mini', ledger),
    rehydrate: () => repo.issuedBook('mini'),
  })
  const ledger = repo.readLedger('mini')
  const vis = ledger.leaves[0]?.pages.filter((page) => !page.omitted) ?? []
  check('flow wrote overflow faces', vis.length >= 2, `got ${vis.length}`)
  check('flow 1-2 exists', vis.some((page) => page.slot === '1-2'))
  check('flow dagger on overflow', vis.some((page) => page.slot !== '1-1' && page.dagger))
  check('flow printed_as stamped', vis.every((page) => page.printed_as != null))
} catch (error) {
  failed += 1
  console.error(`FAIL flow paginate — ${error instanceof Error ? error.message : error}`)
} finally {
  rmSync(flowDir, { recursive: true, force: true })
}

if (failed) {
  console.error(`${failed} failed`)
  process.exit(1)
}
console.log('ledger ok')
