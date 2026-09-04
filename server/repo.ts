import { createHash, randomBytes } from 'node:crypto'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import { lineDiff } from './diff.ts'
import {
  GitAdapterError,
  REVIEW_NOTES_REF,
  changeBranchName,
  changeBranchTip,
  fullTagName,
  gitStatus,
  loadGitConfig,
  preflightLaunch,
  readReviewNotes,
  snapshotLaunch,
  snapshotReview,
  startChangeBranch,
  tagOk,
  toGitPath,
  trTagName,
  writeReviewNotes,
} from './git.ts'
import type { GitStatusInfo } from './git.ts'
import type {
  ChangeAction,
  ChangePreview,
  ChangeReasonMeta,
  ChangeRecord,
  ChangeStatus,
  ControlClass,
  DeskPayload,
  Frontmatter,
  InstrumentAuthority,
  InstrumentRecord,
  InstrumentType,
  IssueRecord,
  IssueSection,
  LaunchedStatus,
  ManualDetail,
  ManualRecord,
  PackageKind,
  ReviewComment,
  SectionFile,
  SectionReview,
  SectionSummary,
  TouchAction,
  TouchedSection,
  TrRecord,
} from './types.ts'

const AUTHOR = 'Chief Pilot'
const TR_ONE_SECTION = 'A temporary revision touches one section.'
const PLACEHOLDER_ARTIFACT_SHA =
  '0000000000000000000000000000000000000000000000000000000000000000'

const TOUCH_ACTIONS = new Set<TouchAction>(['amend', 'add', 'delete'])
const CONTROL_CLASSES = new Set<ControlClass>([
  'faa-approved',
  'faa-accepted',
  'third-party',
  'internal',
])
const TR_AUTHORITIES = new Set(['chief-pilot', 'ae', 'ceo', 'do'])

const OPEN_STATUSES = new Set<ChangeStatus>([
  'draft',
  'review',
  'approved',
  'ready-to-launch',
  'edit',
])

const REVIEWER_STATUSES = new Set<ChangeStatus>(['review', 'approved', 'ready-to-launch'])

/** Exit codes per Slice 2: 2 validation, 3 not found, 4 not allowed, 5 pipeline */
export class RepoError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export class Repo {
  readonly root: string
  constructor(root: string) {
    this.root = root
  }

  abs(...parts: string[]): string {
    return path.join(this.root, ...parts)
  }

  desk(): DeskPayload {
    return {
      manuals: this.listManuals(),
      changes: this.listChanges(),
      issues: this.listIssues(),
      trs: this.listTrs(),
    }
  }

  listManuals(): ManualRecord[] {
    const dir = this.abs('manuals')
    if (!existsSync(dir)) return []
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
      .map((entry) => this.readManual(entry.name))
      .sort((a, b) => a.abbrev.localeCompare(b.abbrev))
  }

  readManual(id: string): ManualRecord {
    const file = this.abs('manuals', id, 'manual.yaml')
    if (!existsSync(file)) throw new RepoError(3, `Manual ${id} not found.`)
    const raw = parseYaml(readFileSync(file, 'utf8')) as Record<string, unknown>
    const control_class = normalizeControlClass(raw)
    const abbrev = String(raw.abbrev ?? id.toUpperCase())
    const current = normalizeCurrentIssued(raw.current_issued, abbrev)
    const next =
      typeof raw.next_revision === 'number'
        ? raw.next_revision
        : current
          ? parseIssueRevision(current) + 1
          : 1
    return {
      id: String(raw.id ?? id),
      title: String(raw.title ?? id),
      abbrev,
      control_class,
      control: controlClassLabel(control_class),
      owner: String(raw.owner ?? 'Chief Pilot'),
      authority: String(raw.authority ?? defaultAuthority(control_class)),
      instrument_required: raw.instrument_required !== false,
      current_issued: current,
      next_revision: next,
      effective: raw.effective == null ? null : String(raw.effective),
    }
  }

  writeManual(manual: ManualRecord): void {
    writeFileSync(
      this.abs('manuals', manual.id, 'manual.yaml'),
      dumpYaml({
        id: manual.id,
        title: manual.title,
        abbrev: manual.abbrev,
        control_class: manual.control_class,
        owner: manual.owner,
        authority: manual.authority,
        instrument_required: manual.instrument_required,
        current_issued: manual.current_issued,
        next_revision: manual.next_revision,
        effective: manual.effective,
      }),
    )
  }

  getManual(id: string): ManualDetail {
    const manual = this.readManual(id)
    return { ...manual, sections: this.listSections(id) }
  }

  listSections(manualId: string): SectionSummary[] {
    const dir = this.abs('manuals', manualId, 'sections')
    if (!existsSync(dir)) return []
    const open = this.openLocks(manualId)
    return readdirSync(dir)
      .filter((name) => name.endsWith('.md') && !name.startsWith('.'))
      .sort()
      .map((filename) => {
        const relPath = `manuals/${manualId}/sections/${filename}`
        const meta = this.readFrontmatter(this.abs(relPath))
        return {
          id: meta.id,
          title: meta.title,
          rev_last_changed: meta.rev_last_changed,
          path: relPath,
          filename,
          open_change: open.get(meta.id) ?? null,
        }
      })
  }

  findSection(manualId: string, sectionId: string): SectionSummary {
    const section = this.listSections(manualId).find((item) => item.id === sectionId)
    if (!section) throw new RepoError(3, `Section ${sectionId} is not in ${manualId}.`)
    return section
  }

  readSection(relPath: string): SectionFile {
    const abs = this.abs(relPath)
    if (!existsSync(abs)) throw new RepoError(3, `Section ${relPath} not found.`)
    const markdown = readFileSync(abs, 'utf8')
    const { meta, body } = splitFrontmatter(markdown)
    return { path: relPath, meta, markdown, body }
  }

  writeSection(relPath: string, markdown: string): SectionFile {
    const abs = this.abs(relPath)
    mkdirSync(path.dirname(abs), { recursive: true })
    const normalized = ensureTrailingNewline(markdown)
    splitFrontmatter(normalized)
    writeFileSync(abs, normalized)
    return this.readSection(relPath)
  }

