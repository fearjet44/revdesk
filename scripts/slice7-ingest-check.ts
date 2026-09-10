import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { applyIngest, matchGoldCatalog, classifySource } from '../server/ingest.ts'
import { dumpConfig, loadDeskConfig, saveDeskConfig } from '../server/config.ts'
import { RepoError } from '../server/repo.ts'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
let failed = 0

function check(label: string, ok: boolean, detail?: string) {
  if (ok) console.log(`ok ${label}`)
  else {
    failed += 1
    console.error(`FAIL ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

const dir = mkdtempSync(path.join(tmpdir(), 'revdesk-slice7-'))
const fixture = path.join(ROOT, 'fixtures', 'ingest', 'samples', 'nimbl-lep.txt')
const bytes = readFileSync(fixture)

try {
  const classified = classifySource(fixture)
  check('gold match nimbl-lep', matchGoldCatalog(classified) === 'gom-lep')

  const viaFile = applyIngest({ file: fixture }, dir)
  check('file ingest gold', viaFile.matched_gold && viaFile.id === 'gom-lep')
  check('file ingest sections', viaFile.sections > 10)

  const viaBytes = applyIngest({ filename: 'nimbl-lep.txt', bytes }, dir)
  check('bytes ingest gold', viaBytes.matched_gold && viaBytes.id === 'gom-lep')
  const sectionFile = viaBytes.files.find((file) => file.includes('section-01'))
  check('wrote section-01', Boolean(sectionFile))
  if (sectionFile) {
    const body = readFileSync(path.join(dir, sectionFile), 'utf8')
    check('lorem not operator prose', !/Premier Air Charter|Palomar Airport/i.test(body))
    check('lorem body', /lorem ipsum/i.test(body))
  }

  try {
    applyIngest({ filename: 'book.doc', bytes: Buffer.from('x') }, dir)
    check('rejects non pdf/txt', false)
  } catch (error) {
    check('rejects non pdf/txt', error instanceof RepoError && error.status === 2)
  }

  const yaml = dumpConfig({ remote: 'https://github.com/fearjet44/test-manual-repo.git' })
  check('config yaml key', yaml.includes('remote: https://github.com/fearjet44/test-manual-repo.git'))
  check('config yaml not json', !yaml.trim().startsWith('{'))
} finally {
  rmSync(dir, { recursive: true, force: true })
}

const xdg = mkdtempSync(path.join(tmpdir(), 'revdesk-slice7-cfg-'))
process.env.XDG_CONFIG_HOME = xdg
try {
  const file = saveDeskConfig({ remote: '' })
  check('saves user config', file.endsWith('revdesk/config.yaml'))
  check('empty remote loads solo', loadDeskConfig().remote === '')
  saveDeskConfig({ remote: 'https://example.invalid/manuals.git' })
  check('remote roundtrip', loadDeskConfig().remote === 'https://example.invalid/manuals.git')
} finally {
  rmSync(xdg, { recursive: true, force: true })
}

if (failed) process.exit(1)
console.log('slice7 ingest checks passed')
