import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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

function listing(root: string): string[] {
  if (!existsSync(root)) return []
  return readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(entry.parentPath, entry.name))
    .sort()
}

function refuses(label: string, run: () => unknown, status: number, text: string, root: string) {
  const before = listing(root)
  try {
    run()
    check(label, false, 'did not throw')
  } catch (error) {
    check(
      label,
      error instanceof RepoError && error.status === status && error.message.includes(text),
      error instanceof Error ? `${(error as RepoError).status} ${error.message}` : String(error),
    )
  }
  check(`${label}: wrote nothing`, JSON.stringify(listing(root)) === JSON.stringify(before))
}

const dir = mkdtempSync(path.join(tmpdir(), 'revdesk-slice7-'))
const fixture = path.join(ROOT, 'fixtures', 'ingest', 'samples', 'nimbl-lep.txt')
const bytes = readFileSync(fixture)

try {
  const classified = classifySource(fixture)
  check('gold match nimbl-lep', matchGoldCatalog(classified) === 'gom-lep')

  const viaFile = applyIngest({ file: fixture, bodies: 'practice' }, dir)
  check('file ingest gold', viaFile.matched_gold && viaFile.id === 'gom-lep')
  check('file ingest sections', viaFile.sections > 10)

  check('practice result says practice', viaFile.bodies === 'practice')
  const viaBytes = applyIngest({ filename: 'nimbl-lep.txt', bytes, bodies: 'practice', replace: true }, dir)
  check('bytes ingest gold', viaBytes.matched_gold && viaBytes.id === 'gom-lep')
  const sectionFile = viaBytes.files.find((file) => file.includes('section-01'))
  check('wrote section-01', Boolean(sectionFile))
  if (sectionFile) {
    const body = readFileSync(path.join(dir, sectionFile), 'utf8')
    check('lorem not operator prose', !/Premier Air Charter|Palomar Airport/i.test(body))
    check('lorem body', /lorem ipsum/i.test(body))
  }

  const gold = path.join(dir, 'manuals', 'gom-lep')
  const stale = path.join(gold, 'sections', 'stale-leaf.md')
  const goldSections = readdirSync(path.join(gold, 'sections')).length
  writeFileSync(stale, 'stale\n')
  applyIngest({ file: fixture, bodies: 'practice', replace: true }, dir)
  check('replace drops stale leaves', !existsSync(stale))
  check('replace rewrites the same leaves', readdirSync(path.join(gold, 'sections')).length === goldSections)

  // Guard 1: the in-repo sample library takes no source text.
  const sample = path.join(ROOT, 'data')
  refuses('sample library guard', () => applyIngest({ file: fixture }, sample), 4, 'practice library that ships with Revdesk', sample)
  refuses(
    'sample library guard (inside data/)',
    () => applyIngest({ file: fixture, bodies: 'source' }, path.join(sample, 'manuals')),
    4,
    'practice library that ships with Revdesk',
    sample,
  )

  // Guard 2: no silent overwrite.
  refuses(
    'overwrite guard (practice)',
    () => applyIngest({ file: fixture, bodies: 'practice' }, dir),
    4,
    'A manual with id gom-lep is already in this library. Choose replace',
    dir,
  )

  // Guard 3: history blocks replace.
  const history = (name: string, files: Record<string, string>) => {
    const lib = mkdtempSync(path.join(tmpdir(), `revdesk-slice7-${name}-`))
    try {
      applyIngest({ file: fixture, bodies: 'practice' }, lib)
      for (const [rel, text] of Object.entries(files)) {
        mkdirSync(path.dirname(path.join(lib, rel)), { recursive: true })
        writeFileSync(path.join(lib, rel), text)
      }
      refuses(
        `history guard (${name})`,
        () => applyIngest({ file: fixture, bodies: 'practice', replace: true }, lib),
        4,
        'Manual gom-lep has changes or launches since it was brought in',
        lib,
      )
    } finally {
      rmSync(lib, { recursive: true, force: true })
    }
  }
  history('change', { 'control/changes/CHG-2026-900.yaml': 'id: CHG-2026-900\nmanual: gom-lep\n' })
  history('tr', { 'control/trs/GOML-R11-TR1.yaml': 'id: GOML-R11-TR1\nmanual: gom-lep\n' })
  history('launch', { 'control/issues/GOML-R12.yaml': 'id: GOML-R12\nmanual: gom-lep\nchange: CHG-2026-901\n' })
  const otherLib = mkdtempSync(path.join(tmpdir(), 'revdesk-slice7-other-'))
  try {
    applyIngest({ file: fixture, bodies: 'practice' }, otherLib)
    mkdirSync(path.join(otherLib, 'control', 'changes'), { recursive: true })
    writeFileSync(path.join(otherLib, 'control', 'changes', 'CHG-2026-902.yaml'), 'id: CHG-2026-902\nmanual: tp\n')
    applyIngest({ file: fixture, bodies: 'practice', replace: true }, otherLib)
    check('another manual\'s history does not block replace', true)
  } finally {
    rmSync(otherLib, { recursive: true, force: true })
  }

  // Guard 4 + gold: source text never takes the sanitized map; until T2.2 it stops here.
  const fresh = mkdtempSync(path.join(tmpdir(), 'revdesk-slice7-source-'))
  try {
    check('source classify still matches gold (guard is in apply)', matchGoldCatalog(classified) === 'gom-lep')
    refuses(
      'source text not built yet',
      () => applyIngest({ file: fixture }, fresh),
      5,
      'Bringing in the source text is not built yet',
      fresh,
    )
    refuses(
      'source text not built yet (bytes)',
      () => applyIngest({ filename: 'nimbl-lep.txt', bytes, bodies: 'source' }, fresh),
      5,
      'not built yet',
      fresh,
    )
  } finally {
    rmSync(fresh, { recursive: true, force: true })
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