  listChanges(): ChangeRecord[] {
    const dir = this.abs('control', 'changes')
    if (!existsSync(dir)) return []
    return readdirSync(dir)
      .filter((name) => /^CHG-.+\.yaml$/.test(name) && !name.startsWith('.'))
      .map((name) => this.readChange(name.replace(/\.yaml$/, '')))
      .sort((a, b) => b.id.localeCompare(a.id))
  }

  readChange(id: string): ChangeRecord {
    const file = this.abs('control', 'changes', `${id}.yaml`)
    if (!existsSync(file)) throw new RepoError(3, `Change ${id} not found.`)
    const raw = parseYaml(readFileSync(file, 'utf8')) as Record<string, unknown>
    const { reason, reason_meta } = normalizeReason(raw.reason as string | ChangeReasonMeta)
    const touched = ((raw.touched as Array<Record<string, string>>) ?? []).map((item) => {
      const workingMeta = existsSync(this.abs(item.working))
        ? this.readFrontmatter(this.abs(item.working))
        : { id: item.id, title: item.id, rev_last_changed: '' }
      return {
        id: item.id,
        title: workingMeta.title,
        source: item.source,
        working: item.working,
        action: (item.action as TouchAction) || 'amend',
      }
    })
    return {
      id: String(raw.id),
      manual: String(raw.manual),
      status: normalizeChangeStatus(String(raw.status)),
      kind: inferPackageKind(raw.kind, raw.launch_kind),
      title: String(raw.title),
      reason,
      reason_meta,
      created: String(raw.created),
      author: String(raw.author ?? AUTHOR),
      target_revision: raw.target_revision == null ? null : String(raw.target_revision),
      supersedes: raw.supersedes == null ? null : String(raw.supersedes),
      instrument: (raw.instrument as InstrumentRecord | null | undefined) ?? null,
      launch_kind: (raw.launch_kind as ChangeRecord['launch_kind']) ?? null,
      launch_id: raw.launch_id == null ? null : String(raw.launch_id),
      touched,
      history: (raw.history as ChangeRecord['history']) ?? [],
    }
  }

  writeChange(change: ChangeRecord): void {
    const onDisk: Record<string, unknown> = {
      id: change.id,
      manual: change.manual,
      status: change.status,
      kind: change.kind,
      title: change.title,
      reason: change.reason_meta ?? change.reason,
      created: change.created,
      author: change.author,
      target_revision: change.target_revision,
      supersedes: change.supersedes ?? null,
      instrument: change.instrument ?? null,
      launch_kind: change.launch_kind ?? null,
      launch_id: change.launch_id ?? null,
      touched: change.touched.map(({ id, source, working, action }) => ({
        id,
        source,
        working,
        action,
      })),
      history: change.history,
    }
    mkdirSync(this.abs('control', 'changes'), { recursive: true })
    writeFileSync(this.abs('control', 'changes', `${change.id}.yaml`), dumpYaml(onDisk))
  }

  startChange(input: {
    manual: string
    title: string
    reason?: string
    reasonType?: string
    reasonRef?: string
    kind?: string
    sectionIds?: string[]
    supersedes?: string
  }): ChangeRecord {
    const title = input.title.trim()
    if (!title) throw new RepoError(2, 'A change title is required.')

    const reasonInput = resolveReasonInput(input)
    if (!reasonInput) {
      throw new RepoError(2, 'A reason for issue is required (--reason-type/--ref or reason text).')
    }
    const { reason, reason_meta } = normalizeReason(reasonInput)
    const manual = this.getManual(input.manual)

    if (input.supersedes) {
      const parent = this.readIssue(input.supersedes)
      if (parent.state !== 'launched') {
        throw new RepoError(2, `${input.supersedes} is not a launched full revision.`)
      }
      if (parent.manual !== manual.id) {
        throw new RepoError(2, `${input.supersedes} is not a revision of ${manual.id}.`)
      }
    }

    const kind = parsePackageKind(input.kind)
    const sectionIds = input.sectionIds ?? []
    assertKindTouches(kind, sectionIds.length)
    const locks = this.openLocks(manual.id)
    const selected: SectionSummary[] = []
    for (const sectionId of sectionIds) {
      const section = manual.sections.find((item) => item.id === sectionId)
      if (!section) throw new RepoError(2, `Section ${sectionId} is not in ${manual.abbrev}.`)
      const holder = locks.get(section.id)
      if (holder) throw new RepoError(2, `${section.title} is already on ${holder}.`)
      selected.push(section)
    }

    const id = this.nextChangeId()
    const workingDir = `control/working/${id}`
    mkdirSync(this.abs(workingDir), { recursive: true })

    const touched: TouchedSection[] = selected.map((section) => {
      const working = `${workingDir}/${section.filename}`
      copyFileSync(this.abs(section.path), this.abs(working))
      return { id: section.id, title: section.title, source: section.path, working, action: 'amend' }
    })

    const change: ChangeRecord = {
      id,
      manual: manual.id,
      status: 'draft',
      kind,
      title,
      reason,
      reason_meta,
      created: todayDate(),
      author: AUTHOR,
      target_revision: null,
      supersedes: input.supersedes ?? null,
      instrument: null,
      launch_kind: null,
      launch_id: null,
      touched,
      history: [
        {
          at: nowIso(),
          action: 'created',
          note: input.supersedes
            ? `Opened to supersede ${input.supersedes}`
            : touched.length
              ? `Opened against ${touched.map((item) => item.title).join(', ')}`
              : 'Opened with no sections yet',
        },
      ],
    }
    this.writeChange(change)
    try {
      startChangeBranch(this.root, id, this.lastIssuedGitRef(manual))
    } catch (error) {
      throwGit(error)
    }
    return this.readChange(id)
  }

