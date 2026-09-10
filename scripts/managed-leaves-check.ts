import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { inferManagedKind, inferStart, slotOwners } from '../server/managed.ts'
import { applyIngest, scaffoldCatalog } from '../server/ingest.ts'
import { Repo, RepoError } from '../server/repo.ts'

let failed = 0

function check(label: string, ok: boolean, detail?: string) {
  if (ok) console.log(`ok ${label}`)
  else {
    failed += 1
    console.error(`FAIL ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

check('infer ror', inferManagedKind('Record of Revision') === 'ror')
check('infer lep', inferManagedKind('List of Effective Pages') === 'lep')
check('infer les', inferManagedKind('List of Effective Sections') === 'les')
check('infer toc', inferManagedKind('Table of Contents') === 'toc')
check('infer explicit', inferManagedKind('Front matter', 'ror') === 'ror')
check('procedure not managed', inferManagedKind('Section 1 — Identification') === null)
check('start from title', inferStart({ id: 'gomlep-5', title: 'Section 5 — Weight and Balance' }) === '5-1')
check('start from appendix', inferStart({ id: 'gomlep-a', title: 'Appendix A — Abbreviations' }) === 'A-1')

const mapped = slotOwners(
  ['i', 'ii', 'iii', '1-1', '1-2', '2-1'],
  [
    { id: 'ror', title: 'Record of Revision', rev_last_changed: 'R11', managed: 'ror', lep_start: 'i' },
    { id: 'lep', title: 'List of Effective Pages', rev_last_changed: 'R11', managed: 'lep', lep_start: 'iii' },
    { id: 's1', title: 'Section 1 — Policy', rev_last_changed: 'R12', managed: null, lep_start: '1-1' },
    { id: 's2', title: 'Section 2 — Management', rev_last_changed: 'R11', managed: null, lep_start: '2-1' },
  ],
  'R11',
)
check('roman i owns ror', mapped[0]?.section === 'Record of Revision')
check('roman ii stays ror', mapped[1]?.section === 'Record of Revision')
check('roman iii owns lep', mapped[2]?.section === 'List of Effective Pages')
check('1-2 follows section 1 rev', mapped[4]?.rev === 'R12' && mapped[4]?.section === 'Section 1 — Policy')

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
const dir = mkdtempSync(path.join(tmpdir(), 'revdesk-managed-'))
cpSync(path.join(root, 'fixtures', 'tiny-gom'), dir, { recursive: true })

try {
  writeFileSync(
    path.join(dir, 'manuals', 'gom', 'sections', '001-record-of-revision.md'),
    `---
id: gom-ror
title: Record of Revision
rev_last_changed: R13
---

# Record of Revision

Typed table that must not be the paper.
`,
  )
  writeFileSync(
    path.join(dir, 'manuals', 'gom', 'sections', '002-list-of-effective-pages.md'),
    `---
id: gom-lep
title: List of Effective Pages
rev_last_changed: R13
lep_start: i
---

# List of Effective Pages

Fake slots.
`,
  )
  writeFileSync(
    path.join(dir, 'manuals', 'gom', 'sections', '003-table-of-contents.md'),
    `---
id: gom-toc
title: Table of Contents
rev_last_changed: R13
---

# Table of Contents

Typed TOC.
`,
  )
  writeFileSync(
    path.join(dir, 'manuals', 'gom', 'manual.yaml'),
    `${readFileSync(path.join(dir, 'manuals', 'gom', 'manual.yaml'), 'utf8').trimEnd()}
pagination:
  control_surface: lep
  lep_inferred: false
  regions: []
lep_slots:
  - i
  - ii
  - 1-1
`,
  )

  const repo = new Repo(dir)
  const manual = repo.getManual('gom')
  const ror = manual.sections.find((section) => section.id === 'gom-ror')
  const identSection = manual.sections.find((section) => section.id === 'gom.ident')
  check('ror marked managed', ror?.managed === 'ror')
  check('ident still author', identSection?.managed == null)

  const paper = repo.issuedSection('gom', 'gom-ror')
  check('ror hydrates issue id', paper.markdown.includes('GOM-R13'))
  check('ror not typed prose', !paper.markdown.includes('Typed table that must not be the paper'))

  const lep = repo.issuedSection('gom', 'gom-lep')
  check('lep has slot column', lep.markdown.includes('| Slot | Revision | Section |'))
  check('lep lists a slot', lep.markdown.includes('| i |'))

  const toc = repo.issuedSection('gom', 'gom-toc')
  check('toc lists ident', /Identification/i.test(toc.markdown))

  let refused = false
  try {
    repo.startChange({
      manual: 'gom',
      title: 'Edit the ROR',
      reason: 'Should fail',
      sectionIds: ['gom-ror'],
    })
  } catch (error) {
    refused = error instanceof RepoError && error.status === 2
  }
  check('start ror refused', refused)

  const change = repo.startChange({
    manual: 'gom',
    title: 'Edit ident',
    reason: 'Working copy',
    sectionIds: ['gom.ident'],
  })
  check('start ident ok', change.touched.some((item) => item.id === 'gom.ident'))

  let touchRefused = false
  try {
    repo.touchChange(change.id, 'gom-lep')
  } catch (error) {
    touchRefused = error instanceof RepoError && error.status === 2
  }
  check('touch lep refused', touchRefused)

  repo.writeManual(repo.readManual('gom'))
  const yaml = readFileSync(path.join(dir, 'manuals', 'gom', 'manual.yaml'), 'utf8')
  check('writeManual keeps pagination', yaml.includes('control_surface: lep'))
  check('writeManual keeps lep_slots', yaml.includes('lep_slots:'))
} finally {
  rmSync(dir, { recursive: true, force: true })
}

const ingestDir = mkdtempSync(path.join(tmpdir(), 'revdesk-managed-ingest-'))
try {
  scaffoldCatalog('gom-lep', ingestDir)
  const rorFile = readFileSync(
    path.join(ingestDir, 'manuals', 'gom-lep', 'sections', '000-record-of-revision.md'),
    'utf8',
  )
  check('scaffold writes managed ror', rorFile.includes('managed: ror'))
  check('scaffold writes lep_start', rorFile.includes('lep_start: i'))
  check('scaffold stub not fake table', !rorFile.includes('| Revision | Effective | Summary |'))

  const repo = new Repo(ingestDir)
  const paper = repo.issuedSection('gom-lep', 'gomlep-ror')
  check('hydrated ror uses GOML-R11', paper.markdown.includes('GOML-R11'))
  const lep = repo.issuedSection('gom-lep', 'gomlep-lep')
  check('hydrated lep lists 1-1', lep.markdown.includes('| 1-1 |'))

  const viaFile = applyIngest(
    { file: path.join(root, 'fixtures', 'ingest', 'samples', 'nimbl-lep.txt') },
    ingestDir,
  )
  check('file ingest still gold', viaFile.matched_gold && viaFile.id === 'gom-lep')
} finally {
  rmSync(ingestDir, { recursive: true, force: true })
}

const lesDir = mkdtempSync(path.join(tmpdir(), 'revdesk-managed-les-'))
try {
  mkdirSync(path.join(lesDir, 'manuals', 'hb', 'sections'), { recursive: true })
  mkdirSync(path.join(lesDir, 'control', 'issues'), { recursive: true })
  writeFileSync(
    path.join(lesDir, 'manuals', 'hb', 'manual.yaml'),
    `id: hb
title: Crew Handbook
abbrev: HB
control_class: internal
owner: Chief Pilot
authority: chief-pilot
instrument_required: false
current_issued: HB-R3
next_revision: 4
effective: 2026-01-01
pagination:
  control_surface: les
`,
  )
  writeFileSync(
    path.join(lesDir, 'manuals', 'hb', 'sections', '000-list-of-effective-sections.md'),
    `---
id: hb-les
title: List of Effective Sections
rev_last_changed: R3
---

# List of Effective Sections
`,
  )
  writeFileSync(
    path.join(lesDir, 'manuals', 'hb', 'sections', '100-section-01-identification.md'),
    `---
id: hb-1
title: Section 1 — Identification
rev_last_changed: R3
---

# Identification
`,
  )
  writeFileSync(
    path.join(lesDir, 'control', 'issues', 'HB-R3.yaml'),
    `id: HB-R3
kind: full
state: launched
manual: hb
revision: 3
control_class: internal
supersedes: null
change: CHG-BASELINE
effective: 2026-01-01
instrument:
  type: internal-letter
  authority: chief-pilot
  file: control/instruments/hb.txt
  sha256: "1111111111111111111111111111111111111111111111111111111111111111"
  dated: 2026-01-01
manual_artifact:
  file: artifacts/HB-R3.pdf
  sha256: "0000000000000000000000000000000000000000000000000000000000000000"
git_tag: issued/HB/3
source_commit: null
git_skipped: true
incorporated_trs: []
launched_at: 2026-01-01T00:00:00.000Z
summary: Baseline
sections:
  - id: hb-les
    title: List of Effective Sections
    rev_last_changed: R3
  - id: hb-1
    title: Section 1 — Identification
    rev_last_changed: R3
`,
  )
  const repo = new Repo(lesDir)
  const les = repo.issuedSection('hb', 'hb-les')
  check('les lists identification', les.markdown.includes('Section 1 — Identification'))
  check('les omits itself', !les.markdown.includes('| List of Effective Sections |'))
} finally {
  rmSync(lesDir, { recursive: true, force: true })
}

if (failed) {
  console.error(`${failed} failed`)
  process.exit(1)
}
console.log('managed leaves ok')
