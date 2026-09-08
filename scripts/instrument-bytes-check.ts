import { createHash } from 'node:crypto'
import { cpSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Repo, RepoError } from '../server/repo.ts'

let failed = 0

function check(label: string, ok: boolean, detail?: string) {
  if (ok) console.log(`ok ${label}`)
  else {
    failed += 1
    console.error(`FAIL ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

const dir = mkdtempSync(path.join(tmpdir(), 'revdesk-instrument-'))
cpSync(path.resolve('fixtures/tiny-gom'), dir, { recursive: true })

try {
  const repo = new Repo(dir)
  const letterPath = path.join(dir, 'letters', 'poi-acceptance.txt')
  const disk = readFileSync(letterPath)
  const wantSha = createHash('sha256').update(disk).digest('hex')

  const viaPath = repo.attachInstrument('CHG-014', {
    file: letterPath,
    type: 'acceptance-letter',
    authority: 'poi',
    dated: '2026-09-01',
  })
  check('path attach sha', viaPath.instrument?.sha256 === wantSha, viaPath.instrument?.sha256)
  check('path dest under control/instruments', Boolean(viaPath.instrument?.file.startsWith('control/instruments/')))

  const viaBytes = repo.attachInstrument('CHG-014', {
    bytes: disk,
    filename: 'poi-acceptance.txt',
    type: 'acceptance-letter',
    authority: 'poi',
    dated: '2026-09-01',
  })
  check('bytes attach sha matches path', viaBytes.instrument?.sha256 === wantSha)
  check('bytes ignores directory in filename', viaBytes.instrument?.file.endsWith('.txt') === true)

  try {
    repo.attachInstrument('CHG-014', {
      bytes: Buffer.from('nope'),
      filename: 'letter.doc',
      type: 'acceptance-letter',
      authority: 'poi',
      dated: '2026-09-01',
    })
    check('rejects bad extension', false)
  } catch (error) {
    check('rejects bad extension', error instanceof RepoError && error.status === 2)
  }

  try {
    repo.attachInstrument('CHG-014', {
      bytes: Buffer.from('x'),
      filename: '../../etc/passwd.txt',
      type: 'acceptance-letter',
      authority: 'poi',
      dated: '2026-09-01',
    })
    const stored = repo.showInstrument('CHG-014')
    check('basename traversal', stored.file === 'control/instruments/CHG-014-poi.txt')
  } catch (error) {
    check('basename traversal', false, error instanceof Error ? error.message : String(error))
  }

  try {
    repo.attachInstrument('CHG-014', {
      type: 'acceptance-letter',
      authority: 'poi',
      dated: '2026-09-01',
    })
    check('requires file or bytes', false)
  } catch (error) {
    check('requires file or bytes', error instanceof RepoError && error.status === 2)
  }
} finally {
  rmSync(dir, { recursive: true, force: true })
}

if (failed) {
  console.error(`${failed} failed`)
  process.exit(1)
}
console.log('instrument bytes ok')
