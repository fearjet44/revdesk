import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  applyPageCount,
  assignLepRows,
  effectivePages,
  firstSlot,
  formatPageRev,
  formatRevNumber,
  lepRows,
  letterForLeaf,
  nextSlot,
  parseLedger,
  schemeForLeaf,
  seedLedger,
  type BookLedger,
  type LedgerLeaf,
  type LepSourceRow,
} from '../server/ledger.ts'
import { scaffoldCatalog } from '../server/ingest.ts'
import { inferStart, type ManagedLeafInput } from '../server/managed.ts'
import { renderIssuedPdf } from '../server/print.ts'
import { Repo } from '../server/repo.ts'
import { toolPath } from '../server/tools.ts'
import type { ManualRecord, SectionSummary } from '../server/types.ts'

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

/* ---------- T4.3: the book's LEP copied into the ledger ---------- */

// Decision 2: spelling follows the LEP; roman case is kept on overflow.
check('next upper roman keeps case', nextSlot('XIV', 'seq', 'roman-front', null) === 'XV')
check('next lower roman keeps case', nextSlot('xiv', 'seq', 'roman-front', null) === 'xv')
const coverLeaf: ManagedLeafInput = { id: 'b-cover', title: 'Cover', rev_last_changed: 'R1', managed: null, lep_start: 'A' }
check('cover start A is letter-cover', schemeForLeaf(coverLeaf, []) === 'letter-cover')

// Decision 3: multi-part prefixes are one unit.
check('next E-I-10', nextSlot('E-I-10', 'seq', 'section-page', 'E-I') === 'E-I-11')
check('next AC-12', nextSlot('AC-12', 'seq', 'section-page', 'AC') === 'AC-13')
check('next suffix E-I-1', nextSlot('E-I-1', 'suffix', 'section-page', 'E-I') === 'E-I-1a')
const eiLeaf: ManagedLeafInput = { id: 'b-e-i', title: 'Section E-I — Airworthiness', rev_last_changed: 'R1', managed: null, lep_start: 'E-I-1' }
const acLeaf: ManagedLeafInput = { id: 'b-c', title: 'Appendix C — Forms', rev_last_changed: 'R1', managed: null, lep_start: 'AC-1' }
check('E-I start is section-page', schemeForLeaf(eiLeaf, []) === 'section-page')
check('letter E-I', letterForLeaf(eiLeaf, 'section-page') === 'E-I')
check('letter AC, not the title letter', letterForLeaf(acLeaf, 'section-page') === 'AC')
check('first slot E-I-1', firstSlot('section-page', 'E-I', null) === 'E-I-1')
check('first slot AC-1', firstSlot('section-page', 'AC', null) === 'AC-1')
check('single-letter letter unchanged', letterForLeaf({ ...acLeaf, lep_start: 'A-1' }, 'section-page') === 'A')
check('bulletin id ending -1 has no start', inferStart({ id: 'gom-gom-bulletin-no-1', title: 'Bulletin No. 1' }) === null)
check('bare section id still infers', inferStart({ id: 'gom-a', title: 'Section A' }) === 'A-1')

// Decision 4: revision 0 prints Original on the LEP and the footer; formatRevNumber unchanged.
check('page rev 0 is Original', formatPageRev(0) === 'Original')
check('page rev 1 is R1', formatPageRev(1) === 'R1')
check('formatRevNumber 0 unchanged', formatRevNumber(0) === '—')

