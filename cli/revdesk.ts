#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  classifyFromText,
  classifyPdf,
  formatClassification,
  listCatalogs,
  loadCatalog,
  scaffoldCatalog,
} from '../server/ingest.ts'
import { Repo, RepoError } from '../server/repo.ts'
import type {
  ChangeRecord,
  InstrumentRecord,
  IssueRecord,
  LaunchedStatus,
  ReviewComment,
  SectionReview,
  TouchAction,
  TrRecord,
} from '../server/types.ts'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DATA = process.env.REVDESK_DATA
  ? path.resolve(process.env.REVDESK_DATA)
  : path.join(ROOT, 'data')

async function main(argv: string[]): Promise<number> {
  const args = [...argv]
  const json = takeFlag(args, '--json')
  const repo = new Repo(DATA)

  try {
    if (args.length === 0 || args[0] === 'help' || args[0] === '--help' || args[0] === '-h') {
      printHelp()
      return 0
    }

    const [cmd, sub, ...rest] = args

    if (cmd === 'status') {
      return emit(json, cmdStatus(repo), formatStatus)
    }

    if (cmd === 'launched') {
      const id = requirePositional(sub ? [sub, ...rest] : rest, 0, 'manual id')
      return emit(json, repo.launched(id), formatLaunched)
    }

    if (cmd === 'ingest' && sub === 'classify') {
      const file = requirePositional(rest, 0, 'pdf or text file')
      const abs = path.resolve(file)
      const report = abs.toLowerCase().endsWith('.txt')
        ? classifyFromText(readFileSync(abs, 'utf8'), {
            filename: path.basename(abs),
            pages: null,
            creator: null,
            producer: null,
          })
        : classifyPdf(abs)
      return emit(json, report, formatClassification)
    }

    if (cmd === 'ingest' && sub === 'scaffold') {
      const opts = parseOpts(rest)
      const catalogId = opts.catalog ?? requirePositional(rest, 0, 'catalog id')
      const out = opts.out ? path.resolve(opts.out) : DATA
      const result = scaffoldCatalog(catalogId, out)
      return emit(json, result, (row) =>
        [`${row.id}  ${row.sections} sections`, `root ${row.root}`, ...row.files.map((f) => `  ${f}`)].join(
          '\n',
        ),
      )
    }

    if (cmd === 'ingest' && sub === 'catalogs') {
      const rows = listCatalogs().map((id) => loadCatalog(id))
      return emit(json, rows, (list) =>
        table(
          ['ID', 'ABBREV', 'SURFACE', 'STYLE', 'LEAVES', 'TITLE'],
          list.map((c) => [
            c.id,
            c.abbrev,
            c.pagination.control_surface,
            c.house_style,
            String(c.leaves.length),
            c.title,
          ]),
        ),
      )
    }

    if (cmd === 'ingest') {
      throw new RepoError(2, 'Usage: revdesk ingest classify <file> | scaffold --catalog <id> [--out dir] | catalogs')
    }

    if (cmd === 'git' && sub === 'status') {
      return emit(json, repo.gitStatus(), formatGitStatus)
    }

    if (cmd === 'git') {
      throw new RepoError(
        2,
        'The only git command is `revdesk git status`. Tags are cut by `issue` / `tr issue` only.',
      )
    }

    if (cmd === 'manual' && sub === 'list') {
      return emit(json, repo.listManuals(), (rows) =>
        table(
          ['ID', 'ABBREV', 'CURRENT', 'NEXT', 'CLASS', 'TITLE'],
          rows.map((m) => [
            m.id,
            m.abbrev,
            m.current_issued ?? '—',
            String(m.next_revision),
            m.control_class,
            m.title,
          ]),
        ),
      )
    }

    if (cmd === 'manual' && sub === 'show') {
      const id = requirePositional(rest, 0, 'manual id')
      return emit(json, repo.getManual(id), formatManual)
    }

    if (cmd === 'change' && sub === 'list') {
      return emit(json, repo.listChanges(), (rows) =>
        table(
          ['ID', 'KIND', 'STATUS', 'MANUAL', 'LAUNCH', 'TOUCHED', 'TITLE'],
          rows.map((c) => [
            c.id,
            c.kind === 'tr' ? 'TR' : c.kind === 'rev' ? 'REV' : 'WIP',
            c.status,
            c.manual,
            c.launch_id ?? '—',
            String(c.touched.length),
            c.title,
          ]),
        ),
      )
    }

    if (cmd === 'change' && sub === 'start') {
      const opts = parseOpts(rest)
      const change = repo.startChange({
        manual: requireOpt(opts, 'manual'),
        title: opts.title ?? (opts.supersedes ? `Supersede ${opts.supersedes}` : ''),
        reasonType: opts['reason-type'],
        reasonRef: opts.ref,
        reason: opts.reason,
        kind: opts.kind,
        sectionIds: collectOpt(rest, 'section'),
        supersedes: opts.supersedes,
      })
      return emit(json, change, formatChange)
    }

    if (cmd === 'change' && sub === 'show') {
      const id = requirePositional(rest, 0, 'change id')
      return emit(json, repo.readChange(id), formatChange)
    }

    if (cmd === 'change' && sub === 'touch') {
      const id = requirePositional(rest, 0, 'change id')
      const opts = parseOpts(rest.slice(1))
      const change = repo.touchChange(
        id,
        requireOpt(opts, 'section'),
        (opts.action as TouchAction) || 'amend',
      )
      return emit(json, change, formatChange)
    }

    if (cmd === 'change' && sub === 'submit') {
      const id = requirePositional(rest, 0, 'change id')
      return emit(json, repo.transition(id, 'submit'), formatChange)
    }

    if (cmd === 'change' && sub === 'approve') {
      const id = requirePositional(rest, 0, 'change id')
      const opts = parseOpts(rest.slice(1))
      return emit(json, repo.transition(id, 'approve', { role: opts.role }), formatChange)
    }

    if (cmd === 'change' && sub === 'withdraw') {
      const id = requirePositional(rest, 0, 'change id')
      const opts = parseOpts(rest.slice(1))
      return emit(json, repo.withdraw(id, requireOpt(opts, 'why')), formatChange)
    }

    if (cmd === 'change' && sub === 'return-to-edit') {
      const id = requirePositional(rest, 0, 'change id')
      return emit(json, repo.returnToEdit(id), formatChange)
    }

    if (cmd === 'change' && sub === 'diff') {
      const id = requirePositional(rest, 0, 'change id')
      const opts = parseOpts(rest.slice(1))
      const change = repo.readChange(id)
      const sectionId = opts.section ?? change.touched[0]?.id
      if (!sectionId) throw new RepoError(2, `${id} has no touched sections.`)
      return emit(json, repo.reviewSection(id, sectionId), formatReviewDiff)
    }

    if (cmd === 'change' && sub === 'comments') {
      const id = requirePositional(rest, 0, 'change id')
      return emit(json, repo.listComments(id), formatComments)
    }

    if (cmd === 'change' && sub === 'comment') {
      const id = requirePositional(rest, 0, 'change id')
      const opts = parseOpts(rest.slice(1))
      const comment = repo.addComment(id, {
        section: requireOpt(opts, 'section'),
        line: Number(opts.line),
        side: opts.side === 'old' ? 'old' : 'new',
        body: requireOpt(opts, 'body'),
      })
      return emit(json, comment, formatComment)
    }

    if (cmd === 'instrument' && sub === 'attach') {
      const id = requirePositional(rest, 0, 'change id')
      const opts = parseOpts(rest.slice(1))
      return emit(
        json,
        repo.attachInstrument(id, {
          file: requireOpt(opts, 'file'),
          type: requireOpt(opts, 'type'),
          authority: requireOpt(opts, 'authority'),
          dated: requireOpt(opts, 'dated'),
          reference: opts.reference,
        }),
        formatChange,
      )
    }

    if (cmd === 'instrument' && sub === 'show') {
      const id = requirePositional(rest, 0, 'change id')
      return emit(json, repo.showInstrument(id), formatInstrument)
    }

    if (cmd === 'section' && sub === 'get') {
      const sectionId = requirePositional(rest, 0, 'section id')
      const opts = parseOpts(rest.slice(1))
      const changeId = requireOpt(opts, 'change')
      const file = repo.getSectionForChange(sectionId, changeId)
      if (opts.out) {
        writeFileSync(path.resolve(opts.out), file.markdown)
        if (json) console.log(JSON.stringify(file, null, 2))
        else console.log(`wrote ${opts.out}`)
        return 0
      }
      return emit(json, file, () => file.markdown.replace(/\n$/, ''))
    }

    if (cmd === 'section' && sub === 'put') {
      const sectionId = requirePositional(rest, 0, 'section id')
      const opts = parseOpts(rest.slice(1))
      const changeId = requireOpt(opts, 'change')
      const filePath = requireOpt(opts, 'file')
      const markdown = readFileSync(path.resolve(filePath), 'utf8')
      const file = repo.putSectionForChange(sectionId, changeId, markdown)
      return emit(json, file, () => `wrote ${file.path}`)
    }

    if (cmd === 'preview') {
      const id = requirePositional(sub ? [sub, ...rest] : rest, 0, 'change id')
      return emit(json, repo.preview(id), formatPreview)
    }

    if (cmd === 'issue' && sub === 'show') {
      const id = requirePositional(rest, 0, 'issue id')
      return emit(json, repo.readIssue(id), formatIssue)
    }

    if (cmd === 'issue') {
      const tokens = sub === undefined ? rest : [sub, ...rest]
      const id = requirePositional(tokens, 0, 'change id')
      const opts = parseOpts(tokens.slice(1))
      return emit(json, repo.issueFull(id, requireOpt(opts, 'effective')), formatIssue)
    }

    if (cmd === 'tr' && sub === 'issue') {
      const id = requirePositional(rest, 0, 'change id')
      const opts = parseOpts(rest.slice(1))
      return emit(
        json,
        repo.issueTr(id, {
          parent: requireOpt(opts, 'parent'),
          authority: requireOpt(opts, 'authority'),
          file: requireOpt(opts, 'file'),
          expires: opts.expires,
        }),
        formatTr,
      )
    }

    if (cmd === 'tr' && sub === 'list') {
      const opts = parseOpts(rest)
      return emit(json, repo.listTrs({ manual: opts.manual }), (rows) =>
        table(
          ['ID', 'STATE', 'PARENT', 'CHANGE', 'AUTHORITY', 'EXPIRES'],
          rows.map((t) => [
            t.id,
            t.state,
            t.parent,
            t.change,
            t.authority,
            t.expires ?? '—',
          ]),
        ),
      )
    }

    if (cmd === 'tr' && sub === 'show') {
      const id = requirePositional(rest, 0, 'tr id')
      return emit(json, repo.readTr(id), formatTr)
    }

    throw new RepoError(2, `Unknown command: ${args.join(' ')}\nRun \`revdesk help\` for usage.`)
  } catch (error) {
    return fail(error, json)
  }
}

