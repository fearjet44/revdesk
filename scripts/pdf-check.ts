import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  buildManualHtml,
  pdfFilename,
  referenceWatermark,
  renderIssuedPdf,
  type IssuedBook,
} from '../server/print.ts'
import { DEFAULT_THEME } from '../server/theme.ts'

let failed = 0

function check(label: string, ok: boolean, detail?: string) {
  if (ok) console.log(`ok ${label}`)
  else {
    failed += 1
    console.error(`FAIL ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

const stamp = referenceWatermark(new Date(Date.UTC(2026, 8, 5, 18, 32, 0)))
check(
  'watermark text',
  stamp === 'Reference Only - This is not a controlled copy - Downloaded: 2026-09-05 18:32 UTC',
  stamp,
)

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
      path: 'manuals/gom/sections/000-identification.md',
      meta: { id: 'gom-ident', title: 'Identification', rev_last_changed: 'R13' },
      markdown: `---
id: gom-ident
title: Identification
rev_last_changed: R13
---

# Identification

Lorem **ipsum** for the issued leaf.

:::note
Keep this callout.
:::
`,
      body: '# Identification\n',
    },
    {
      path: 'manuals/gom/sections/010-administration.md',
      meta: { id: 'gom-admin', title: 'Administration', rev_last_changed: 'R13' },
      markdown: `---
id: gom-admin
title: Administration
rev_last_changed: R13
---

# Administration

Second leaf so the stamp can be checked on page two.
`,
      body: '# Administration\n',
    },
  ],
}

const at = new Date(Date.UTC(2026, 8, 5, 18, 32, 0))
const reference = buildManualHtml(book, { kind: 'reference', downloadedAt: at })
check('reference html has watermark', reference.html.includes(`content="${stamp}"`))
check('reference html has leaf title', reference.html.includes('Identification'))
check('reference html has callout', reference.html.includes('data-callout="note"'))
check('reference html has bold', reference.html.includes('<strong>ipsum</strong>'))
check('reference watermark returned', reference.watermark === stamp)

const regulator = buildManualHtml(book, { kind: 'regulator', downloadedAt: at })
check('regulator html has no watermark banner', !regulator.html.includes('revdesk-watermark'))
check('regulator html has no downloaded stamp', !regulator.html.includes('Downloaded:'))
check('regulator watermark null', regulator.watermark === null)
check('regulator cover says of-record', regulator.html.includes('Of-record PDF for regulator signature'))
check('reference filename', pdfFilename(book.manual, 'reference') === 'GOM-R13-reference.pdf')
check('regulator filename', pdfFilename(book.manual, 'regulator') === 'GOM-R13.pdf')

try {
  const rendered = await renderIssuedPdf(book, { kind: 'reference', downloadedAt: at })
  check('reference pdf bytes', rendered.bytes.slice(0, 4).toString() === '%PDF')
  const dir = mkdtempSync(path.join(tmpdir(), 'revdesk-pdf-check-'))
  const file = path.join(dir, 'ref.pdf')
  writeFileSync(file, rendered.bytes)
  const text = execFileSync('pdftotext', ['-f', '1', '-l', '1', file, '-'], { encoding: 'utf8' })
  const page2 = execFileSync('pdftotext', ['-f', '2', '-l', '2', file, '-'], { encoding: 'utf8' })
  check('reference pdf text has watermark', text.includes('Reference Only - This is not a controlled copy'))
  check('reference pdf text has download time', text.includes('Downloaded: 2026-09-05 18:32 UTC'))
  check('reference pdf text has section', text.includes('Identification'))
  check('watermark repeats on later pages', page2.includes('This is not a controlled copy'))
  check('page two is the next leaf', page2.includes('Administration'))

  const regulatorPdf = await renderIssuedPdf(book, { kind: 'regulator', downloadedAt: at })
  const regFile = path.join(dir, 'reg.pdf')
  writeFileSync(regFile, regulatorPdf.bytes)
  const regText = execFileSync('pdftotext', [regFile, '-'], { encoding: 'utf8' })
  check('regulator pdf has no reference stamp', !regText.includes('This is not a controlled copy'))
  check('regulator pdf is of-record', /of-record/i.test(regText))
} catch (error) {
  failed += 1
  console.error(`FAIL chromium pdf — ${error instanceof Error ? error.message : error}`)
}

if (failed) {
  console.error(`\n${failed} failed`)
  process.exit(1)
}
console.log('\nok pdf-check')