  touchChange(changeId: string, sectionId: string, action: TouchAction = 'amend'): ChangeRecord {
    if (!TOUCH_ACTIONS.has(action)) throw new RepoError(2, `Unknown touch action ${action}.`)
    if (action !== 'amend') {
      throw new RepoError(2, `Touch action ${action} is not implemented yet; use amend.`)
    }

    const change = this.readChange(changeId)
    if (!OPEN_STATUSES.has(change.status) || change.status === 'ready-to-launch') {
      if (change.status === 'launched' || change.status === 'withdrawn') {
        throw new RepoError(2, `${changeId} is ${change.status}; touch requires an open draft/edit/review.`)
      }
    }
    if (change.status === 'ready-to-launch') {
      throw new RepoError(2, `${changeId} is ready-to-launch; return-to-edit before touching sections.`)
    }
    if (!['draft', 'edit', 'review', 'approved'].includes(change.status)) {
      throw new RepoError(2, `${changeId} is ${change.status}; cannot touch.`)
    }
    if (change.kind === 'tr' && change.touched.length >= 1) {
      throw new RepoError(2, TR_ONE_SECTION)
    }
    if (change.touched.some((item) => item.id === sectionId)) {
      throw new RepoError(2, `Section ${sectionId} is already on ${changeId}.`)
    }

    const locks = this.openLocks(change.manual)
    const holder = locks.get(sectionId)
    if (holder) throw new RepoError(2, `Section ${sectionId} is already on ${holder}.`)

    const section = this.findSection(change.manual, sectionId)
    const workingDir = `control/working/${change.id}`
    mkdirSync(this.abs(workingDir), { recursive: true })
    const working = `${workingDir}/${section.filename}`
    copyFileSync(this.abs(section.path), this.abs(working))

    change.touched.push({
      id: section.id,
      title: section.title,
      source: section.path,
      working,
      action,
    })
    change.history.push({
      at: nowIso(),
      action: 'touched',
      note: `${action} ${section.id} (${section.title})`,
    })
    this.writeChange(change)
    return this.readChange(changeId)
  }

  saveWorkingSection(changeId: string, sectionId: string, markdown: string): SectionFile {
    const change = this.readChange(changeId)
    if (change.status === 'launched' || change.status === 'withdrawn') {
      throw new RepoError(2, `A ${change.status} change cannot be edited.`)
    }
    if (change.status === 'ready-to-launch') {
      throw new RepoError(2, `${changeId} is ready-to-launch; return-to-edit before editing.`)
    }
    const touched = change.touched.find((item) => item.id === sectionId)
    if (!touched) throw new RepoError(3, `Section ${sectionId} is not on ${changeId}.`)
    const incoming = splitFrontmatter(markdown)
    if (incoming.meta.id !== sectionId) {
      throw new RepoError(2, 'Section id in frontmatter must not change.')
    }
    const existing = this.readSection(touched.working)
    const next = withFrontmatter(
      { ...incoming.meta, id: existing.meta.id, rev_last_changed: existing.meta.rev_last_changed },
      incoming.body,
    )
    return this.writeSection(touched.working, next)
  }

  getSectionForChange(sectionId: string, changeId: string): SectionFile {
    const change = this.readChange(changeId)
    const touched = change.touched.find((item) => item.id === sectionId)
    if (!touched) throw new RepoError(3, `Section ${sectionId} is not on ${changeId}.`)
    return this.readSection(touched.working)
  }

  putSectionForChange(sectionId: string, changeId: string, markdown: string): SectionFile {
    return this.saveWorkingSection(changeId, sectionId, markdown)
  }

  transition(changeId: string, action: ChangeAction, opts: { role?: string } = {}): ChangeRecord {
    const change = this.readChange(changeId)
    if (action === 'submit') {
      if (change.status !== 'draft' && change.status !== 'edit') {
        throw new RepoError(2, `${changeId} is ${change.status}; submit requires draft or edit.`)
      }
      if (!change.touched.length) {
        throw new RepoError(2, `${changeId} has no touched sections; touch a section first.`)
      }
      change.status = 'review'
      change.history.push({
        at: nowIso(),
        action: 'review',
        note: `submitted for review by ${opts.role ? formatRole(opts.role) : AUTHOR}`,
      })
      this.writeChange(change)
      this.trySnapshotReview(change)
      return this.readChange(changeId)
    }

    if (action === 'approve') {
      if (change.status !== 'review') {
        throw new RepoError(2, `${changeId} is ${change.status}; approve requires review.`)
      }
      if (!change.touched.length) throw new RepoError(2, `${changeId} has no touched sections.`)
      change.status = change.instrument ? 'ready-to-launch' : 'approved'
      const actor = opts.role ? formatRole(opts.role) : AUTHOR
      change.history.push({
        at: nowIso(),
        action: change.status,
        note: `approved by ${actor}`,
      })
      this.writeChange(change)
      return this.readChange(changeId)
    }

    throw new RepoError(2, `Unknown action ${action}.`)
  }

