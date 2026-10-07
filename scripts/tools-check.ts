import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { createApiHandler } from '../server/plugin.ts'
import { doctor, installHint, readLibraryText, toolPath, type ToolName } from '../server/tools.ts'
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

  const report = doctor()
  check('doctor.platform is process.platform', report.platform === process.platform, report.platform)
  check('every tool has install key', report.tools.every((tool) => 'install' in tool))
  const platforms: NodeJS.Platform[] = ['darwin', 'win32', 'linux']
  const names6 = report.tools.map((tool) => tool.name as ToolName)
  for (const platform of platforms) {
    for (const name of names6) {
      const line = installHint(name, platform)
      const documentedNull = platform === 'win32' && name === 'chrome'
      check(
        `installHint(${name}, ${platform})`,
        documentedNull ? line === null : typeof line === 'string' && line.length > 0,
        String(line),
      )
    }
  }
  check('installHint win32 qpdf', installHint('qpdf', 'win32') === 'winget install QPDF.QPDF')
  check('installHint win32 poppler', installHint('pdftotext', 'win32') === 'winget install oschwartz10612.Poppler')
  check('installHint darwin qpdf', installHint('qpdf', 'darwin') === 'brew install qpdf')
  check('installHint linux poppler', installHint('pdfinfo', 'linux') === 'sudo apt install poppler-utils')

  const savedData = process.env.REVDESK_DATA
  process.env.REVDESK_DATA = path.join(dir, 'no-such-library')
  const handler = createApiHandler(dir)
  const server = createServer((req, res) => {
    void handler(req, res).then((handled) => {
      if (!handled) res.statusCode = 404
      if (!res.writableEnded) res.end()
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const port = (server.address() as AddressInfo).port
    const response = await fetch(`http://127.0.0.1:${port}/api/doctor`)
    const body = (await response.json()) as { tools?: unknown[]; platform?: string }
    check('GET /api/doctor without a library', response.status === 200 && body.tools?.length === 6, String(response.status))
    check('GET /api/doctor platform', body.platform === process.platform)
  } finally {
    server.close()
    if (savedData === undefined) delete process.env.REVDESK_DATA
    else process.env.REVDESK_DATA = savedData
  }
} finally {
  rmSync(dir, { recursive: true, force: true })
}

if (failed) process.exit(1)
console.log('tools checks passed')
