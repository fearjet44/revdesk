import type {
  Frontmatter,
  IssueRecord,
  ManagedKind,
  ManualRecord,
  SectionFile,
  SectionSummary,
  TrRecord,
} from './types.ts'

const MANAGED = new Set<ManagedKind>(['ror', 'lep', 'les', 'toc'])

export function isManagedKind(value: string | null | undefined): value is ManagedKind {
  return Boolean(value && MANAGED.has(value as ManagedKind))
}

export function inferManagedKind(title: string, explicit?: string | null): ManagedKind | null {
  const raw = (explicit ?? '').trim().toLowerCase()
  if (isManagedKind(raw)) return raw
  const text = title.trim()
  if (/record of revisions?/i.test(text)) return 'ror'
  if (/list of effective pages/i.test(text)) return 'lep'
  if (/list of effective sections/i.test(text)) return 'les'
  if (/table of contents/i.test(text)) return 'toc'
  return null
}

export function managedOpenError(title: string): string {
  return `${title} is automatically managed and cannot be opened as a working copy.`
}

export type ManagedLeafInput = {
  id: string
  title: string
  rev_last_changed: string
  managed: ManagedKind | null
  lep_start: string | null
}

export type ManagedHydrateInput = {
  manual: ManualRecord
  meta: Frontmatter
  kind: ManagedKind
  leaves: ManagedLeafInput[]
  issues: IssueRecord[]
  trs: TrRecord[]
}

export function hydrateManagedSection(file: SectionFile, input: ManagedHydrateInput): SectionFile {
  const meta: Frontmatter = {
    ...file.meta,
    managed: input.kind,
    lep_start: file.meta.lep_start ?? input.meta.lep_start,
  }
  const body = managedBody(input)
  const markdown = wrapFrontmatter(meta, body)
  return { ...file, meta, markdown, body }
}

function wrapFrontmatter(meta: Frontmatter, body: string): string {
  const lines = [
    '---',
    `id: ${meta.id}`,
    `title: ${meta.title}`,
    `rev_last_changed: ${meta.rev_last_changed}`,
  ]
  if (meta.managed) lines.push(`managed: ${meta.managed}`)
  if (meta.lep_start) lines.push(`lep_start: ${meta.lep_start}`)
  return `${lines.join('\n')}\n---\n\n${body.replace(/^\n+/, '').replace(/\s*$/, '\n')}`
}

function managedBody(input: ManagedHydrateInput): string {
  switch (input.kind) {
    case 'ror':
      return rorBody(input)
    case 'lep':
      return lepBody(input)
    case 'les':
      return lesBody(input)
    case 'toc':
      return tocBody(input)
  }
}

function rorBody(input: ManagedHydrateInput): string {
  const rows = rorRows(input.manual.id, input.issues, input.trs)
  const lines = [
    `# ${input.meta.title}`,
    '',
    'Automatically managed from launched issues. Not an author page.',
    '',
    '| Revision | Effective | Summary |',
    '| --- | --- | --- |',
  ]
  if (!rows.length) {
    lines.push('| — | — | No launched revisions on this book yet. |')
  } else {
    for (const row of rows) {
      lines.push(`| ${esc(row.id)} | ${esc(row.effective)} | ${esc(row.summary)} |`)
    }
  }
  return `${lines.join('\n')}\n`
}

function rorRows(
  manualId: string,
  issues: IssueRecord[],
  trs: TrRecord[],
): Array<{ id: string; effective: string; summary: string }> {
  const full = issues
    .filter((issue) => issue.manual === manualId && issue.state === 'launched')
    .slice()
    .sort((a, b) => a.revision - b.revision)
  const byParent = new Map<string, TrRecord[]>()
  for (const tr of trs.filter((item) => item.manual === manualId)) {
    const list = byParent.get(tr.parent) ?? []
    list.push(tr)
    byParent.set(tr.parent, list)
  }
  const rows: Array<{ id: string; effective: string; summary: string }> = []
  for (const issue of full) {
    rows.push({
      id: issue.id,
      effective: issue.effective,
      summary: issue.summary || `Revision ${issue.revision}`,
    })
    const children = (byParent.get(issue.id) ?? [])
      .slice()
      .sort((a, b) => a.seq - b.seq)
    for (const tr of children) {
      rows.push({
        id: tr.id,
        effective: tr.launched_at.slice(0, 10),
        summary: tr.summary || `Temporary revision ${tr.seq}`,
      })
    }
  }
  return rows
}

function lepBody(input: ManagedHydrateInput): string {
  const slots = input.manual.lep_slots ?? []
  const fallback = bookRev(input.manual)
  const lines = [
    `# ${input.meta.title}`,
    '',
    'Automatically managed from the page ledger. Overflow slots after page flow. Not an author page.',
    '',
    '| Slot | Revision | Section |',
    '| --- | --- | --- |',
  ]
  if (!slots.length) {
    lines.push('| — | — | This book has no page ledger yet. |')
    return `${lines.join('\n')}\n`
  }
  const owners = slotOwners(slots, input.leaves, fallback)
  for (const row of owners) {
    lines.push(`| ${esc(row.slot)} | ${esc(row.rev)} | ${esc(row.section)} |`)
  }
  return `${lines.join('\n')}\n`
}