  attachInstrument(
    changeId: string,
    input: {
      file: string
      type: string
      authority: string
      dated: string
      reference?: string
    },
  ): ChangeRecord {
    const change = this.readChange(changeId)
    if (change.status === 'launched') {
      throw new RepoError(2, `${changeId} is already launched; cannot attach an instrument.`)
    }
    if (change.status === 'withdrawn') {
      throw new RepoError(2, `${changeId} is withdrawn; cannot attach an instrument.`)
    }
    if (!['approved', 'ready-to-launch', 'review', 'draft', 'edit'].includes(change.status)) {
      throw new RepoError(2, `${changeId} is ${change.status}; cannot attach an instrument.`)
    }

    const dated = input.dated.trim()
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dated)) {
      throw new RepoError(2, `Instrument date must be YYYY-MM-DD (got ${dated}).`)
    }

    const type = input.type.trim() as InstrumentType
    const allowedTypes: InstrumentType[] = [
      'approval-letter',
      'acceptance-letter',
      'third-party-letter',
      'internal-letter',
    ]
    if (!allowedTypes.includes(type)) {
      throw new RepoError(2, `Unknown instrument type ${type}.`)
    }

    const src = path.resolve(input.file)
    if (!existsSync(src)) throw new RepoError(3, `Instrument file not found: ${src}`)
    assertInstrumentFile(src)

    const bytes = readFileSync(src)
    const sha256 = sha256Hex(bytes)
    const ext = path.extname(src) || '.bin'
    const authority = input.authority.trim()
    const destName = `${change.id}-${authority.replace(/\s+/g, '-').toLowerCase()}${ext}`
    const destRel = `control/instruments/${destName}`
    mkdirSync(this.abs('control', 'instruments'), { recursive: true })
    writeFileSync(this.abs(destRel), bytes)

    const instrument: InstrumentRecord = {
      type,
      authority,
      file: destRel,
      sha256,
      dated,
      reference: input.reference?.trim() || undefined,
    }
    change.instrument = instrument
    if (change.status === 'approved' || change.status === 'ready-to-launch') {
      change.status = 'ready-to-launch'
    }
    change.history.push({
      at: nowIso(),
      action: 'instrument',
      note: `Attached ${type} (${authority}) ${destRel}`,
    })
    this.writeChange(change)
    return this.readChange(changeId)
  }

  showInstrument(changeId: string): InstrumentRecord {
    const change = this.readChange(changeId)
    if (!change.instrument) {
      throw new RepoError(3, `${changeId} has no attached instrument.`)
    }
    return change.instrument
  }

  returnToEdit(changeId: string): ChangeRecord {
    const change = this.readChange(changeId)
    if (change.status === 'launched') {
      throw new RepoError(2, `${changeId} is launched; return-to-edit is only for pre-launch kickback.`)
    }
    if (change.status === 'withdrawn') {
      throw new RepoError(2, `${changeId} is withdrawn; return-to-edit is only for pre-launch kickback.`)
    }
    if (!['review', 'approved', 'ready-to-launch'].includes(change.status)) {
      throw new RepoError(
        2,
        `${changeId} is ${change.status}; return-to-edit requires review, approved, or ready-to-launch.`,
      )
    }
    change.status = 'edit'
    change.history.push({
      at: nowIso(),
      action: 'edit',
      note: 'Returned to edit (pre-launch kickback); next full revision number unchanged',
    })
    this.writeChange(change)
    return this.readChange(changeId)
  }

  withdraw(changeId: string, why: string): ChangeRecord {
    const reason = why.trim()
    if (!reason) throw new RepoError(2, 'A withdraw reason is required (--why).')
    const change = this.readChange(changeId)
    if (change.status === 'launched') {
      throw new RepoError(2, `${changeId} is launched; withdraw is dead after full or TR launch.`)
    }
    if (change.status === 'withdrawn') {
      throw new RepoError(2, `${changeId} is already withdrawn.`)
    }
    change.status = 'withdrawn'
    change.history.push({ at: nowIso(), action: 'withdrawn', note: reason })
    this.writeChange(change)
    return this.readChange(changeId)
  }

  /**
   * Full launch. Requires attached instrument. Assigns next_revision.
   */
  issueFull(changeId: string, effective: string): IssueRecord {
    const change = this.readChange(changeId)
    if (change.status === 'launched') {
      throw new RepoError(2, `${changeId} is already launched.`)
    }
    if (!change.instrument) {
      throw new RepoError(
        2,
        `${changeId} has no attached instrument. Attach a letter with \`instrument attach\`, or issue a temporary revision with \`tr issue\`.`,
      )
    }
    if (change.status !== 'ready-to-launch' && change.status !== 'approved') {
      throw new RepoError(
        2,
        `${changeId} is ${change.status}; full issue requires approved reviews and an instrument (ready-to-launch).`,
      )
    }
    // approved + instrument should already be ready-to-launch; tolerate approved if instrument present
    if (change.status === 'approved' && change.instrument) {
      change.status = 'ready-to-launch'
    }
    if (change.kind === 'tr') {
      throw new RepoError(
        2,
        `${changeId} is a temporary revision package; issue it with \`tr issue\`.`,
      )
    }
    if (!change.touched.length) throw new RepoError(2, `${changeId} has no touched sections.`)
    change.kind = 'rev'

    const effectiveDate = effective.trim()
    if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate)) {
      throw new RepoError(2, `Effective date must be YYYY-MM-DD (got ${effectiveDate}).`)
    }

    const manual = this.readManual(change.manual)
    if (!CONTROL_CLASSES.has(manual.control_class)) {
      throw new RepoError(2, `Manual ${manual.id} has invalid control_class.`)
    }

    const revNum = manual.next_revision
    const issueId = `${manual.abbrev}-R${revNum}`
    const revLabel = `R${revNum}`
    const supersedes = change.supersedes ?? manual.current_issued
    const cfg = loadGitConfig(this.root)
    const gitTag = fullTagName(cfg, { abbrev: manual.abbrev, revision: String(revNum) })
    try {
      preflightLaunch(this.root, gitTag)
    } catch (error) {
      throwGit(error)
    }

    const issuedSections = this.applyTouchedSections(change, revLabel)

    const parentId = manual.current_issued
    const toIncorporate = parentId
      ? this.listTrs({ manual: manual.id }).filter(
          (tr) => tr.state === 'launched' && tr.parent === parentId,
        )
      : []

    for (const tr of toIncorporate) {
      tr.state = 'incorporated'
      tr.incorporated_by = issueId
      this.writeTr(tr)
    }

    const artifactRel = `artifacts/${issueId}.pdf`
    mkdirSync(this.abs('artifacts'), { recursive: true })
    if (!existsSync(this.abs(artifactRel))) {
      writeFileSync(
        this.abs(artifactRel),
        `Placeholder artifact for ${issueId} — PDF pipeline is Slice 3+.\n`,
      )
    }

    const issue: IssueRecord = {
      id: issueId,
      kind: 'full',
      state: 'launched',
      manual: manual.id,
      revision: revNum,
      control_class: manual.control_class,
      supersedes,
      change: change.id,
      effective: effectiveDate,
      instrument: change.instrument,
      manual_artifact: {
        file: artifactRel,
        sha256: PLACEHOLDER_ARTIFACT_SHA,
      },
      git_tag: gitTag,
      source_commit: null,
      git_skipped: false,
      incorporated_trs: toIncorporate.map((tr) => tr.id),
      launched_at: nowIso(),
      summary: change.title,
      sections: issuedSections,
    }
    this.writeIssue(issue)

    this.writeManual({
      ...manual,
      current_issued: issueId,
      next_revision: revNum + 1,
      effective: effectiveDate,
    })

    change.status = 'launched'
    change.target_revision = issueId
    change.launch_kind = 'full'
    change.launch_id = issueId
    change.history.push({
      at: nowIso(),
      action: 'launched',
      note: `Full launch ${issueId} effective ${effectiveDate}`,
    })
    this.writeChange(change)

    try {
      snapshotLaunch(this.root, {
        tag: gitTag,
        message: `Launch ${issueId}`,
        persistSourceCommit: (sha, skipped) => {
          issue.source_commit = sha
          issue.git_skipped = skipped
          this.writeIssue(issue)
        },
      })
    } catch (error) {
      throwGit(error)
    }

    return this.readIssue(issueId)
  }

  issueTr(
    changeId: string,
    input: {
      parent: string
      authority: string
      file: string
      expires?: string
    },
  ): TrRecord {
    const change = this.readChange(changeId)
    if (change.status === 'launched') {
      throw new RepoError(2, `${changeId} is already launched.`)
    }
    if (change.status === 'withdrawn') {
      throw new RepoError(2, `${changeId} is withdrawn.`)
    }
    if (change.status !== 'approved' && change.status !== 'ready-to-launch') {
      throw new RepoError(
        2,
        `${changeId} is ${change.status}; tr issue requires approved (internal reviews done).`,
      )
    }
    if (change.kind === 'rev') {
      throw new RepoError(2, `${changeId} is a full revision package; issue it with \`issue\`.`)
    }
    if (!change.touched.length) throw new RepoError(2, `${changeId} has no touched sections.`)
    if (change.touched.length !== 1) {
      throw new RepoError(2, TR_ONE_SECTION)
    }
    change.kind = 'tr'

    const manual = this.readManual(change.manual)
    if (!manual.current_issued) {
      throw new RepoError(
        2,
        `${manual.abbrev} has never been full-launched. Full-launch R1 with an internal-letter first; temporary revisions require a launched parent.`,
      )
    }

    const parent = this.readIssue(input.parent)
    if (parent.state !== 'launched') {
      throw new RepoError(2, `Parent ${input.parent} is not launched.`)
    }
    if (parent.manual !== manual.id) {
      throw new RepoError(2, `Parent ${input.parent} is not a revision of ${manual.id}.`)
    }
    if (parent.id !== manual.current_issued) {
      throw new RepoError(
        2,
        `Parent ${input.parent} is not the current launched revision (${manual.current_issued}).`,
      )
    }

    const authority = input.authority.trim().toLowerCase()
    if (!TR_AUTHORITIES.has(authority)) {
      throw new RepoError(
        2,
        `TR authority must be one of chief-pilot | ae | ceo | do (got ${input.authority}).`,
      )
    }

    const src = path.resolve(input.file)
    if (!existsSync(src)) throw new RepoError(3, `Instrument file not found: ${src}`)
    assertInstrumentFile(src)

    let expires: string | null = null
    if (input.expires?.trim()) {
      expires = input.expires.trim()
      if (!/^\d{4}-\d{2}-\d{2}$/.test(expires)) {
        throw new RepoError(2, `Expires must be YYYY-MM-DD (got ${expires}).`)
      }
    }

    const bytes = readFileSync(src)
    const sha256 = sha256Hex(bytes)
    const seq = this.nextTrSeq(parent.id)
    const trId = `${parent.id}-TR${seq}`
    const cfg = loadGitConfig(this.root)
    const gitTag = trTagName(cfg, {
      abbrev: manual.abbrev,
      parent_revision: String(parent.revision),
      seq: String(seq),
    })
    try {
      preflightLaunch(this.root, gitTag)
    } catch (error) {
      throwGit(error)
    }

    const ext = path.extname(src) || '.bin'
    const destRel = `control/instruments/${trId}-${authority}${ext}`
    mkdirSync(this.abs('control', 'instruments'), { recursive: true })
    writeFileSync(this.abs(destRel), bytes)

    const instrument: InstrumentRecord = {
      type: 'internal-letter',
      authority,
      file: destRel,
      sha256,
      dated: todayDate(),
    }

    // Operating content: apply working copies; keep section rev_last_changed at parent label
    const parentRevLabel = `R${parent.revision}`
    const sections = this.applyTouchedSections(change, parentRevLabel)

    const tr: TrRecord = {
      id: trId,
      kind: 'temporary-revision',
      state: 'launched',
      manual: manual.id,
      parent: parent.id,
      seq,
      change: change.id,
      authority,
      instrument,
      expires,
      incorporated_by: null,
      git_tag: gitTag ?? '',
      source_commit: null,
      git_skipped: false,
      launched_at: nowIso(),
      summary: change.title,
      sections,
    }
    this.writeTr(tr)

    change.status = 'launched'
    change.launch_kind = 'temporary'
    change.launch_id = trId
    change.instrument = instrument
    change.history.push({
      at: nowIso(),
      action: 'launched',
      note: `Temporary revision ${trId} against ${parent.id}`,
    })
    this.writeChange(change)

    try {
      snapshotLaunch(this.root, {
        tag: gitTag,
        message: `Launch ${trId}`,
        persistSourceCommit: (sha, skipped) => {
          tr.source_commit = sha
          tr.git_skipped = skipped
          this.writeTr(tr)
        },
      })
    } catch (error) {
      throwGit(error)
    }

    return this.readTr(trId)
  }

  listTrs(filter: { manual?: string } = {}): TrRecord[] {
    const dir = this.abs('control', 'trs')
    if (!existsSync(dir)) return []
    return readdirSync(dir)
      .filter((name) => name.endsWith('.yaml') && !name.startsWith('.'))
      .map((name) => this.readTr(name.replace(/\.yaml$/, '')))
      .filter((tr) => (filter.manual ? tr.manual === filter.manual : true))
      .sort((a, b) => b.id.localeCompare(a.id, undefined, { numeric: true }))
  }

  readTr(id: string): TrRecord {
    const file = this.abs('control', 'trs', `${id}.yaml`)
    if (!existsSync(file)) throw new RepoError(3, `TR ${id} not found.`)
    const raw = parseYaml(readFileSync(file, 'utf8')) as TrRecord
    return {
      ...raw,
      expires: raw.expires ?? null,
      incorporated_by: raw.incorporated_by ?? null,
      git_tag: raw.git_tag ?? '',
      source_commit: raw.source_commit ?? null,
      git_skipped: raw.git_skipped,
      sections: raw.sections ?? [],
    }
  }

  writeTr(tr: TrRecord): void {
    mkdirSync(this.abs('control', 'trs'), { recursive: true })
    writeFileSync(this.abs('control', 'trs', `${tr.id}.yaml`), dumpYaml(tr))
  }

  launched(manualId: string): LaunchedStatus {
    const manual = this.readManual(manualId)
    const active_trs = manual.current_issued
      ? this.listTrs({ manual: manualId })
          .filter((tr) => tr.state === 'launched' && tr.parent === manual.current_issued)
          .map((tr) => tr.id)
      : []
    let tag: string | null = null
    let source_commit: string | null = null
    let tag_ok_flag = false
    if (manual.current_issued) {
      const issue = this.readIssue(manual.current_issued)
      tag = issue.git_tag || null
      source_commit = issue.source_commit ?? null
      tag_ok_flag = tagOk(this.root, tag, source_commit)
    }
    return {
      manual: manual.id,
      abbrev: manual.abbrev,
      full: manual.current_issued,
      full_state: manual.current_issued ? 'launched' : 'none',
      active_trs,
      next_full: manual.next_revision,
      next_full_launched: false,
      control_class: manual.control_class,
      tag,
      source_commit,
      tag_ok: tag_ok_flag,
    }
  }

  reviewSection(changeId: string, sectionId: string): SectionReview {
    const change = this.readChange(changeId)
    const section = change.touched.find((item) => item.id === sectionId)
    if (!section) throw new RepoError(3, `Section ${sectionId} is not on ${changeId}.`)
    const source = this.readSection(section.source)
    const working = this.readSection(section.working)
    const notes = readReviewNotes(this.root, changeId)
    const cfg = loadGitConfig(this.root)
    return {
      change,
      section,
      source: source.markdown,
      working: working.markdown,
      rows: lineDiff(source.markdown, working.markdown),
      comments: (notes?.comments ?? []).filter((row) => row.section === sectionId),
      commit: notes?.commit ?? changeBranchTip(this.root, changeId),
      branch: changeBranchName(cfg, changeId),
      notes_ref: REVIEW_NOTES_REF,
      can_comment: REVIEWER_STATUSES.has(change.status),
    }
  }

  listComments(changeId: string): ReviewComment[] {
    this.readChange(changeId)
    return readReviewNotes(this.root, changeId)?.comments ?? []
  }

  addComment(
    changeId: string,
    input: { section: string; line: number; side: 'old' | 'new'; body: string },
  ): ReviewComment {
    const change = this.readChange(changeId)
    if (!REVIEWER_STATUSES.has(change.status)) {
      throw new RepoError(
        2,
        `${changeId} is ${change.status}; comments are written on the reviewer desk.`,
      )
    }
    const section = change.touched.find((item) => item.id === input.section)
    if (!section) throw new RepoError(3, `Section ${input.section} is not on ${changeId}.`)
    const body = input.body.trim()
    if (!body) throw new RepoError(2, 'Comment body is required.')
    const side = input.side
    if (side !== 'old' && side !== 'new') throw new RepoError(2, 'side must be old or new.')
    const line = Number(input.line)
    if (!Number.isInteger(line) || line < 1) throw new RepoError(2, 'line must be a 1-based integer.')

    const source = this.readSection(section.source)
    const working = this.readSection(section.working)
    const rows = lineDiff(source.markdown, working.markdown)
    const hit = rows.find((row) =>
      side === 'old' ? row.old_line === line : row.new_line === line,
    )
    if (!hit) throw new RepoError(2, `Line ${line} (${side}) is not in ${section.id}.`)

    const snap = this.snapshotChangeReview(change)
    const gitPath = toGitPath(this.root, this.abs(section.source))
    const existing = readReviewNotes(this.root, changeId)?.comments ?? []
    const comment: ReviewComment = {
      id: `rc-${randomBytes(4).toString('hex')}`,
      change: changeId,
      section: section.id,
      path: gitPath,
      line,
      side,
      body,
      author: AUTHOR,
      at: nowIso(),
    }
    writeReviewNotes(this.root, changeId, snap.commit, [...existing, comment])
    return comment
  }

  private snapshotChangeReview(change: ChangeRecord): { commit: string; branch: string } {
    try {
      const files = change.touched.map((item) => ({
        gitPath: toGitPath(this.root, this.abs(item.source)),
        content: this.readSection(item.working).markdown,
      }))
      return snapshotReview(
        this.root,
        change.id,
        files,
        `Revdesk review snapshot ${change.id}`,
      )
    } catch (error) {
      throwGit(error)
    }
  }

  private trySnapshotReview(change: ChangeRecord): void {
    try {
      this.snapshotChangeReview(change)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error(`warning: review snapshot skipped for ${change.id}: ${message}`)
    }
  }

  preview(changeId: string): ChangePreview {
    const change = this.readChange(changeId)
    const manual = this.readManual(change.manual)
    const sections = change.touched.map((item) => {
      const source = this.readSection(item.source)
      const working = this.readSection(item.working)
      return {
        id: item.id,
        title: item.title,
        action: item.action,
        source: item.source,
        working: item.working,
        unchanged: source.markdown === working.markdown,
        source_rev: source.meta.rev_last_changed,
        working_rev: working.meta.rev_last_changed,
      }
    })
    return { change, manual, sections }
  }

  listIssues(): IssueRecord[] {
    const dir = this.abs('control', 'issues')
    if (!existsSync(dir)) return []
    return readdirSync(dir)
      .filter((name) => name.endsWith('.yaml') && !name.startsWith('.'))
      .map((name) => this.readIssue(name.replace(/\.yaml$/, '')))
      .sort((a, b) => b.revision - a.revision)
  }

  readIssue(id: string): IssueRecord {
    const file = this.abs('control', 'issues', `${id}.yaml`)
    if (!existsSync(file)) throw new RepoError(3, `Issue ${id} not found.`)
    const raw = parseYaml(readFileSync(file, 'utf8')) as Record<string, unknown>

    // Legacy Slice 1 shape → normalize
    if (!raw.kind) {
      const revisionRaw = raw.revision
      const revision =
        typeof revisionRaw === 'number'
          ? revisionRaw
          : parseIssueRevision(String(revisionRaw).startsWith('R') ? `${raw.id}` : String(id))
      const manual = this.readManual(String(raw.manual))
      return {
        id: String(raw.id),
        kind: 'full',
        state: 'launched',
        manual: String(raw.manual),
        revision: Number.isFinite(revision) ? revision : parseIssueRevision(id),
        control_class: manual.control_class,
        supersedes: null,
        change: String(raw.change ?? ''),
        effective: String(raw.effective),
        instrument: {
          type: instrumentTypeFor(manual.control_class),
          authority: manual.authority,
          file: 'control/instruments/legacy-placeholder.txt',
          sha256: String(raw.sha256 ?? PLACEHOLDER_ARTIFACT_SHA),
          dated: String(raw.issued ?? raw.effective),
        },
        manual_artifact: {
          file: String(raw.sha256 ? `artifacts/${raw.id}.pdf` : `artifacts/${raw.id}.pdf`),
          sha256: String(raw.sha256 ?? PLACEHOLDER_ARTIFACT_SHA),
        },
        git_tag: String(raw.git_tag ?? issuedTagGuess(manual.abbrev, revision)),
        source_commit: raw.source_commit == null ? null : String(raw.source_commit),
        git_skipped: Boolean(raw.git_skipped),
        incorporated_trs: [],
        launched_at: String(raw.issued ?? raw.effective),
        summary: String(raw.summary ?? ''),
        sections: normalizeIssueSections(raw.sections, String(raw.revision ?? '')),
      }
    }

    const revision = Number(raw.revision)
    const abbrev = this.readManual(String(raw.manual)).abbrev
    const storedTag = raw.git_tag == null ? '' : String(raw.git_tag)
    const git_tag =
      storedTag && storedTag !== String(raw.id)
        ? storedTag
        : issuedTagGuess(abbrev, revision)
    return {
      id: String(raw.id),
      kind: 'full',
      state: 'launched',
      manual: String(raw.manual),
      revision,
      control_class: raw.control_class as ControlClass,
      supersedes: raw.supersedes == null ? null : String(raw.supersedes),
      change: String(raw.change),
      effective: String(raw.effective),
      instrument: raw.instrument as InstrumentRecord,
      manual_artifact: raw.manual_artifact as IssueRecord['manual_artifact'],
      git_tag,
      source_commit: raw.source_commit == null ? null : String(raw.source_commit),
      git_skipped: raw.git_skipped == null ? undefined : Boolean(raw.git_skipped),
      incorporated_trs: (raw.incorporated_trs as string[]) ?? [],
      launched_at: String(raw.launched_at),
      summary: String(raw.summary ?? ''),
      sections: (raw.sections as IssueSection[]) ?? [],
    }
  }

  writeIssue(issue: IssueRecord): void {
    mkdirSync(this.abs('control', 'issues'), { recursive: true })
    writeFileSync(this.abs('control', 'issues', `${issue.id}.yaml`), dumpYaml(issueOnDisk(issue)))
  }

  gitStatus(): GitStatusInfo {
    return gitStatus(this.root)
  }

  private lastIssuedGitRef(manual: ManualRecord): string | null {
    if (!manual.current_issued) return null
    const trs = this.listTrs({ manual: manual.id })
      .filter(
        (tr) => tr.state === 'launched' && tr.parent === manual.current_issued && tr.git_tag,
      )
      .sort((a, b) => b.seq - a.seq)
    if (trs[0]?.git_tag) return trs[0].git_tag
    const issue = this.readIssue(manual.current_issued)
    return issue.git_tag || null
  }

  private applyTouchedSections(change: ChangeRecord, revLabel: string): IssueSection[] {
    return change.touched.map((item) => {
      const working = this.readSection(item.working)
      const meta: Frontmatter = { ...working.meta, rev_last_changed: revLabel }
      const markdown = withFrontmatter(meta, working.body)
      this.writeSection(item.working, markdown)
      this.writeSection(item.source, markdown)
      return { id: meta.id, title: meta.title, rev_last_changed: revLabel }
    })
  }

  private openLocks(manualId: string): Map<string, string> {
    const locks = new Map<string, string>()
    for (const change of this.listChanges()) {
      if (change.manual !== manualId) continue
      if (change.status === 'launched' || change.status === 'withdrawn') continue
      for (const section of change.touched) locks.set(section.id, change.id)
    }
    return locks
  }

  private nextChangeId(): string {
    const year = String(new Date().getFullYear())
    const prefix = `CHG-${year}-`
    let max = 0
    for (const change of this.listChanges()) {
      if (!change.id.startsWith(prefix)) continue
      const n = Number(change.id.slice(prefix.length))
      if (Number.isFinite(n)) max = Math.max(max, n)
    }
    return `${prefix}${String(max + 1).padStart(3, '0')}`
  }

  private nextTrSeq(parentId: string): number {
    let max = 0
    for (const tr of this.listTrs()) {
      if (tr.parent !== parentId) continue
      max = Math.max(max, tr.seq)
    }
    return max + 1
  }

  private readFrontmatter(absPath: string): Frontmatter {
    return splitFrontmatter(readFileSync(absPath, 'utf8')).meta
  }
}

