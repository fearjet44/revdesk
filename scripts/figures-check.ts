import { mkdirSync, mkdtempSync, readFileSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { figureName, figureResolver, readFigure, writeFigure } from '../server/figures.ts'
import { buildManualHtml, type IssuedBook } from '../server/print.ts'
import { DEFAULT_THEME } from '../server/theme.ts'
import { parseBody, serializeBody, withFrontmatter } from '../src/schema/markdown.ts'

let failed = 0

function check(label: string, ok: boolean, detail?: string) {
  if (ok) console.log(`ok ${label}`)
  else {
    failed += 1
    console.error(`FAIL ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)
const name = figureName(PNG, 'png')
const src = `figures/${name}`

function roundtrip(markdown: string) {
  const doc = parseBody(markdown)
  const text = serializeBody(doc)
  return { doc, text, stable: JSON.stringify(parseBody(text)) === JSON.stringify(doc) }
}

const plain = roundtrip(`![Org chart](${src})\n`)
const fig = plain.doc.content?.[0]
check('figure node', fig?.type === 'figure', fig?.type)
check('figure attrs', fig?.attrs?.src === src && fig?.attrs?.caption === 'Org chart' && fig?.attrs?.width === '100%')
check('no width hint at 100%', plain.text === `![Org chart](${src})\n`, plain.text)
check('plain stable', plain.stable)

const sized = roundtrip(`![Half](${src}){width=50%}\n`)
check('width parsed', sized.doc.content?.[0]?.attrs?.width === '50%')
check('width hint written', sized.text === `![Half](${src}){width=50%}\n`, sized.text)
check('sized stable', sized.stable)

const bracket = roundtrip(`![Chart [A\\] of B\\]](${src})\n`)
check('caption bracket unescaped', bracket.doc.content?.[0]?.attrs?.caption === 'Chart [A] of B]', String(bracket.doc.content?.[0]?.attrs?.caption))
check('caption bracket escaped on write', bracket.text.includes('Chart [A\\] of B\\]'), bracket.text)
check('bracket stable', bracket.stable)

const empty = roundtrip(`![](${src})\n`)
check('empty caption', empty.doc.content?.[0]?.type === 'figure' && empty.text === `![](${src})\n`)

for (const bad of [
  `![x](../figures/${name})`,
  `![x](figures/../${name})`,
  '![x](https://example.com/a.png)',
  `![x](figures/${name.replace('.png', '.exe')})`,
  `![x](figures/ABC123ABC123.png)`,
  `![x](/figures/${name})`,
  `![x](${src}){width=33%}`,
]) {
  check(`stays paragraph: ${bad}`, parseBody(`${bad}\n`).content?.[0]?.type === 'paragraph', bad)
}
check(
  'inline image stays text',
  parseBody(`See ![x](${src}) here\n`).content?.[0]?.type === 'paragraph',
)

const split = parseBody(`Before the picture\n![Cap](${src})\nAfter it\n`)
const kinds = (split.content ?? []).map((node) => node.type).join(',')
check('figure line ends a paragraph', kinds === 'paragraph,figure,paragraph', kinds)

check('figureName deterministic', figureName(PNG, 'png') === name && /^[0-9a-f]{12}\.png$/.test(name))
check('figureName jpeg -> jpg', figureName(PNG, 'jpeg').endsWith('.jpg'))

const root = mkdtempSync(path.join(tmpdir(), 'revdesk-fig-'))
const first = writeFigure(root, 'gom', PNG, 'png')
check('writeFigure new', first.src === src && first.existed === false, JSON.stringify(first))
const file = path.join(root, 'manuals', 'gom', 'figures', name)
const old = new Date(Date.UTC(2020, 0, 1))
utimesSync(file, old, old)
const before = statSync(file).mtimeMs
const second = writeFigure(root, 'gom', PNG, 'png')
check('writeFigure write-once', second.existed === true && statSync(file).mtimeMs === before)

const clash = path.join(root, 'manuals', 'tp', 'figures', name)
mkdirSync(path.dirname(clash), { recursive: true })
writeFileSync(clash, Buffer.from('not the same picture'))
try {
  writeFigure(root, 'tp', PNG, 'png')
  check('name clash refused', false, 'did not throw')
} catch (error) {
  check('name clash refused', (error as { status?: number }).status === 2, String(error))
}
check('name clash leaves the file alone', readFileSync(clash, 'utf8') === 'not the same picture')

for (const [label, fn] of [
  ['bad type refused', () => writeFigure(root, 'gom', PNG, 'exe')],
  ['oversize refused', () => writeFigure(root, 'gom', Buffer.alloc(10 * 1024 * 1024 + 1), 'png')],
] as const) {
  try {
    fn()
    check(label, false, 'did not throw')
  } catch (error) {
    check(label, (error as { status?: number }).status === 2, String(error))
  }
}

const read = readFigure(root, 'gom', name)
check('readFigure reads', read !== null && read.mime === 'image/png' && read.bytes.equals(PNG))
check('readFigure missing', readFigure(root, 'gom', '000000000000.png') === null)
for (const bad of ['../x.png', 'ABC.png', 'x.exe', `${name}/../${name}`]) {
  check(`readFigure refuses ${bad}`, readFigure(root, 'gom', bad) === null)
}

const body = `![Org chart & <b>](${src}){width=75%}\n`
const raw = withFrontmatter({ id: 'gom-oc', title: 'Operational Control', rev_last_changed: 'R13' }, body)
const book: IssuedBook = {
  manual: {
    id: 'gom',
    title: 'General Operations Manual',
    abbrev: 'GOM',
    control_class: 'faa-accepted',
    control: 'FAA accepted',
    owner: 'Chief Pilot',
    authority: 'poi',
    instrument_required: true,
    current_issued: 'GOM-R13',
    next_revision: 14,
    effective: '2025-12-31',
  },
  theme: DEFAULT_THEME,
  files: [
    {
      path: 'manuals/gom/sections/243-operational-control.md',
      meta: { id: 'gom-oc', title: 'Operational Control', rev_last_changed: 'R13' },
      markdown: raw,
      body,
    },
  ],
}
const at = new Date(Date.UTC(2026, 8, 12))
const withBytes = buildManualHtml(book, {
  kind: 'regulator',
  downloadedAt: at,
  figure: figureResolver(root, 'gom'),
}).html
check('print inlines data URI', withBytes.includes('data:image/png;base64,'))
check('print figure width and caption', withBytes.includes('style="width:75%"') && withBytes.includes('<figcaption>Org chart &amp; &lt;b&gt;</figcaption>'))
check('print has no missing box when found', !withBytes.includes('<div class="figure-missing">'))

const noResolver = buildManualHtml(book, { kind: 'regulator', downloadedAt: at }).html
check('print without resolver shows missing box', noResolver.includes(`Figure missing: ${name}`) && !noResolver.includes('<img'))
const nullResolver = buildManualHtml(book, { kind: 'regulator', downloadedAt: at, figure: () => null }).html
check('print with null resolver shows missing box', nullResolver.includes(`Figure missing: ${name}`) && !nullResolver.includes('<img'))

const resolve = figureResolver(root, 'gom')
const outside = 'abcdefabcdef.png'
writeFileSync(path.join(root, 'manuals', 'gom', outside), PNG)
check('resolver ignores ../ in src', resolve(`figures/../${outside}`) === null)
check('resolver ignores backslash ../ in src', resolve(`figures\\..\\${outside}`) === null)
check('resolver reads by file name', resolve(src)?.bytes.equals(PNG) === true)

const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><script>alert(1)</script></svg>')
const svg = writeFigure(root, 'gom', SVG, 'svg')
const svgBook: IssuedBook = { ...book, files: [{ ...book.files[0], body: `![](${svg.src})\n`, markdown: withFrontmatter(book.files[0].meta, `![](${svg.src})\n`) }] }
const svgHtml = buildManualHtml(svgBook, { kind: 'regulator', downloadedAt: at, figure: resolve }).html
check('print keeps SVG inside a data URI img', svgHtml.includes('<img src="data:image/svg+xml;base64,'))
check('print never inlines SVG markup', !svgHtml.includes('<script>alert') && !/<svg[\s>]/.test(svgHtml.split('<body')[1] ?? svgHtml))

if (failed) {
  console.error(`\n${failed} failed`)
  process.exit(1)
}
console.log('\nok figures-check')