function lesBody(input: ManagedHydrateInput): string {
  const leaves = authorLeaves(input.leaves)
  const lines = [
    `# ${input.meta.title}`,
    '',
    'Automatically managed from the section map. Not an author page.',
    '',
    '| Section | Revision |',
    '| --- | --- |',
  ]
  if (!leaves.length) {
    lines.push('| — | — |')
  } else {
    for (const leaf of leaves) {
      lines.push(`| ${esc(leaf.title)} | ${esc(leaf.rev_last_changed)} |`)
    }
  }
  return `${lines.join('\n')}\n`
}

function tocBody(input: ManagedHydrateInput): string {
  const leaves = authorLeaves(input.leaves)
  const lines = [
    `# ${input.meta.title}`,
    '',
    'Automatically managed from the section map. Not an author page.',
    '',
    '| Section | Starts |',
    '| --- | --- |',
  ]
  if (!leaves.length) {
    lines.push('| — | — |')
  } else {
    for (const leaf of leaves) {
      const start = leaf.lep_start || inferStart(leaf) || '—'
      lines.push(`| ${esc(leaf.title)} | ${esc(start)} |`)
    }
  }
  return `${lines.join('\n')}\n`
}

function authorLeaves(leaves: ManagedLeafInput[]): ManagedLeafInput[] {
  return leaves.filter((leaf) => !leaf.managed)
}

export function inferStart(leaf: { id: string; title: string; lep_start?: string | null }): string | null {
  if (leaf.lep_start) return leaf.lep_start
  const sectionTitle = leaf.title.match(/^Section\s+(\d+)\b/i)
  if (sectionTitle) return `${sectionTitle[1]}-1`
  const appendixTitle = leaf.title.match(/^Appendix\s+([A-Z])\b/i)
  if (appendixTitle) return `${appendixTitle[1].toUpperCase()}-1`
  const sectionId = leaf.id.match(/-(\d+)$/)
  if (sectionId) return `${sectionId[1]}-1`
  const appendixId = leaf.id.match(/-([a-z])$/)
  if (appendixId) return `${appendixId[1].toUpperCase()}-1`
  return null
}

export function slotOwners(
  slots: string[],
  leaves: ManagedLeafInput[],
  fallbackRev: string,
): Array<{ slot: string; rev: string; section: string }> {
  const indexed = leaves.map((leaf) => ({
    ...leaf,
    start: leaf.lep_start || inferStart(leaf),
  }))
  return slots.map((slot) => {
    const family = slotFamily(slot)
    const owner = indexed
      .filter((leaf) => leaf.start && slotFamily(leaf.start) === family && slotGte(slot, leaf.start))
      .sort((a, b) => slotCompare(a.start ?? '', b.start ?? ''))
      .at(-1)
    if (!owner) return { slot, rev: fallbackRev, section: '—' }
    return { slot, rev: owner.rev_last_changed || fallbackRev, section: owner.title }
  })
}

function bookRev(manual: ManualRecord): string {
  const current = manual.current_issued
  if (!current) return '—'
  const match = current.match(/R(\d+)$/i)
  return match ? `R${match[1]}` : current
}

function slotFamily(slot: string): string {
  if (/^[ivxlcdm]+$/i.test(slot)) return 'roman'
  if (/^c$/i.test(slot) || /^cover$/i.test(slot)) return 'cover'
  const chapter = slot.match(/^(\d+)-(\d+)$/)
  if (chapter) return `ch-${chapter[1]}`
  const letter = slot.match(/^([A-Za-z]+)-(\d+)$/)
  if (letter) return `let-${letter[1].toUpperCase()}`
  return `other-${slot}`
}

function slotGte(a: string, b: string): boolean {
  return slotCompare(a, b) >= 0
}

function slotCompare(a: string, b: string): number {
  const left = slotRank(a)
  const right = slotRank(b)
  if (left.family !== right.family) return left.family.localeCompare(right.family)
  if (left.a !== right.a) return left.a - right.a
  return left.b - right.b
}

function slotRank(slot: string): { family: string; a: number; b: number } {
  if (/^[ivxlcdm]+$/i.test(slot)) return { family: 'roman', a: romanToInt(slot), b: 0 }
  if (/^c$/i.test(slot) || /^cover$/i.test(slot)) return { family: 'cover', a: 0, b: 0 }
  const chapter = slot.match(/^(\d+)-(\d+)$/)
  if (chapter) return { family: `ch-${chapter[1]}`, a: Number(chapter[1]), b: Number(chapter[2]) }
  const letter = slot.match(/^([A-Za-z]+)-(\d+)$/)
  if (letter) return { family: `let-${letter[1].toUpperCase()}`, a: 0, b: Number(letter[2]) }
  return { family: slot, a: 0, b: 0 }
}

function romanToInt(value: string): number {
  const map: Record<string, number> = { i: 1, v: 5, x: 10, l: 50, c: 100, d: 500, m: 1000 }
  const chars = value.toLowerCase().split('')
  let total = 0
  for (let i = 0; i < chars.length; i += 1) {
    const cur = map[chars[i]] ?? 0
    const next = map[chars[i + 1] ?? ''] ?? 0
    total += cur < next ? -cur : cur
  }
  return total
}

function esc(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\n/g, ' ')
}

export function leafFromSection(section: SectionSummary): ManagedLeafInput {
  return {
    id: section.id,
    title: section.title,
    rev_last_changed: section.rev_last_changed,
    managed: section.managed,
    lep_start: section.lep_start,
  }
}