function fail(error: unknown, json: boolean): number {
  if (error instanceof RepoError) {
    if (json) console.log(JSON.stringify({ error: error.message, code: error.status }))
    else console.error(`error: ${error.message}`)
    return mapExit(error.status)
  }
  const message = error instanceof Error ? error.message : String(error)
  if (json) console.log(JSON.stringify({ error: message }))
  else console.error(`error: ${message}`)
  return 1
}

function mapExit(status: number): number {
  if (status === 2 || status === 3 || status === 4 || status === 5) return status
  if (status === 404) return 3
  if (status === 403) return 4
  if (status === 400 || status === 409) return 2
  return 1
}

function cmdStatus(repo: Repo) {
  const desk = repo.desk()
  return {
    root: DATA,
    manuals: desk.manuals.map((m) => ({
      id: m.id,
      abbrev: m.abbrev,
      current_issued: m.current_issued,
      next_revision: m.next_revision,
      control_class: m.control_class,
      effective: m.effective,
    })),
    open_changes: desk.changes.filter((c) => c.status !== 'launched' && c.status !== 'withdrawn'),
    issues: desk.issues.slice(0, 5),
    active_trs: desk.trs.filter((t) => t.state === 'launched').slice(0, 10),
  }
}

function formatStatus(data: ReturnType<typeof cmdStatus>): string {
  const lines: string[] = [`revdesk · ${data.root}`, '', 'MANUALS']
  for (const m of data.manuals) {
    lines.push(
      `  ${m.abbrev}  ${m.current_issued ?? '(never launched)'}  next ${m.next_revision}  ${m.control_class}`,
    )
  }
  lines.push('', 'OPEN CHANGES')
  if (!data.open_changes.length) lines.push('  (none)')
  for (const c of data.open_changes) {
    lines.push(`  ${c.id}  ${c.status.padEnd(16)}  ${c.title}`)
  }
  lines.push('', 'ACTIVE TRs')
  if (!data.active_trs.length) lines.push('  (none)')
  for (const t of data.active_trs) {
    lines.push(`  ${t.id}  ${t.parent}  ${t.summary}`)
  }
  lines.push('', 'RECENT FULL ISSUES')
  if (!data.issues.length) lines.push('  (none)')
  for (const i of data.issues) {
    lines.push(`  ${i.id}  eff ${i.effective}  ${i.summary}`)
  }
  return lines.join('\n')
}