export function splitFrontmatter(markdown: string): { meta: Frontmatter; body: string } {
  const match = markdown.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/)
  if (!match) throw new RepoError(2, 'Section is missing YAML frontmatter.')
  const raw = parseYaml(match[1]) as Partial<Frontmatter>
  if (!raw.id || !raw.title || !raw.rev_last_changed) {
    throw new RepoError(2, 'Frontmatter must include id, title, and rev_last_changed.')
  }
  return {
    meta: {
      id: String(raw.id),
      title: String(raw.title),
      rev_last_changed: String(raw.rev_last_changed),
    },
    body: match[2].replace(/^\n/, ''),
  }
}

export function withFrontmatter(meta: Frontmatter, body: string): string {
  const yaml = stringifyYaml(
    {
      id: meta.id,
      title: meta.title,
      rev_last_changed: meta.rev_last_changed,
    },
    { lineWidth: 0 },
  ).trimEnd()
  return `---\n${yaml}\n---\n\n${body.replace(/^\n+/, '')}`.replace(/\s*$/, '\n')
}

export function dumpYaml(value: unknown): string {
  return stringifyYaml(value, { lineWidth: 88 }).replace(/\s*$/, '\n')
}

export function formatReasonMeta(meta: ChangeReasonMeta): string {
  const type = meta.type.trim().toLowerCase()
  const ref = (meta.ref ?? '').trim()
  if (!ref) return meta.type
  if (type === 'opspec') return `OpSpec ${ref}`
  if (type === 'regulation' || type === 'cfr') return `14 CFR ${ref}`
  if (type === 'isbao') return `IS-BAO ${ref}`
  if (type === 'regulator') return `Regulator ${ref || 'kickback'}`.trim()
  return `${meta.type} ${ref}`.trim()
}

