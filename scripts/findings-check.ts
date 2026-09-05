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

const dir = mkdtempSync(path.join(tmpdir(), 'revdesk-findings-'))
cpSync(path.resolve('fixtures/tiny-gom'), dir, { recursive: true })

try {
  const repo = new Repo(dir)
  const issue = repo.readIssue('GOM-R13')
  const sectionId = 'gom.ident'
  const before = repo.issuedSection(issue.manual, sectionId).markdown

  const finding = repo.addFinding(issue.id, sectionId, 'The ident page is unclear.')
  check('id prefix', finding.id.startsWith('cf-'))
  check('status open', finding.status === 'open')
  check('section', finding.section === sectionId)
  check('markdown unchanged', repo.issuedSection(issue.manual, sectionId).markdown === before)

  const listed = repo.listFindings(issue.id, sectionId)
  check('listed on leaf', listed.some((row) => row.id === finding.id && row.body.includes('unclear')))
  check(
    'not on other leaf',
    repo.listFindings(issue.id, 'gom.2.4.3').every((row) => row.id !== finding.id),
  )
  check(
    'via manual',
    repo.findingsForManual(issue.manual, sectionId).some((row) => row.id === finding.id),
  )

  const crew = repo.crewSection(issue.id, sectionId)
  check('crew can find', crew.can_find)
  check('crew lists finding', crew.findings.some((row) => row.id === finding.id))

  let empty = false
  try {
    repo.addFinding(issue.id, sectionId, '  ')
  } catch (error) {
    empty = error instanceof RepoError
  }
  check('empty refused', empty)

  let missing = false
  try {
    repo.addFinding(issue.id, 'no-such-leaf', 'x')
  } catch (error) {
    missing = error instanceof RepoError && error.status === 3
  }
  check('unknown section refused', missing)

  const stored = readFileSync(path.join(dir, 'control', 'findings', issue.id, `${finding.id}.yaml`), 'utf8')
  check('stored under control/findings', stored.includes('The ident page is unclear.'))
  check('not in section markdown', !before.includes('The ident page is unclear.'))
} finally {
  rmSync(dir, { recursive: true, force: true })
}

if (failed) {
  console.error(`\n${failed} failed`)
  process.exit(1)
}
console.log('\nok findings-check')
