import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import type {
  ChangeAction,
  ChangeRecord,
  ChangeStatus,
  DeskPayload,
  Frontmatter,
  IssueRecord,
  ManualDetail,
  ManualRecord,
  SectionFile,
  SectionSummary,
  TouchedSection,
} from './types.ts'

const PLACEHOLDER_SHA256 = '0000000000000000000000000000000000000000000000000000000000000000'
const AUTHOR = 'Chief Pilot'

const TRANSITIONS: Record<ChangeAction, { from: ChangeStatus; to: ChangeStatus; verb: string }> = {
  submit: { from: 'draft', to: 'in_review', verb: 'submitted for review' },
  approve: { from: 'in_review', to: 'approved', verb: 'approved' },
  issue: { from: 'approved', to: 'issued', verb: 'issued' },
}

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

  rel(absPath: string): string {
    return path.relative(this.root, absPath).split(path.sep).join('/')
  }

  desk(): DeskPayload {
    return {
      manuals: this.listManuals(),
      changes: this.listChanges(),
      issues: this.listIssues(),
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
    if (!existsSync(file)) throw new RepoError(404, `Manual ${id} not found.`)
    const raw = parseYaml(readFileSync(file, 'utf8')) as ManualRecord
    return {
      id: raw.id,
      title: raw.title,
      abbrev: raw.abbrev,
      control: raw.control,
      owner: raw.owner,
      current_issued: raw.current_issued,
      effective: String(raw.effective),
    }
  }

  writeManual(manual: ManualRecord): void {
    writeFileSync(this.abs('manuals', manual.id, 'manual.yaml'), dumpYaml(manual))
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

  readSection(relPath: string): SectionFile {
    const abs = this.abs(relPath)
    if (!existsSync(abs)) throw new RepoError(404, `Section ${relPath} not found.`)
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
      .filter((name) => /^CHG-\d{4}-\d{3}\.yaml$/.test(name))
      .map((name) => this.readChange(name.replace(/\.yaml$/, '')))
      .sort((a, b) => b.id.localeCompare(a.id))
  }

  readChange(id: string): ChangeRecord {
    const file = this.abs('control', 'changes', `${id}.yaml`)
    if (!existsSync(file)) throw new RepoError(404, `Change ${id} not found.`)
    const raw = parseYaml(readFileSync(file, 'utf8')) as ChangeRecord
    const touched = (raw.touched ?? []).map((item) => {
      const working = this.readFrontmatter(this.abs(item.working))
      return {
        id: item.id,
        title: working.title,
        source: item.source,
        working: item.working,
      }
    })
    return {
      id: raw.id,
      manual: raw.manual,
      status: raw.status,
      title: raw.title,
      reason: raw.reason,
      created: String(raw.created),
      author: raw.author,
      target_revision: raw.target_revision,
      touched,
      history: raw.history ?? [],
    }
  }

  writeChange(change: ChangeRecord): void {
    const onDisk = {
      id: change.id,
      manual: change.manual,
      status: change.status,
      title: change.title,
      reason: change.reason,
      created: change.created,
      author: change.author,
      target_revision: change.target_revision,
      touched: change.touched.map(({ id, source, working }) => ({ id, source, working })),
      history: change.history,
    }
    mkdirSync(this.abs('control', 'changes'), { recursive: true })
    writeFileSync(this.abs('control', 'changes', `${change.id}.yaml`), dumpYaml(onDisk))
  }

  startChange(input: { manual: string; title: string; reason: string; sectionIds: string[] }): ChangeRecord {
    const title = input.title.trim()
    const reason = input.reason.trim()
    if (!title) throw new RepoError(400, 'A change title is required.')
    if (!reason) throw new RepoError(400, 'A reason for issue is required.')
    if (!input.sectionIds.length) throw new RepoError(400, 'Select at least one section to touch.')

    const manual = this.getManual(input.manual)
    const locks = this.openLocks(manual.id)
    const selected: SectionSummary[] = []
    for (const sectionId of input.sectionIds) {
      const section = manual.sections.find((item) => item.id === sectionId)
      if (!section) throw new RepoError(400, `Section ${sectionId} is not in ${manual.abbrev}.`)
      const holder = locks.get(section.id)
      if (holder) throw new RepoError(409, `${section.title} is already on ${holder}.`)
      selected.push(section)
    }

    const id = this.nextChangeId()
    const workingDir = `control/working/${id}`
    mkdirSync(this.abs(workingDir), { recursive: true })

    const touched: TouchedSection[] = selected.map((section) => {
      const working = `${workingDir}/${section.filename}`
      copyFileSync(this.abs(section.path), this.abs(working))
      return { id: section.id, title: section.title, source: section.path, working }
    })

    const change: ChangeRecord = {
      id,
      manual: manual.id,
      status: 'draft',
      title,
      reason,
      created: todayDate(),
      author: AUTHOR,
      target_revision: nextRevision(manual.current_issued),
      touched,
      history: [
        {
          at: nowIso(),
          action: 'created',
          note: `Opened against ${touched.map((item) => item.title).join(', ')}`,
        },
      ],
    }
    this.writeChange(change)
    return this.readChange(id)
  }

  saveWorkingSection(changeId: string, sectionId: string, markdown: string): SectionFile {
    const change = this.readChange(changeId)
    if (change.status === 'issued') throw new RepoError(409, 'An issued change cannot be edited.')
    const touched = change.touched.find((item) => item.id === sectionId)
    if (!touched) throw new RepoError(404, `Section ${sectionId} is not on ${changeId}.`)
    const incoming = splitFrontmatter(markdown)
    if (incoming.meta.id !== sectionId) {
      throw new RepoError(400, 'Section id in frontmatter must not change.')
    }
    const existing = this.readSection(touched.working)
    const next = withFrontmatter(
      { ...incoming.meta, id: existing.meta.id, rev_last_changed: existing.meta.rev_last_changed },
      incoming.body,
    )
    return this.writeSection(touched.working, next)
  }

  transition(changeId: string, action: ChangeAction): ChangeRecord {
    const spec = TRANSITIONS[action]
    if (!spec) throw new RepoError(400, `Unknown action ${action}.`)
    const change = this.readChange(changeId)
    if (change.status !== spec.from) {
      throw new RepoError(409, `${changeId} is ${change.status}; ${action} requires ${spec.from}.`)
    }
    if (action === 'issue') return this.issue(change)

    change.status = spec.to
    change.history.push({ at: nowIso(), action: spec.to, note: `${spec.verb} by ${AUTHOR}` })
    this.writeChange(change)
    return this.readChange(changeId)
  }

  listIssues(): IssueRecord[] {
    const dir = this.abs('control', 'issues')
    if (!existsSync(dir)) return []
    return readdirSync(dir)
      .filter((name) => name.endsWith('.yaml') && !name.startsWith('.'))
      .map((name) => this.readIssue(name.replace(/\.yaml$/, '')))
      .sort((a, b) => b.revision.localeCompare(a.revision, undefined, { numeric: true }))
  }

  readIssue(id: string): IssueRecord {
    const file = this.abs('control', 'issues', `${id}.yaml`)
    if (!existsSync(file)) throw new RepoError(404, `Issue ${id} not found.`)
    const raw = parseYaml(readFileSync(file, 'utf8')) as Omit<IssueRecord, 'sections'> & {
      sections: Array<string | { id: string; title?: string; rev_last_changed?: string }>
    }
    const manual = this.getManual(raw.manual)
    const sections = (raw.sections ?? []).map((entry) => {
      const sectionId = typeof entry === 'string' ? entry : entry.id
      const live = manual.sections.find((item) => item.id === sectionId)
      if (typeof entry === 'object') {
        return {
          id: entry.id,
          title: entry.title ?? live?.title ?? entry.id,
          rev_last_changed: entry.rev_last_changed ?? live?.rev_last_changed ?? raw.revision,
        }
      }
      return {
        id: sectionId,
        title: live?.title ?? sectionId,
        rev_last_changed: live?.rev_last_changed ?? raw.revision,
      }
    })
    return {
      id: raw.id,
      manual: raw.manual,
      revision: raw.revision,
      issued: String(raw.issued),
      effective: String(raw.effective),
      sha256: raw.sha256,
      summary: raw.summary,
      change: raw.change,
      sections,
    }
  }

  private issue(change: ChangeRecord): ChangeRecord {
    const manual = this.readManual(change.manual)
    const revision = nextRevision(manual.current_issued)
    const issuedOn = todayDate()
    const issueId = `${manual.abbrev}-${revision}`

    const issuedSections = change.touched.map((item) => {
      const working = this.readSection(item.working)
      const meta: Frontmatter = { ...working.meta, rev_last_changed: revision }
      const markdown = withFrontmatter(meta, working.body)
      this.writeSection(item.working, markdown)
      this.writeSection(item.source, markdown)
      return { id: meta.id, title: meta.title, rev_last_changed: revision }
    })

    const issue: IssueRecord = {
      id: issueId,
      manual: manual.id,
      revision,
      issued: issuedOn,
      effective: issuedOn,
      sha256: PLACEHOLDER_SHA256,
      summary: change.title,
      change: change.id,
      sections: issuedSections,
    }
    mkdirSync(this.abs('control', 'issues'), { recursive: true })
    writeFileSync(
      this.abs('control', 'issues', `${issueId}.yaml`),
      dumpYaml({
        id: issue.id,
        manual: issue.manual,
        revision: issue.revision,
        issued: issue.issued,
        effective: issue.effective,
        sha256: issue.sha256,
        summary: issue.summary,
        change: issue.change,
        sections: issue.sections,
      }),
    )

    this.writeManual({ ...manual, current_issued: revision, effective: issuedOn })

    change.status = 'issued'
    change.target_revision = revision
    change.history.push({
      at: nowIso(),
      action: 'issued',
      note: `Issued ${issueId} by ${AUTHOR}`,
    })
    this.writeChange(change)
    return this.readChange(change.id)
  }

  private openLocks(manualId: string): Map<string, string> {
    const locks = new Map<string, string>()
    for (const change of this.listChanges()) {
      if (change.manual !== manualId) continue
      if (change.status === 'issued') continue
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

  private readFrontmatter(absPath: string): Frontmatter {
    return splitFrontmatter(readFileSync(absPath, 'utf8')).meta
  }
}

export function splitFrontmatter(markdown: string): { meta: Frontmatter; body: string } {
  const match = markdown.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/)
  if (!match) throw new RepoError(400, 'Section is missing YAML frontmatter.')
  const raw = parseYaml(match[1]) as Partial<Frontmatter>
  if (!raw.id || !raw.title || !raw.rev_last_changed) {
    throw new RepoError(400, 'Frontmatter must include id, title, and rev_last_changed.')
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

export function nextRevision(current: string): string {
  const match = current.match(/^R(\d+)$/i)
  if (!match) throw new RepoError(400, `Cannot increment revision ${current}.`)
  return `R${Number(match[1]) + 1}`
}

export function dumpYaml(value: unknown): string {
  return stringifyYaml(value, { lineWidth: 88 }).replace(/\s*$/, '\n')
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