function issueOnDisk(issue: IssueRecord): Record<string, unknown> {
  return {
    id: issue.id,
    kind: issue.kind,
    state: issue.state,
    manual: issue.manual,
    revision: issue.revision,
    control_class: issue.control_class,
    supersedes: issue.supersedes,
    change: issue.change,
    effective: issue.effective,
    instrument: issue.instrument,
    manual_artifact: issue.manual_artifact,
    git_tag: issue.git_tag,
    source_commit: issue.source_commit ?? null,
    git_skipped: issue.git_skipped ?? false,
    incorporated_trs: issue.incorporated_trs,
    launched_at: issue.launched_at,
    summary: issue.summary,
    sections: issue.sections,
  }
}

function throwGit(error: unknown): never {
  if (error instanceof GitAdapterError) throw new RepoError(error.status, error.message)
  throw error
}

function issuedTagGuess(abbrev: string, revision: number): string {
  return `issued/${abbrev}/${revision}`
}

const INSTRUMENT_EXTS = new Set(['.eml', '.txt', '.pdf'])

function assertInstrumentFile(src: string): void {
  const ext = path.extname(src).toLowerCase()
  if (!INSTRUMENT_EXTS.has(ext)) {
    throw new RepoError(
      2,
      `Instrument file must be .eml, .txt, or .pdf (got ${ext || 'no extension'}).`,
    )
  }
}