function formatLaunched(data: LaunchedStatus): string {
  const lines = [
    `full:       ${data.full ? `${data.full}  launched` : '(none — never launched)'}`,
    `active TRs: ${data.active_trs.length ? data.active_trs.join(', ') : '(none)'}`,
    `next full:  ${data.next_full} (not launched)`,
  ]
  return lines.join('\n')
}

function formatManual(manual: ReturnType<Repo['getManual']>): string {
  const lines = [
    `${manual.abbrev}  ${manual.title}`,
    `id ${manual.id}  ${manual.control_class}  owner ${manual.owner}  authority ${manual.authority}`,
    `current ${manual.current_issued ?? '(none)'}  next_revision ${manual.next_revision}  effective ${manual.effective ?? '—'}`,
    '',
    'SECTIONS',
  ]
  for (const s of manual.sections) {
    const lock = s.open_change ? `  on ${s.open_change}` : ''
    lines.push(`  ${s.id.padEnd(16)}  ${s.rev_last_changed.padEnd(6)}  ${s.title}${lock}`)
  }
  return lines.join('\n')
}

function formatChange(change: ChangeRecord): string {
  const lines = [
    `${change.id}  ${change.status}  ${change.kind === 'tr' ? 'TR' : change.kind === 'rev' ? 'REV' : 'WIP'}`,
    change.title,
    `manual ${change.manual}  author ${change.author}  created ${change.created}`,
    `reason ${change.reason}`,
  ]
  if (change.reason_meta) {
    lines.push(
      `reason-type ${change.reason_meta.type}${change.reason_meta.ref ? `  ref ${change.reason_meta.ref}` : ''}`,
    )
  }
  if (change.supersedes) lines.push(`supersedes ${change.supersedes}`)
  if (change.launch_id) lines.push(`launch ${change.launch_kind} ${change.launch_id}`)
  if (change.instrument) {
    lines.push(
      `instrument ${change.instrument.type}  ${change.instrument.authority}  ${change.instrument.file}`,
    )
    lines.push(`  sha256 ${change.instrument.sha256}`)
  } else {
    lines.push('instrument (none)')
  }
  lines.push('', 'TOUCHED')
  if (!change.touched.length) lines.push('  (none)')
  for (const t of change.touched) {
    lines.push(`  ${t.id}  ${t.action}  ${t.title}`)
    lines.push(`    working ${t.working}`)
  }
  lines.push('', 'HISTORY')
  for (const h of change.history) {
    lines.push(`  ${h.at}  ${h.action}${h.note ? ` — ${h.note}` : ''}`)
  }
  return lines.join('\n')
}

