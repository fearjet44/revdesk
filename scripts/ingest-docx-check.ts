// T2.2: .docx import — fixture book, model-level rules, completeness gate.
// The fixture is the sanitized Foo Bar Air practice book. Only titles and short labels are quoted here.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse as parseYaml } from 'yaml'
import { parseBody, splitFrontmatter, type JSONContent } from '../src/schema/markdown.ts'
import { applyIngest, classifySource } from '../server/ingest.ts'
import { roundTrips, walkDocx, type DocxLeaf, type DocxNode } from '../server/ingest/docx.ts'
import type { ImportReport } from '../server/ingest/report.ts'
import { RepoError } from '../server/repo.ts'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const FIXTURE = path.join(ROOT, 'fixtures', 'ingest', 'samples', 'foobar-gom-practice.docx')
let failed = 0

function check(label: string, ok: boolean, detail?: string) {
  if (ok) console.log(`ok ${label}`)
  else {
    failed += 1
    console.error(`FAIL ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

function listing(root: string): string[] {
  if (!existsSync(root)) return []
  return readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(entry.parentPath, entry.name))
    .sort()
}

function nodes(doc: JSONContent, type: string): JSONContent[] {
  const out: JSONContent[] = []
  const visit = (node: JSONContent) => {
    if (node.type === type) out.push(node)
    node.content?.forEach(visit)
  }
  visit(doc)
  return out
}

function text(node: JSONContent): string {
  if (node.type === 'text') return node.text ?? ''
  return (node.content ?? []).map(text).join(' ')
}

/** Deepest list nesting in a doc (1 = a flat list). */
function listDepth(node: JSONContent, depth = 0): number {
  const here = node.type === 'orderedList' || node.type === 'bulletList' ? depth + 1 : depth
  return Math.max(here, ...(node.content ?? []).map((child) => listDepth(child, here)))
}

async function expectRefusal(label: string, run: () => Promise<unknown>, status: number, text: string) {
  try {
    await run()
    check(label, false, 'did not refuse')
  } catch (error) {
    check(
      label,
      error instanceof RepoError && error.status === status && error.message.includes(text),
      error instanceof Error ? `${(error as RepoError).status} ${error.message}` : String(error),
    )
  }
}

/* ---------- 1. The fixture book ---------- */

// Read from the fixture by hand (paragraph dump of the .docx), not from the importer's output.
// [kind, number, frontmatter title, lep_start, managed]
const EXPECTED: Array<[string, string | null, string, string, string | null]> = [
  ['front', null, 'Cover', 'a', null],
  ['front', null, 'TABLE OF BULLETINS (TOB)', 'I', null],
  ['front', null, 'GOM BULLETIN No. 1', '', null],
  ['front', null, 'TRANSMITTAL SHEET', '', null],
  ['front', null, 'REVISION ACKNOWLEDGMENT', 'III', null],
  ['front', null, 'ADMINISTRATION', 'IV', null],
  ['front', null, 'INTRODUCTION', 'V', null],
  ['front', null, 'Table of Contents', '', 'toc'],
  ['front', null, 'LIST OF EFFECTIVE PAGES', '', 'lep'],
  ['front', null, 'RECORD OF REVISIONS', 'XIV', 'ror'],
  ['front', null, 'GOM ADMINISTRATION', 'XVI', null],
  ['section', 'A', 'Section A — MANAGEMENT AND OTHER KEY PERSONNEL', 'A-1', null],
  ['section', 'E-I', 'Section E-I — AIRCRAFT AIRWORTHINESS', 'E-I-1', null],
  ['section', 'P', 'Section P — COMPANY POLICY AND PROCEDURES INSTRUCTIONS', 'P-1', null],
  ['appendix', 'C', 'Appendix C — STANDARD COMPANY FORMS', 'AC-1', null],
  ['appendix', 'D', 'Appendix D — COMPANY CONTROLLED EFB REQUIREMENTS AND USE', 'AD-1', null],
]
const BODY_IDS = ['gom-a', 'gom-e-i', 'gom-p', 'gom-c', 'gom-d']

const lib = mkdtempSync(path.join(tmpdir(), 'revdesk-docx-'))
try {
  const classified = await classifySource(FIXTURE)
  check('classify: LEP book', classified.control_surface === 'lep')
  const bodySections = classified.sections.filter((s) => s.kind !== 'front').map((s) => `${s.number}@${s.start}`)
  check(
    'classify: lettered sections and appendices from the TOC',
    JSON.stringify(bodySections) === JSON.stringify(['A@A-1', 'E-I@E-I-1', 'P@P-1', 'C@AC-1', 'D@AD-1']),
    bodySections.join(' '),
  )

  const result = await applyIngest({ file: FIXTURE }, lib)
  const report = result.report as ImportReport
  check('source result says source', result.bodies === 'source' && !result.matched_gold)
  check('report returned', Boolean(report))

  const sectionDir = path.join(lib, 'manuals', result.id, 'sections')
  const files = readdirSync(sectionDir).sort()
  const leaves = files.map((file) => {
    const markdown = readFileSync(path.join(sectionDir, file), 'utf8')
    const { meta, body } = splitFrontmatter(markdown)
    return { file, markdown, meta, body, doc: parseBody(body) }
  })
  const got = leaves.map((l) => [l.meta.title, l.meta.lep_start ?? '', l.meta.managed ?? null])
  const want = EXPECTED.map(([, , title, start, managed]) => [title, start, managed])
  check('leaves in order with lep_start and managed kind', JSON.stringify(got) === JSON.stringify(want), JSON.stringify(got))
  const byId = new Map(leaves.map((l) => [l.meta.id, l]))
  check('body leaf ids', BODY_IDS.every((id) => byId.has(id)), [...byId.keys()].join(' '))
  check(
    'body page-label prefixes as printed',
    BODY_IDS.map((id) => byId.get(id)?.meta.lep_start?.replace(/-\d+$/, '')).join(',') === 'A,E-I,P,AC,AD',
  )

  const manual = parseYaml(readFileSync(path.join(lib, 'manuals', result.id, 'manual.yaml'), 'utf8'))
  const regions = manual.pagination.regions as Array<{ name: string; scheme: string; slots?: string[] }>
  check('pagination: lep surface', manual.pagination.control_surface === 'lep')
  check(
    'pagination: letter-cover a, b',
    JSON.stringify(regions.find((r) => r.scheme === 'letter-cover')?.slots) === JSON.stringify(['a', 'b']),
  )
  const roman = regions.find((r) => r.scheme === 'roman-front')?.slots ?? []
  check('pagination: roman-front upper-case as printed', roman[0] === 'I' && roman.includes('XIX') && roman.every((s) => s === s.toUpperCase()))
  check('pagination: section-page body', regions.some((r) => r.name === 'body' && r.scheme === 'section-page'))
  check('effective date from the cover', manual.effective === '2025-12-31' && manual.current_issued === 'GOM-R1')

  for (const l of leaves.filter((leaf) => leaf.meta.managed)) {
    check(`managed ${l.meta.managed} has an empty body`, l.body.trim() === '', l.file)
  }
  check('report lists managed leaves as regenerated', report.managed.length === 3 && report.managed.every((m) => m.note === 'managed, regenerated'))
  check(
    'report lists bulletins as front matter',
    report.bulletins.map((b) => b.title).join('|') === 'TABLE OF BULLETINS (TOB)|GOM BULLETIN No. 1' &&
      report.bulletins.every((b) => b.note === 'bulletin, kept as front matter'),
  )

  const docs = leaves.filter((l) => !l.meta.managed).map((l) => l.doc)
  const headingLevels = new Set(docs.flatMap((doc) => nodes(doc, 'heading').map((h) => Number(h.attrs?.level))))
  check('headings at H2 and H3', headingLevels.has(2) && headingLevels.has(3), [...headingLevels].join(','))
  check('H2 from the book’s own TOC', nodes(byId.get('gom-e-i')!.doc, 'heading').some((h) => h.attrs?.level === 2 && text(h) === 'E1 AIRPLANE AIRWORTHINESS'))

  const figures = BODY_IDS.flatMap((id) => nodes(byId.get(id)!.doc, 'figure'))
  check('5 figures in body leaves (org chart + 4 forms)', figures.length === 5, String(figures.length))
  check('figure files written', figures.every((f) => existsSync(path.join(lib, 'manuals', result.id, String(f.attrs?.src)))))
  check('org chart in Section A', nodes(byId.get('gom-a')!.doc, 'figure').length === 1)
  check('4 forms in Appendix C', nodes(byId.get('gom-c')!.doc, 'figure').length === 4)
  check('figure in the LEP is reported, not kept', report.managed.find((m) => m.managed === 'lep')?.figures === 1)

  const all = docs.flatMap((doc) => [doc])
  check('NOTE callouts', all.some((doc) => nodes(doc, 'note').length > 0))
  check('CAUTION callouts', all.some((doc) => nodes(doc, 'caution').length > 0))
  check('no WARNING invented', all.every((doc) => nodes(doc, 'warning').length === 0))
  check('callout labels stripped', all.every((doc) => [...nodes(doc, 'note'), ...nodes(doc, 'caution')].every((c) => !/^(note|caution)\b/i.test(text(c).trim()))))

  check('nested steps at least 3 deep in E thru I', listDepth(byId.get('gom-e-i')!.doc) >= 3, String(listDepth(byId.get('gom-e-i')!.doc)))
  const pDepth = listDepth(byId.get('gom-p')!.doc)
  check('typed (a.)/(i.) items nest under Word steps in P', pDepth >= 4, String(pDepth))
  const items = BODY_IDS.flatMap((id) => nodes(byId.get(id)!.doc, 'listItem').map((item) => text(item.content![0]).trim()))
  check('typed (a.)/(i.) numbers stripped from steps', items.length > 0 && !items.some((t) => /^\((?:[a-z]|[ivx]+)\.\)/.test(t)))

  const merged = report.flattened_cells.by_leaf['gom-p'] ?? 0
  check('merged table cell counted as flattened (P-19)', merged >= 1, String(merged))

  check('coverage meets the gate', report.passed && report.coverage.overall >= 0.98, String(report.coverage.overall))
  check('every leaf meets the gate', report.leaves.every((leaf) => leaf.coverage === null || leaf.coverage >= 0.95))
  check('blank-page marker dropped and listed', report.dropped_lines.some((d) => d.text === 'Intentionally Left Blank' && d.reason === 'blank-page'))
  check('no other kind of line dropped', report.dropped_lines.every((d) => ['blank-page', 'page-label', 'revision-footer'].includes(d.reason)))
  check('repeated lines listed, not dropped', Array.isArray(report.repeated_lines))

  const running = /^(Intentionally Left Blank|\d+-\d+|[A-Z]{1,2}(-[A-Z])?-\d+|[ivxlc]+|Page \d+( of \d+)?)$/i
  // Block paragraphs only: table cells legitimately hold page numbers (the bulletin's corrections table).
  const paragraphs = docs.flatMap((doc) => (doc.content ?? []).filter((n) => n.type === 'paragraph').map((p) => text(p).trim()))
  check('no running heads or page labels in any leaf', !paragraphs.some((p) => running.test(p) || /Revision:?\s+\S+.*Page:?\s*\S+$/.test(p)))
  check('LEP row E-1-2 reported, not fixed', report.lep.unmatched_rows.includes('E-1-2'))
  check('LEP typo not copied into the manual', !JSON.stringify(manual).includes('E-1-2'))

  for (const l of leaves.filter((leaf) => leaf.body.trim())) {
    if (!roundTrips(l.doc)) check(`round trip ${l.file}`, false)
  }
  check('every written leaf round-trips', true)

  // Honest baseline.
  const issue = parseYaml(readFileSync(path.join(lib, 'control', 'issues', 'GOM-R1.yaml'), 'utf8'))
  const sha = createHash('sha256').update(readFileSync(FIXTURE)).digest('hex')
  check('baseline instrument not on file', issue.instrument.type === 'not-on-file' && issue.instrument.file === null && issue.instrument.sha256 === null)
  check('baseline instrument reference names the source', String(issue.instrument.reference).includes('foobar-gom-practice.docx'))
  check('baseline keeps the source file with its real sha256', issue.manual_artifact.sha256 === sha && existsSync(path.join(lib, issue.manual_artifact.file)))
  check('no sample instrument written', !existsSync(path.join(lib, 'control', 'instruments')))
  check('report written to the library', existsSync(path.join(lib, 'control', 'ingest', 'gom.yaml')))
  const cli = (...args: string[]) =>
    execFileSync(process.execPath, ['--experimental-strip-types', path.join(ROOT, 'cli', 'revdesk.ts'), ...args], {
      env: { ...process.env, REVDESK_DATA: lib },
      encoding: 'utf8',
    })
  check('revdesk launched prints the baseline', cli('launched', 'gom').includes('GOM-R1  launched'))
  check('revdesk issue show prints the baseline', cli('issue', 'show', 'GOM-R1').includes('instrument not-on-file'))

  const before = listing(lib)
  await expectRefusal('second import without replace', () => applyIngest({ file: FIXTURE }, lib), 4, 'already in this library')
  check('second import wrote nothing', JSON.stringify(listing(lib)) === JSON.stringify(before))
  await applyIngest({ file: FIXTURE, replace: true }, lib)
  check('replace brings it in again', readdirSync(sectionDir).length === files.length)
} finally {
  rmSync(lib, { recursive: true, force: true })
}

/* ---------- 2. Completeness gate ---------- */

const gateLib = mkdtempSync(path.join(tmpdir(), 'revdesk-docx-gate-'))
try {
  const drop = (leaves: DocxLeaf[]) => {
    const leaf = leaves.find((l) => l.kind === 'section' && l.number === 'A')!
    // Section A's largest block goes missing from the output (never one that would join two
    // lists around it, which fails the round trip instead of the gate).
    const content = leaf.doc.content!
    const lists = new Set(['orderedList', 'bulletList'])
    let longest = -1
    content.forEach((node, i) => {
      if (i === 0) return
      if (lists.has(content[i - 1]?.type ?? '') && content[i - 1]?.type === content[i + 1]?.type) return
      if (longest === -1 || text(node).length > text(content[longest]).length) longest = i
    })
    content.splice(longest, 1)
  }
  const before = listing(gateLib)
  await expectRefusal('gate refuses a lost paragraph and names the leaf', () => applyIngest({ file: FIXTURE, beforeReport: drop }, gateLib), 2, 'gom-a')
  check('gate wrote nothing', JSON.stringify(listing(gateLib)) === JSON.stringify(before))
  const accepted = await applyIngest({ file: FIXTURE, beforeReport: drop, accept_gaps: true }, gateLib)
  check('accept_gaps lets it through', accepted.report?.passed === false && accepted.report.accepted_gaps === true)
  const leafA = accepted.report?.leaves.find((l) => l.id === 'gom-a')
  check('gap shows as unmatched snippets', Boolean(leafA && leafA.coverage! < 0.95 && leafA.unmatched.length > 0))
} finally {
  rmSync(gateLib, { recursive: true, force: true })
}

/* ---------- 3. Model-level rules (hand-built mammoth-shaped documents) ---------- */

type POpts = { style?: string; bold?: boolean; size?: number; num?: [number, boolean] }
const run = (value: string, o: { bold?: boolean; italic?: boolean; size?: number } = {}): DocxNode => ({
  type: 'run',
  isBold: o.bold,
  isItalic: o.italic,
  fontSize: o.size ?? 10,
  children: value.split('\n').flatMap((part, i) => [...(i ? [{ type: 'break' }] : []), { type: 'text', value: part }]),
})
const P = (value: string, o: POpts = {}): DocxNode => ({
  type: 'paragraph',
  styleName: o.style ?? null,
  numbering: o.num ? { level: String(o.num[0]), isOrdered: o.num[1] } : null,
  children: [run(value, { bold: o.bold, size: o.size })],
})
const cell = (children: DocxNode[], span: { colSpan?: number; rowSpan?: number } = {}): DocxNode => ({ type: 'tableCell', children, ...span })
const T = (rows: DocxNode[][]): DocxNode => ({ type: 'table', children: rows.map((cells) => ({ type: 'tableRow', children: cells })) })
const book = (...children: DocxNode[]): DocxNode => ({ type: 'document', children: [P('Section 1: General', { style: 'Heading 1' }), ...children] })
const walkOne = async (...children: DocxNode[]) => {
  const walk = await walkDocx(book(...children))
  return { walk, leaf: walk.leaves[walk.leaves.length - 1] }
}
const blockTypes = (doc: JSONContent) => (doc.content ?? []).map((n) => (n.type === 'heading' ? `h${n.attrs?.level}` : n.type))

{
  const { walk, leaf } = await walkOne(P('Scope', { style: 'Heading 2' }), P('Detail', { style: 'Heading 3' }), P('Body text.'))
  check('model: one section leaf from "Section 1:"', walk.leaves.length === 1 && leaf.kind === 'section' && leaf.number === '1')
  check('model: style headings', JSON.stringify(blockTypes(leaf.doc)) === JSON.stringify(['h1', 'h2', 'h3', 'paragraph']))
  check('model: H1 is the leaf title line', text(leaf.doc.content![0]) === 'Section 1: General')
}
{
  const { leaf } = await walkOne(
    P('1.2 Bold head', { bold: true }),
    P('1.3 Plain numbered line'),
    P('1.4 Bigger head', { size: 14 }),
    P('1.1.0 Nimbl head', { bold: true }),
    P('1.2.3 Deep head', { bold: true }),
    P('Bold alone is not a heading', { bold: true }),
  )
  check(
    'model: numbered headings (bold yes, plain no, size yes, 1.1.0 → H2, 1.2.3 → H3, bold alone no)',
    JSON.stringify(blockTypes(leaf.doc)) === JSON.stringify(['h1', 'h2', 'paragraph', 'h2', 'h2', 'h3', 'paragraph']),
    blockTypes(leaf.doc).join(','),
  )
}
{
  const { leaf } = await walkOne(
    P('NOTE: Check the log.'),
    P('Caution: Hot brakes.'),
    P('WARNING\nProps turning.'),
    P('Styled note text.', { style: 'Note' }),
    P('NOTE'),
    P('Label on its own line above.'),
  )
  check('model: NOTE/CAUTION/WARNING/style callouts', JSON.stringify(blockTypes(leaf.doc)) === JSON.stringify(['h1', 'note', 'caution', 'warning', 'note', 'note']))
  check('model: callout labels stripped', text(leaf.doc.content![1]).trim() === 'Check the log.' && text(leaf.doc.content![3]).trim() === 'Props turning.')
  check('model: label-only NOTE takes the next paragraph', text(leaf.doc.content![5]).trim() === 'Label on its own line above.')
}
{
  const { leaf } = await walkOne(
    P('Step one', { num: [0, true] }),
    P('Sub a', { num: [1, true] }),
    P('Sub sub', { num: [2, true] }),
    P('Bullet under sub a', { num: [2, false] }),
    P('Step two', { num: [0, true] }),
  )
  const list = leaf.doc.content![1]
  check('model: Word numbering nests as steps', list.type === 'orderedList' && listDepth(leaf.doc) === 3)
  const subA = list.content![0].content![1].content![0]
  check('model: bullets nest beside steps', subA.content!.slice(1).map((n) => n.type).join(',') === 'orderedList,bulletList')
  check('model: list round-trips', roundTrips(leaf.doc))
}
{
  const { leaf } = await walkOne(
    P('Do this:', { num: [0, true] }),
    P('(a.) first typed'),
    P('(b.) second typed'),
    P('(i.) roman under b'),
    P('Text between.'),
    P('1.) lone typed number stays text'),
    P('Text after.'),
    P('• typed bullet'),
  )
  check('model: typed (a.)/(i.) runs become nested steps', listDepth(leaf.doc) === 3, String(listDepth(leaf.doc)))
  const paras = nodes(leaf.doc, 'paragraph').map((p) => text(p).trim())
  check('model: typed markers stripped', paras.includes('first typed') && paras.includes('roman under b'))
  check('model: a lone typed number stays a paragraph', paras.includes('1.) lone typed number stays text'))
  check('model: typed bullet becomes a bullet', nodes(leaf.doc, 'bulletList').length === 1)
}
{
  const { walk, leaf } = await walkOne(
    T([[cell([P('Inside a layout box.')])]]),
    T([[cell([P('NOTE: Boxed note.')])]]),
    T([
      [cell([P('H1')]), cell([P('H2')]), cell([P('H3')])],
      [cell([P('wide')], { colSpan: 2 }), cell([P('tall')], { rowSpan: 2 })],
      [cell([P('x')]), cell([P('two'), P('paragraphs')])],
    ]),
  )
  check('model: single-cell layout table unwrapped', blockTypes(leaf.doc)[1] === 'paragraph' && text(leaf.doc.content![1]) === 'Inside a layout box.')
  check('model: single-cell callout table', blockTypes(leaf.doc)[2] === 'note' && text(leaf.doc.content![2]).trim() === 'Boxed note.')
  const table = leaf.doc.content![3]
  const rows = table.content!.map((row) => row.content!.map((c) => text(c).trim()))
  check(
    'model: merged cells repeat their text',
    JSON.stringify(rows) === JSON.stringify([['H1', 'H2', 'H3'], ['wide', 'wide', 'tall'], ['x', 'two paragraphs', 'tall']]),
    JSON.stringify(rows),
  )
  check('model: merged and multi-paragraph cells counted as flattened', leaf.flattened === 3, String(leaf.flattened))
  check('model: table round-trips', roundTrips(leaf.doc) && walk.leaves.length === 1)
}
{
  const head = 'FOO BAR AIR GENERAL OPERATIONS MANUAL'
  const sentence = 'Check the aircraft log before each flight.'
  const lead = 'The PIC shall:'
  const long = 'A long line that repeats verbatim three times but is longer than eighty characters, so it is never listed.'
  const { walk, leaf } = await walkOne(
    P(head), P(sentence), P(lead), P('A-12'), P(long), P('— Intentionally left blank —'),
    P(head), P(sentence), P(lead), P('iv'), P(long), P('INTENTIONALLY LEFT BLANK'),
    P(head), P(sentence), P(lead), P('Revision 3 01-Jan-2026'), P(long),
    T([[cell([P('A-12')]), cell([P('kept in a table')])], [cell([P('x')]), cell([P('y')])]]),
  )
  const blocks = (leaf.doc.content ?? []).filter((p) => p.type === 'paragraph').map((p) => text(p))
  const all = nodes(leaf.doc, 'text').map((n) => n.text).join(' ')
  check('model: a repeated short line is kept', blocks.filter((t) => t === head).length === 3)
  check('model: a repeated sentence is kept', blocks.filter((t) => t === sentence).length === 3)
  check('model: a repeated line ending in ":" is kept', blocks.filter((t) => t === lead).length === 3)
  check('model: a long repeated line is kept', blocks.filter((t) => t === long).length === 3)
  check('model: page labels and revision footers dropped', !blocks.some((t) => /^(A-12|iv)$|Revision 3/.test(t)))
  check('model: blank-page marker dropped', !/intentionally left blank/i.test(all))
  check('model: page label inside a table kept', all.includes('A-12'))
  const reasons = Object.fromEntries(walk.dropped.map((d) => [d.text, `${d.reason}:${d.count}`]))
  check(
    'model: dropped lines reported with reason and count',
    reasons['— Intentionally left blank —'] === 'blank-page:1' &&
      reasons['INTENTIONALLY LEFT BLANK'] === 'blank-page:1' &&
      reasons['A-12'] === 'page-label:1' &&
      reasons['Revision 3 01-Jan-2026'] === 'revision-footer:1' &&
      walk.dropped.length === 5,
    JSON.stringify(reasons),
  )
  const repeated = Object.fromEntries(walk.repeated_lines.map((r) => [r.text, r.count]))
  check(
    'model: short repeated lines listed, not dropped',
    repeated[head] === 3 && repeated[sentence] === 3 && repeated[lead] === 3 && !(long in repeated),
    JSON.stringify(repeated),
  )
}
{
  const { leaf } = await walkOne(P('1. Looks like a step but is one paragraph'), P('Stars * and *more* stay text'), P('a | b'))
  check('model: text that looks like Markdown still round-trips', roundTrips(leaf.doc))
  check('model: no words lost to Markdown syntax', nodes(leaf.doc, 'paragraph').length === 3)
}

if (failed) {
  console.error(`ingest-docx-check: ${failed} failed`)
  process.exit(1)
}
console.log('ingest-docx-check passed')