function parsePackageKind(raw: unknown): PackageKind {
  if (raw == null || raw === '' || raw === 'wip') return 'wip'
  const value = String(raw).trim().toLowerCase()
  if (value === 'tr' || value === 'rev' || value === 'wip') return value
  throw new RepoError(2, 'kind must be tr, rev, or omitted (named at review).')
}

function inferPackageKind(raw: unknown, launchKind?: unknown): PackageKind {
  if (raw === 'tr' || raw === 'rev' || raw === 'wip') return raw
  if (launchKind === 'temporary') return 'tr'
  if (launchKind === 'full') return 'rev'
  return 'wip'
}

function assertKindTouches(kind: PackageKind, count: number): void {
  if (count === 0) {
    throw new RepoError(2, 'A change must touch at least one section.')
  }
  if (kind === 'tr' && count !== 1) {
    throw new RepoError(2, TR_ONE_SECTION)
  }
}

function normalizeChangeStatus(raw: string): ChangeStatus {
  if (raw === 'in_review') return 'review'
  if (raw === 'issued') return 'launched'
  return raw as ChangeStatus
}

function normalizeControlClass(raw: Record<string, unknown>): ControlClass {
  if (typeof raw.control_class === 'string' && CONTROL_CLASSES.has(raw.control_class as ControlClass)) {
    return raw.control_class as ControlClass
  }
  const legacy = String(raw.control ?? '').toLowerCase()
  if (legacy.includes('approved')) return 'faa-approved'
  if (legacy.includes('accepted')) return 'faa-accepted'
  if (legacy.includes('third')) return 'third-party'
  if (legacy.includes('internal')) return 'internal'
  return 'faa-accepted'
}

