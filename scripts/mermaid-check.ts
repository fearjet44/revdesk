import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { parseBody, parseSection, serializeBody, serializeSection, withFrontmatter } from '../src/schema/markdown.ts'
import { DEFAULT_MERMAID } from '../src/schema/mermaid.ts'
import { buildManualHtml, renderIssuedPdf, type IssuedBook } from '../server/print.ts'
import { DEFAULT_THEME } from '../server/theme.ts'

let failed = 0

function check(label: string, ok: boolean, detail?: string) {
  if (ok) console.log(`ok ${label}`)
  else {
    failed += 1
    console.error(`FAIL ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

const fence = `\`\`\`mermaid\n${DEFAULT_MERMAID}\n\`\`\`\n`
const raw = withFrontmatter({ id: 'gom-oc', title: 'Operational Control', rev_last_changed: 'R13' }, fence)
const { meta, doc } = parseSection(raw)
const again = serializeSection(meta, doc)
const { doc: doc2 } = parseSection(again)
check('roundtrip mermaid node', doc.content?.[0]?.type === 'mermaid', doc.content?.[0]?.type)
check('roundtrip source', String(doc.content?.[0]?.attrs?.source) === DEFAULT_MERMAID, String(doc.content?.[0]?.attrs?.source))
check('roundtrip serialize fence', again.includes('```mermaid') && again.includes('PIC[PIC]'))
check('roundtrip stable', JSON.stringify(doc) === JSON.stringify(doc2))

const unknown = parseBody('```js\nconsole.log(1)\n```\n')
check('other fences stay paragraphs', unknown.content?.[0]?.type === 'paragraph', unknown.content?.[0]?.type)

const nested = parseBody([':::note', '```mermaid', 'flowchart TD', '  A --> B', '```', ':::', ''].join('\n'))
check('mermaid inside callout', nested.content?.[0]?.type === 'note' && nested.content?.[0]?.content?.[0]?.type === 'mermaid')
check(
  'callout mermaid serializes',
  serializeBody(nested).includes(':::note') && serializeBody(nested).includes('```mermaid'),
)

const unclosed = parseBody(['```mermaid', 'flowchart TD', '  A --> B', ''].join('\n'))
check('unclosed fence still a mermaid node', unclosed.content?.[0]?.type === 'mermaid')

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
      body: fence,
    },
  ],
}

const html = buildManualHtml(book, { kind: 'regulator', downloadedAt: new Date(Date.UTC(2026, 8, 12)) })
check('print html has mermaid figure', html.html.includes('class="mermaid"') && html.html.includes('PIC[PIC]'))
check('print html does not print the fence as a code block', !html.html.includes('```mermaid'))

try {
  const rendered = await renderIssuedPdf(book, { kind: 'regulator', downloadedAt: new Date(Date.UTC(2026, 8, 12)) })
  check('mermaid pdf bytes', rendered.bytes.slice(0, 4).toString() === '%PDF')
  const dir = mkdtempSync(path.join(tmpdir(), 'revdesk-mmd-'))
  const file = path.join(dir, 'mmd.pdf')
  writeFileSync(file, rendered.bytes)
  const text = execFileSync('pdftotext', [file, '-'], { encoding: 'utf8' })
  const blob = rendered.bytes.toString('latin1')
  check(
    'mermaid pdf has diagram labels',
    text.includes('PIC') && text.includes('Dispatch'),
    text.slice(0, 400),
  )
  check('mermaid pdf is not the raw fence', !text.includes('```mermaid') && !blob.includes('```mermaid'))
} catch (error) {
  failed += 1
  console.error(`FAIL mermaid pdf — ${error instanceof Error ? error.message : error}`)
}

if (failed) {
  console.error(`\n${failed} failed`)
  process.exit(1)
}
console.log('\nok mermaid-check')