function formatInstrument(inst: InstrumentRecord): string {
  return [
    `${inst.type}  authority ${inst.authority}`,
    `file ${inst.file}`,
    `sha256 ${inst.sha256}`,
    `dated ${inst.dated}${inst.reference ? `  ref ${inst.reference}` : ''}`,
  ].join('\n')
}

function formatReviewDiff(review: SectionReview): string {
  const lines = [
    `DIFF ${review.change.id}  ${review.section.id}  ${review.section.title}`,
    `notes ${review.notes_ref}${review.commit ? `  commit ${review.commit}` : ''}${review.branch ? `  branch ${review.branch}` : ''}`,
    '',
  ]
  for (const row of review.rows) {
    const oldN = row.old_line == null ? '    ' : String(row.old_line).padStart(4)
    const newN = row.new_line == null ? '    ' : String(row.new_line).padStart(4)
    const mark = row.kind === 'add' ? '+' : row.kind === 'del' ? '-' : ' '
    lines.push(`${oldN} ${newN} ${mark} ${row.text}`)
  }
  if (review.comments.length) {
    lines.push('', 'COMMENTS')
    for (const comment of review.comments) lines.push(formatComment(comment))
  }
  return lines.join('\n')
}

function formatComments(rows: ReviewComment[]): string {
  if (!rows.length) return 'No review comments.'
  return rows.map(formatComment).join('\n\n')
}