function controlClassLabel(cc: ControlClass): string {
  switch (cc) {
    case 'faa-approved':
      return 'FAA-approved'
    case 'faa-accepted':
      return 'FAA-accepted'
    case 'third-party':
      return 'Third-party'
    case 'internal':
      return 'Internal'
  }
}

function defaultAuthority(cc: ControlClass): string {
  if (cc === 'faa-approved' || cc === 'faa-accepted') return 'poi'
  if (cc === 'third-party') return 'third-party'
  return 'chief-pilot'
}

function instrumentTypeFor(cc: ControlClass): InstrumentType {
  switch (cc) {
    case 'faa-approved':
      return 'approval-letter'
    case 'faa-accepted':
      return 'acceptance-letter'
    case 'third-party':
      return 'third-party-letter'
    case 'internal':
      return 'internal-letter'
  }
}

function normalizeCurrentIssued(
  value: unknown,
  abbrev: string,
): string | null {
  if (value == null || value === '' || value === 'null') return null
  const s = String(value)
  const full = s.match(/^([A-Za-z]+)-R(\d+)$/i)
  if (full) return `${full[1].toUpperCase()}-R${full[2]}`
  const m = s.match(/^R(\d+)$/i)
  if (m) return `${abbrev}-R${m[1]}`
  return s
}

function parseIssueRevision(idOrRev: string): number {
  const m = String(idOrRev).match(/R(\d+)$/i) || String(idOrRev).match(/^(\d+)$/)
  if (!m) return 0
  return Number(m[1])
}

function normalizeIssueSections(raw: unknown, fallbackRev: string): IssueSection[] {
  if (!Array.isArray(raw)) return []
  return raw.map((entry) => {
    if (typeof entry === 'string') {
      return { id: entry, title: entry, rev_last_changed: String(fallbackRev) }
    }
    const obj = entry as { id: string; title?: string; rev_last_changed?: string }
    return {
      id: obj.id,
      title: obj.title ?? obj.id,
      rev_last_changed: obj.rev_last_changed ?? String(fallbackRev),
    }
  })
}

function normalizeReason(raw: string | ChangeReasonMeta | undefined): {
  reason: string
  reason_meta?: ChangeReasonMeta
} {
  if (!raw) return { reason: '' }
  if (typeof raw === 'string') return { reason: raw.trim() }
  const meta = { type: String(raw.type ?? '').trim(), ref: raw.ref ? String(raw.ref).trim() : undefined }
  if (!meta.type) throw new RepoError(2, 'Reason must include type.')
  return { reason: formatReasonMeta(meta), reason_meta: meta }
}

function resolveReasonInput(input: {
  reason?: string
  reasonType?: string
  reasonRef?: string
}): string | ChangeReasonMeta | null {
  if (input.reasonType) {
    return { type: input.reasonType.trim(), ref: input.reasonRef?.trim() }
  }
  if (input.reason?.trim()) return input.reason.trim()
  return null
}

function formatRole(role: string): string {
  return role
    .trim()
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ')
}

function sha256Hex(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function todayDate(): string {
  return new Date().toISOString().slice(0, 10)
}

function nowIso(): string {
  return new Date().toISOString()
}

function ensureTrailingNewline(text: string): string {
  return text.endsWith('\n') ? text : `${text}\n`
}

export { instrumentTypeFor }
export type { InstrumentAuthority }