const leafIn = (id: string, lep_start: string | null, managed: ManagedLeafInput['managed'] = null): ManagedLeafInput => ({
  id,
  title: id,
  rev_last_changed: 'R1',
  managed,
  lep_start,
})
const bookLeaves = [
  leafIn('cover', 'A'),
  leafIn('tob', 'I'),
  leafIn('bulletin', null),
  leafIn('ack', 'III'),
  leafIn('admin', 'IV'),
  leafIn('intro', 'V'),
  leafIn('toc', null, 'toc'),
  leafIn('lep', null, 'lep'),
  leafIn('ror', 'XIV', 'ror'),
  leafIn('sec-e-i', 'E-I-1'),
]
const row = (slot: string, rev: number, group: string | null): LepSourceRow => ({ slot, rev, group })
const bookRows: LepSourceRow[] = [
  row('A', 1, 'TITLE'),
  row('B', 0, null),
  row('I', 1, 'TOB'),
  row('II', 1, null),
  row('III', 1, 'INST'),
  row('IV', 1, 'ADMIN'),
  row('V', 1, null),
  row('X', 0, null),
  row('XIV', 1, null),
  row('XV', 0, null),
  row('E-I-1', 0, 'SECTION E- I'),
  row('E-I-9', 1, null),
  row('E-I-9', 1, null),
  row('ZZ-1', 1, 'SECTION Z'),
].map((r, i, all) => ({ ...r, group: r.group ?? all.slice(0, i).reverse().find((x) => x.group)?.group ?? null }))
const assigned = assignLepRows(bookRows, bookLeaves)
const owned = (id: string) => (assigned.pages.get(id) ?? []).map((p) => p.slot).join(' ')
check('copy: cover A B', owned('cover') === 'A B')
check('copy: TOB I II', owned('tob') === 'I II')
check('copy: group bounds INST to its leaf', owned('ack') === 'III')
check('copy: ADMIN split by starts', owned('admin') === 'IV' && owned('intro') === 'V X' && owned('ror') === 'XIV XV')
check('copy: E-I prefix', owned('sec-e-i') === 'E-I-1 E-I-9')
// Decision 5: rows that don't fit are held.
check('held: duplicate slot', assigned.held.some((h) => h.slot === 'E-I-9' && /twice/.test(h.reason)))
check('held: group with no leaf', assigned.held.some((h) => h.slot === 'ZZ-1'))
check('copied in LEP order, once each', assigned.copied.join(' ') === 'A B I II III IV V X XIV XV E-I-1 E-I-9')
// Decision 6 and 7: no start and no row means unpaginated; inside one group's run, start unknown.
check('unpaginated leaves', assigned.unpaginated.join(' ') === 'bulletin toc lep', assigned.unpaginated.join(' '))
check('start unknown only inside one group', assigned.start_unknown.join(' ') === 'toc lep', assigned.start_unknown.join(' '))
const noInst = assignLepRows(bookRows, bookLeaves.filter((leaf) => leaf.id !== 'ack'))
check('group bound: III never goes to the TOB leaf', !noInst.pages.get('tob')?.some((p) => p.slot === 'III') && noInst.held.some((h) => h.slot === 'III'))

const miniManual = (lep_slots: string[]): ManualRecord => ({
  id: 'mini',
  title: 'Mini',
  abbrev: 'MINI',
  control_class: 'internal',
  control: 'internal',
  owner: 'Chief Pilot',
  authority: 'chief-pilot',
  instrument_required: false,
  current_issued: 'MINI-R1',
  next_revision: 2,
  effective: '2026-01-01',
  pagination: { control_surface: 'lep', lep_inferred: false, regions: [] },
  lep_slots,
})
const summaries = (leaves: ManagedLeafInput[]): SectionSummary[] =>
  leaves.map((leaf) => ({ ...leaf, path: `manuals/mini/sections/${leaf.id}.md`, filename: `${leaf.id}.md`, open_change: null }))
const copiedLedger = seedLedger(miniManual(assigned.copied), summaries(bookLeaves), { lep: bookRows })
const ledgerLeafOf = (ledger: BookLedger, id: string) => ledger.leaves.find((leaf) => leaf.id === id)!
check('seed: unpaginated is scheme none, no slots', ['bulletin', 'toc', 'lep'].every((id) => ledgerLeafOf(copiedLedger, id).scheme === 'none' && ledgerLeafOf(copiedLedger, id).pages.length === 0))
check('seed: rev from each row', ledgerLeafOf(copiedLedger, 'cover').pages.map((p) => p.rev_page).join(',') === '1,0')
check('seed: no 1-1 or i invented', !effectivePages(copiedLedger).some((p) => p.slot === '1-1' || p.slot === 'i'))
check('seed: LEP rows print Original', lepRows(copiedLedger).find((r) => r.slot === 'B')?.rev === 'Original')
check('render count leaves unpaginated alone', applyPageCount(ledgerLeafOf(copiedLedger, 'toc'), 3, 1, 'seq').pages.length === 0)
const withoutLep = seedLedger(miniManual(['I', 'II']), summaries(bookLeaves))
check('no LEP rows: every leaf still gets a page (as before)', withoutLep.leaves.every((leaf) => leaf.pages.length >= 1))

// Decision 7: a lep_start set later places the leaf from its start on the next read.
const onDisk = JSON.parse(JSON.stringify(copiedLedger)) as BookLedger
const later = (start: string) =>
  parseLedger(onDisk, seedLedger(miniManual(assigned.copied), summaries(bookLeaves.map((leaf) => (leaf.id === 'toc' ? { ...leaf, lep_start: start } : leaf)))))
const atX = later('X')
check('later start X: TOC takes X from the intro', ledgerLeafOf(atX, 'toc').pages.map((p) => p.slot).join(' ') === 'X' && ledgerLeafOf(atX, 'intro').pages.map((p) => p.slot).join(' ') === 'V')
check('later start X: TOC is roman-front', ledgerLeafOf(atX, 'toc').scheme === 'roman-front')
const atVIII = later('VIII')
check('later start VIII: TOC starts at its own slot', ledgerLeafOf(atVIII, 'toc').pages.map((p) => p.slot).join(' ') === 'VIII X')
const xSlots = effectivePages(atVIII).map((p) => p.slot)
check('later start: still no slot twice', new Set(xSlots).size === xSlots.length)
check('later start: other unpaginated leaves stay so', ledgerLeafOf(atX, 'lep').pages.length === 0 && ledgerLeafOf(atX, 'bulletin').pages.length === 0)
check('no start set: read is unchanged', JSON.stringify(parseLedger(onDisk, copiedLedger).leaves.map((l) => l.pages)) === JSON.stringify(copiedLedger.leaves.map((l) => l.pages)))

