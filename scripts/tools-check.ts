import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { doctor, readLibraryText, toolPath } from '../server/tools.ts'
import { parseBody, splitFrontmatter } from '../src/schema/markdown.ts'

let failed = 0

function check(label: string, ok: boolean, detail?: string) {
  if (ok) console.log(`ok ${label}`)
  else {
    failed += 1
    console.error(`FAIL ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

const LEAF = `---
id: "1-1"
title: "General"
rev_last_changed: "R3"
---

# General

First paragraph.

- one
- two
`

const dir = mkdtempSync(path.join(tmpdir(), 'revdesk-tools-'))

try {
  const crlf = LEAF.replace(/\n/g, '\r\n')
  const file = path.join(dir, 'leaf.md')
  writeFileSync(file, `\uFEFF${crlf}`)
  const read = readLibraryText(file)
  check('readLibraryText strips BOM', !read.startsWith('\uFEFF'))
  check('readLibraryText gives LF', !read.includes('\r') && read === LEAF)

  const lf = splitFrontmatter(LEAF)
  const cr = splitFrontmatter(crlf)
  check('splitFrontmatter CRLF = LF', JSON.stringify(cr) === JSON.stringify(lf))
  check('parseBody CRLF = LF', JSON.stringify(parseBody(cr.body)) === JSON.stringify(parseBody(lf.body)))
  check(
    'parseBody raw CRLF body = LF',
    JSON.stringify(parseBody(lf.body.replace(/\n/g, '\r\n'))) === JSON.stringify(parseBody(lf.body)),
  )

  const saved = process.env.REVDESK_CHROME
  process.env.REVDESK_CHROME = '/opt/test/chrome'
  check('REVDESK_CHROME override', toolPath('chrome') === '/opt/test/chrome')
  if (saved === undefined) delete process.env.REVDESK_CHROME
  else process.env.REVDESK_CHROME = saved

  const git = spawnSync(toolPath('git'), ['--version'], { encoding: 'utf8', windowsHide: true })
  check('toolPath(git) runs', git.status === 0 && /git version/.test(git.stdout), git.error?.message)

  const names = doctor().tools.map((tool) => tool.name)
  check(
    'doctor lists six tools',
    JSON.stringify(names) === JSON.stringify(['chrome', 'qpdf', 'pdftotext', 'pdfinfo', 'pdffonts', 'git']),
    names.join(','),
  )
} finally {
  rmSync(dir, { recursive: true, force: true })
}

if (failed) process.exit(1)
console.log('tools checks passed')
