import { createHash } from 'node:crypto'
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Repo, RepoError } from '../server/repo.ts'
import { parse as parseYaml } from 'yaml'

let failed = 0

function check(label: string, ok: boolean, detail?: string) {
  if (ok) console.log(`ok ${label}`)
  else {
    failed += 1
    console.error(`FAIL ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

function shaOf(file: string): string {
  return createHash('sha256').update(readFileSync(file)).digest('hex')
}

function withCopy(fn: (repo: Repo, dir: string) => void) {
  const dir = mkdtempSync(path.join(tmpdir(), 'revdesk-compose-'))
  cpSync(path.resolve('fixtures/tiny-gom'), dir, { recursive: true })
  try {
    fn(new Repo(dir), dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

const lorem = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit.\n'

withCopy((repo, dir) => {
  const before = repo.readChange('CHG-014')
  check('request starts with no instrument', before.instrument == null)
  check('request starts approved', before.status === 'approved')

  const composed = repo.composeLetter('CHG-014', {
    to: 'Principal Operations Inspector',
    from: 'Chief Pilot',
    dated: '2026-09-08',
    subject: 'Request for acceptance',
    authority: 'poi',
    body: lorem,
    as: 'rev',
  })
  check('request kind', composed.correspondence?.kind === 'request')
  check('request does not set instrument', composed.instrument == null)
  check('request stays approved', composed.status === 'approved')
  check(
    'request lives under correspondence',
    composed.correspondence?.file === 'control/correspondence/CHG-014-request.md',
  )
  const requestAbs = path.join(dir, composed.correspondence!.file)
  const requestText = readFileSync(requestAbs, 'utf8')
  check('request envelope to', requestText.includes('to: Principal Operations Inspector'))
  check('request envelope kind', requestText.includes('kind: request'))
  check('request body stored', requestText.includes('Lorem ipsum dolor sit amet'))
  check('request sha matches bytes', composed.correspondence?.sha256 === shaOf(requestAbs))
  check('request body hydrated', composed.correspondence?.body === lorem.trimEnd())

  const onDisk = parseYaml(readFileSync(path.join(dir, 'control/changes/CHG-014.yaml'), 'utf8')) as {
    correspondence?: { body?: string }
  }
  check('change yaml omits body', onDisk.correspondence?.body == null)

  try {
    repo.issueFull('CHG-014', '2026-09-15')
    check('request cannot satisfy issue', false)
  } catch (error) {
    check(
      'request cannot satisfy issue',
      error instanceof RepoError && error.status === 2 && /instrument/.test(error.message),
      error instanceof Error ? error.message : String(error),
    )
  }

  try {
    repo.issueTr('CHG-014', { parent: 'GOM-R13', authority: 'chief-pilot' })
    check('request cannot satisfy tr issue', false)
  } catch (error) {
    check(
      'request cannot satisfy tr issue',
      error instanceof RepoError && error.status === 2 && /TR letter|memo or attach/.test(error.message),
      error instanceof Error ? error.message : String(error),
    )
  }

  const attached = repo.attachInstrument('CHG-014', {
    file: path.join(dir, 'letters/poi-acceptance.txt'),
    type: 'acceptance-letter',
    authority: 'poi',
    dated: '2026-09-12',
  })
  check('inbound attach still works after request', Boolean(attached.instrument))
  check('request kept beside inbound', attached.correspondence?.kind === 'request')
  const issued = repo.issueFull('CHG-014', '2026-09-15')
  check('inbound launch after request', issued.id === 'GOM-R14')
})

withCopy((repo, dir) => {
  const composed = repo.composeLetter('CHG-014', {
    to: 'File',
    from: 'Chief Pilot',
    dated: '2026-09-08',
    subject: 'Temporary revision memo',
    authority: 'chief-pilot',
    body: lorem,
    as: 'tr',
  })
  check('tr compose is memo', composed.correspondence?.kind === 'memo')
  check('tr compose does not attach full instrument', composed.instrument == null)
  check(
    'tr memo under correspondence',
    composed.correspondence?.file === 'control/correspondence/CHG-014-memo.md',
  )
  const tr = repo.issueTr('CHG-014', { parent: 'GOM-R13', authority: 'chief-pilot' })
  check('tr issue from composed memo', tr.id === 'GOM-R13-TR1')
  check('tr instrument hashes stored memo', Boolean(tr.instrument.sha256))
  const stored = readFileSync(path.join(dir, 'control/correspondence/CHG-014-memo.md'))
  const launchedCopy = readFileSync(path.join(dir, tr.instrument.file))
  check('tr launch copy matches memo bytes', Buffer.compare(stored, launchedCopy) === 0)
})

withCopy((repo, dir) => {
  writeFileSync(
    path.join(dir, 'manuals/gom/manual.yaml'),
    readFileSync(path.join(dir, 'manuals/gom/manual.yaml'), 'utf8').replace(
      'control_class: faa-accepted',
      'control_class: internal',
    ),
  )
  const opened = repo.startChange({
    manual: 'gom',
    title: 'Internal memo launch',
    reason: 'lorem',
    kind: 'rev',
    sectionIds: ['gom.ident'],
  })
  repo.transition(opened.id, 'submit')
  repo.transition(opened.id, 'approve')
  const composed = repo.composeLetter(opened.id, {
    to: 'File',
    from: 'Chief Pilot',
    dated: '2026-09-08',
    subject: 'Acceptance memo',
    authority: 'chief-pilot',
    body: lorem,
    as: 'rev',
  })
  check('internal compose is memo', composed.correspondence?.kind === 'memo')
  check('internal memo is the instrument', composed.instrument?.type === 'internal-letter')
  check('internal memo ready-to-launch', composed.status === 'ready-to-launch')
  check(
    'internal memo under instruments',
    composed.instrument?.file === `control/instruments/${opened.id}-memo.md`,
  )
  const abs = path.join(dir, composed.instrument!.file)
  check('internal instrument sha is composed bytes', composed.instrument?.sha256 === shaOf(abs))
  const issued = repo.issueFull(opened.id, '2026-09-15')
  check('internal memo launches', issued.id === 'GOM-R14')
  check('launched instrument is the memo', issued.instrument.file.endsWith('-memo.md'))
})

withCopy((repo) => {
  try {
    repo.composeLetter('CHG-014', {
      to: 'File',
      from: 'Chief Pilot',
      dated: '2026-09-08',
      subject: 'Empty',
      authority: 'chief-pilot',
      body: '   \n',
      as: 'rev',
    })
    check('empty body rejected', false)
  } catch (error) {
    check('empty body rejected', error instanceof RepoError && error.status === 2)
  }
})

if (failed) {
  console.error(`${failed} failed`)
  process.exit(1)
}
console.log('compose ok')