// Render: an unpaginated leaf between two paginated ones keeps everyone's footers right.
const renderDir = mkdtempSync(path.join(tmpdir(), 'revdesk-ledger-unpaged-'))
try {
  const sections = path.join(renderDir, 'manuals', 'mini', 'sections')
  mkdirSync(sections, { recursive: true })
  writeFileSync(
    path.join(renderDir, 'manuals', 'mini', 'manual.yaml'),
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
  lep_inferred: false
  regions:
    - name: body
      scheme: chapter-page
lep_slots:
  - 1-1
  - 1-2
  - 2-1
`,
  )
  const long = Array.from({ length: 70 }, (_, i) => `Paragraph ${i + 1}. ${'lorem '.repeat(40).trim()}.`).join('\n\n')
  const leaf = (file: string, id: string, title: string, start: string | null, body: string) =>
    writeFileSync(
      path.join(sections, file),
      `---\nid: ${id}\ntitle: ${title}\nrev_last_changed: R1\n${start ? `lep_start: ${start}\n` : ''}---\n\n# ${title}\n\n${body}\n`,
    )
  leaf('100-one.md', 'mini-1', 'Section 1 — Policy', '1-1', long)
  leaf('150-notice.md', 'mini-notice', 'Notice', null, long)
  leaf('200-two.md', 'mini-2', 'Section 2 — Ops', '2-1', 'Short.')
  leaf('900-lep.md', 'mini-lep', 'List of Effective Pages', null, 'Automatically managed.')
  const repo = new Repo(renderDir)
  const rows: LepSourceRow[] = [row('1-1', 1, null), row('1-2', 1, null), row('2-1', 0, null)]
  repo.writeLedger('mini', seedLedger(repo.readManual('mini'), repo.listSections('mini'), { lep: rows }))
  const pdf = await renderIssuedPdf(repo.issuedBook('mini'), { kind: 'regulator' }, {
    persistLedger: (ledger) => repo.writeLedger('mini', ledger),
    rehydrate: () => repo.issuedBook('mini'),
  })
  const file = path.join(renderDir, 'out.pdf')
  writeFileSync(file, pdf.bytes)
  const pageCount = Number(execFileSync(toolPath('qpdf'), ['--show-npages', file], { encoding: 'utf8' }).trim())
  const footers: string[] = []
  const owners: string[] = []
  for (let page = 1; page <= pageCount; page += 1) {
    const text = execFileSync(toolPath('pdftotext'), ['-f', String(page), '-l', String(page), file, '-'], { encoding: 'utf8' })
    footers.push(text.split('\n').map((line) => line.trim()).filter((line) => line.endsWith('· MINI')).at(-1) ?? '')
    const head = text.match(/(mini-[a-z0-9]+)\s*·\s*rev last changed/)?.[1]
    owners.push(head ?? owners.at(-1) ?? '')
  }
  const of = (id: string) => footers.filter((_, i) => owners[i] === id)
  check('render: notice spans pages', of('mini-notice').length >= 2, footers.join(' | '))
  check('render: section 1 footers carry its slots', of('mini-1')[0]?.startsWith('1-1 · R1') && of('mini-1').every((f) => /^1-\d+/.test(f)), of('mini-1').join(' | '))
  check('render: unpaginated leaf has the fallback footer', of('mini-notice').every((f) => f === 'R1 · MINI'), of('mini-notice').join(' | '))
  check('render: section 2 after it keeps its own slot', of('mini-2')[0] === '2-1 · Original · MINI', of('mini-2').join(' | '))
  const after = repo.readLedger('mini')
  check('render: unpaginated leaf still has no slot', ledgerLeafOf(after, 'mini-notice').pages.length === 0)
  check('render: LEP leaf stays unpaginated', ledgerLeafOf(after, 'mini-lep').pages.length === 0)
  const lepPaper = repo.issuedSection('mini', 'mini-lep').markdown
  const listed = lepPaper.split('\n').filter((line) => /^\| \d+-\d+/.test(line)).map((line) => line.split('|')[1].trim())
  check('render: hydrated LEP lists each slot once', new Set(listed).size === listed.length && listed.includes('2-1') && listed.includes('1-1'), listed.join(' '))
  check('render: hydrated LEP prints Original', lepPaper.includes('| 2-1 | Original |'))
} catch (error) {
  failed += 1
  console.error(`FAIL unpaginated render — ${error instanceof Error ? error.message : error}`)
} finally {
  rmSync(renderDir, { recursive: true, force: true })
}

if (failed) {
  console.error(`${failed} failed`)
  process.exit(1)
}
console.log('ledger ok')