function formatComment(comment: ReviewComment): string {
  return [
    `${comment.id}  ${comment.section}  ${comment.side}:${comment.line}`,
    `  ${comment.path}`,
    `  ${comment.author}  ${comment.at}`,
    `  ${comment.body}`,
  ].join('\n')
}

function formatPreview(preview: ReturnType<Repo['preview']>): string {
  const lines = [
    `PREVIEW ${preview.change.id}  (${preview.change.status})`,
    `${preview.manual.abbrev} current ${preview.manual.current_issued ?? '(none)'}  next full ${preview.manual.next_revision}`,
    preview.change.title,
    `reason ${preview.change.reason}`,
    '',
  ]
  if (!preview.sections.length) {
    lines.push('No sections touched.')
    return lines.join('\n')
  }
  for (const s of preview.sections) {
    const mark = s.unchanged ? 'unchanged from issued' : 'working differs from issued'
    lines.push(`${s.id}  ${s.action}  ${s.title}`)
    lines.push(`  source ${s.source} (${s.source_rev})`)
    lines.push(`  working ${s.working} (${s.working_rev})  ${mark}`)
  }
  return lines.join('\n')
}

function formatIssue(issue: IssueRecord): string {
  const lines = [
    `${issue.id}  ${issue.kind}  ${issue.state}`,
    issue.summary,
    `revision ${issue.revision}  ${issue.control_class}  effective ${issue.effective}`,
    `change ${issue.change}  supersedes ${issue.supersedes ?? '—'}`,
    `instrument ${issue.instrument.type}  ${issue.instrument.authority}  ${issue.instrument.file}`,
    `  sha256 ${issue.instrument.sha256}`,
    `artifact ${issue.manual_artifact.file}  sha256 ${issue.manual_artifact.sha256}`,
    `git_tag ${issue.git_tag}  source_commit ${issue.source_commit ?? 'null'}${issue.git_skipped ? '  git_skipped' : ''}`,
    `launched_at ${issue.launched_at}`,
  ]
  if (issue.incorporated_trs.length) {
    lines.push(`incorporated_trs ${issue.incorporated_trs.join(', ')}`)
  }
  lines.push('', 'SECTIONS')
  for (const s of issue.sections) {
    lines.push(`  ${s.id.padEnd(16)}  ${s.rev_last_changed.padEnd(6)}  ${s.title}`)
  }
  return lines.join('\n')
}

function formatTr(tr: TrRecord): string {
  return [
    `${tr.id}  ${tr.kind}  ${tr.state}`,
    tr.summary,
    `parent ${tr.parent}  seq ${tr.seq}  change ${tr.change}`,
    `authority ${tr.authority}  expires ${tr.expires ?? '—'}`,
    `incorporated_by ${tr.incorporated_by ?? 'null'}`,
    `instrument ${tr.instrument.type}  ${tr.instrument.file}`,
    `  sha256 ${tr.instrument.sha256}`,
    `git_tag ${tr.git_tag || '(none)'}  source_commit ${tr.source_commit ?? 'null'}${tr.git_skipped ? '  git_skipped' : ''}`,
    `launched_at ${tr.launched_at}`,
  ].join('\n')
}

function formatGitStatus(data: ReturnType<Repo['gitStatus']>): string {
  const lines = [
    `enabled:    ${data.enabled}`,
    `root:       ${data.root ?? '(none)'}`,
    `data:       ${data.data_root}`,
    `config:     ${data.config_path ?? '(none)'}`,
  ]
  lines.push('', 'DIRTY')
  if (!data.dirty.length) lines.push('  (clean)')
  for (const p of data.dirty) lines.push(`  ${p}`)
  if (data.disallowed.length) {
    lines.push('', 'DISALLOWED')
    for (const p of data.disallowed) lines.push(`  ${p}`)
  }
  return lines.join('\n')
}

function emit<T>(json: boolean, data: T, format: (data: T) => string): number {
  if (json) console.log(JSON.stringify(data, null, 2))
  else console.log(format(data))
  return 0
}

function table(headers: string[], rows: string[][]): string {
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] ?? '').length)))
  const fmt = (row: string[]) => row.map((cell, i) => (cell ?? '').padEnd(widths[i])).join('  ')
  return [fmt(headers), fmt(widths.map((w) => '-'.repeat(w))), ...rows.map(fmt)].join('\n')
}

function takeFlag(args: string[], flag: string): boolean {
  const i = args.indexOf(flag)
  if (i === -1) return false
  args.splice(i, 1)
  return true
}

function parseOpts(tokens: string[]): Record<string, string> {
  const opts: Record<string, string> = {}
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i]
    if (!token.startsWith('--')) continue
    const key = token.slice(2)
    const next = tokens[i + 1]
    if (!next || next.startsWith('--')) {
      opts[key] = 'true'
      continue
    }
    opts[key] = next
    i += 1
  }
  return opts
}

function collectOpt(tokens: string[], key: string): string[] {
  const values: string[] = []
  for (let i = 0; i < tokens.length; i += 1) {
    if (tokens[i] !== `--${key}`) continue
    const next = tokens[i + 1]
    if (!next || next.startsWith('--')) continue
    values.push(next)
    i += 1
  }
  return values
}

function requireOpt(opts: Record<string, string>, key: string): string {
  const value = opts[key]?.trim()
  if (!value) throw new RepoError(2, `Missing --${key}`)
  return value
}

function requirePositional(tokens: string[], index: number, label: string): string {
  const value = tokens[index]
  if (!value || value.startsWith('--')) throw new RepoError(2, `Missing ${label}`)
  return value
}

function printHelp(): void {
  console.log(`revdesk — controlled manual desk (file-backed)

Usage:
  revdesk status [--json]
  revdesk launched <manual-id>
  revdesk manual list | show <id>

  revdesk change list
  revdesk change start  --manual <id> --title "..." --section <id>
                        [--section <id> ...] [--kind tr|rev] [--reason "..."] [--reason-type <type>] [--ref <ref>]
                        [--supersedes GOM-Rn]
  revdesk change show | touch | submit | approve | withdraw | return-to-edit
  revdesk change diff     <CHG> [--section <id>]
  revdesk change comments <CHG>
  revdesk change comment  <CHG> --section <id> --line N [--side new|old] --body "..."

  revdesk instrument attach <CHG> --file <path> --type <type> --authority <who> --dated YYYY-MM-DD
  revdesk instrument show   <CHG>

  revdesk section get|put …
  revdesk preview <CHG>

  revdesk issue <CHG> --effective YYYY-MM-DD
  revdesk issue show <GOM-Rn>

  revdesk tr issue <CHG> --parent <GOM-Rn> --authority <who> --file <letter> [--expires YYYY-MM-DD]
  revdesk tr list [--manual gom]
  revdesk tr show <GOM-Rn-TRk>

  revdesk git status

  revdesk ingest catalogs
  revdesk ingest classify <pdf|txt> [--json]
  revdesk ingest scaffold --catalog gom-lep|tp [--out dir]

Exit: 0 ok · 2 validation · 3 not found · 4 not allowed · 5 pipeline
Data root: ${DATA}  (override with REVDESK_DATA)
`)
}

const code = await main(process.argv.slice(2))
process.exit(code)
