import { inferStart, slotCompare, slotFamily, slotOwners, type ManagedLeafInput } from './managed.ts'
import type { ControlSurface, ManualRecord, SectionSummary } from './types.ts'

export type OverflowStyle = 'seq' | 'suffix'

export type LedgerPage = {
  slot: string
  seq: number
  rev_content: number
  rev_page: number
  reflow_of: string | null
  dagger: boolean
  overflow: boolean
  omitted: boolean
  printed_as: number | null
}

export type LedgerLeaf = {
  id: string
  title: string
  scheme: string
  letter: string | null
  rev_content: number
  pages: LedgerPage[]
  /** The leaf's lep_start when the ledger was built from the sections. Not written to disk. */
  start?: string | null
}

export type BookLedger = {
  control_surface: ControlSurface
  overflow_style: OverflowStyle
  leaves: LedgerLeaf[]
}

export function parseRevNumber(label: string | null | undefined): number {
  if (!label) return 0
  const match = String(label).match(/(\d+)\s*$/)
  return match ? Number(match[1]) : 0
}

export function formatRevNumber(n: number): string {
  return n > 0 ? `R${n}` : '—'
}

/** A page's revision as the LEP and the page footer print it: revision 0 is the original page. */
export function formatPageRev(n: number): string {
  return n === 0 ? 'Original' : formatRevNumber(n)
}

export function nextSlot(
  slot: string,
  style: OverflowStyle,
  scheme: string,
  letter: string | null,
): string {
  if (style === 'suffix') return nextSuffix(slot)
  if (scheme === 'roman-front' || /^[ivxlcdm]+$/i.test(slot)) {
    const next = toRoman(romanToInt(slot) + 1)
    return /^[IVXLCDM]+$/.test(slot) ? next.toUpperCase() : next
  }
  const chapter = slot.match(/^(\d+)-(\d+)$/)
  if (chapter) return `${chapter[1]}-${Number(chapter[2]) + 1}`
  const section = slot.match(/^([A-Za-z]+(?:-[A-Za-z])?)-(\d+)$/)
  if (section) return `${section[1].toUpperCase()}-${Number(section[2]) + 1}`
  if (/^\d+$/.test(slot)) return String(Number(slot) + 1)
  if (letter && scheme === 'chapter-page') return `${letter}-2`
  if (letter && scheme === 'section-page') return `${letter.toUpperCase()}-2`
  return nextSuffix(slot)
}

function nextSuffix(slot: string): string {
  const match = slot.match(/^(.*?)([a-z])$/i)
  if (match && /[a-z]$/i.test(slot) && !/^[ivxlcdm]+$/i.test(slot)) {
    const letter = match[2].toLowerCase()
    if (letter === 'z') return `${match[1]}aa`
    return `${match[1]}${String.fromCharCode(letter.charCodeAt(0) + 1)}`
  }
  return `${slot}a`
}

export function firstSlot(scheme: string, letter: string | null, fallback: string | null): string {
  if (fallback) return fallback
  if (scheme === 'roman-front') return 'i'
  if (scheme === 'letter-cover') return 'C'
  if (scheme === 'running') return '1'
  if (scheme === 'chapter-page' && letter) return `${letter}-1`
  if (scheme === 'section-page' && letter) return `${letter.toUpperCase()}-1`
  return letter ? `${letter}-1` : '1-1'
}

export function schemeForLeaf(leaf: ManagedLeafInput, regions: Array<{ name: string; scheme: string }>): string {
  const start = leaf.lep_start || inferStart(leaf)
  if (start && /^[ivxlcdm]+$/i.test(start)) return 'roman-front'
  if (start && /^c$/i.test(start)) return 'letter-cover'
  if (start && /^[a-z]$/i.test(start)) return 'letter-cover'
  if (start && /^[A-Z]-/i.test(start) && !/^\d/.test(start)) return 'section-page'
  if (start && /^[A-Z]{1,2}(?:-[A-Z])?-\d/i.test(start)) return 'section-page'
  if (start && /^\d+-\d+$/.test(start)) return 'chapter-page'
  if (leaf.managed === 'ror' || leaf.managed === 'lep' || leaf.managed === 'toc' || leaf.managed === 'les') {
    return 'roman-front'
  }
  if (/^Appendix\s+[A-Z]\b/i.test(leaf.title)) return 'section-page'
  if (/^Section\s+\d+\b/i.test(leaf.title)) return 'chapter-page'
  const body = regions.find((region) => region.name === 'body')
  return body?.scheme || 'chapter-page'
}

export function letterForLeaf(leaf: ManagedLeafInput, scheme: string): string | null {
  const start = leaf.lep_start || inferStart(leaf)
  if (scheme === 'chapter-page') {
    const n = start?.match(/^(\d+)-/) ?? leaf.title.match(/^Section\s+(\d+)\b/i) ?? leaf.id.match(/-(\d+)$/)
    return n ? n[1] : null
  }
  if (scheme === 'section-page') {
    const n =
      start?.match(/^([A-Z]{1,2}(?:-[A-Z])?)-\d/i) ??
      start?.match(/^([A-Z])-/i) ??
      leaf.title.match(/^Appendix\s+([A-Z])\b/i) ??
      leaf.id.match(/-([a-z])$/)
    return n ? n[1].toUpperCase() : null
  }
  return null
}

export function applyPageCount(
  leaf: LedgerLeaf,
  pageCount: number,
  bookRev: number,
  style: OverflowStyle,
): LedgerLeaf {
  if (leaf.scheme === 'none' && !leaf.pages.length) return leaf
  const want = Math.max(1, pageCount)
  const pages = leaf.pages.map((page) => ({ ...page }))
  const visible = () => pages.filter((page) => !page.omitted)
  if (!pages.length) {
    const slot = firstSlot(leaf.scheme, leaf.letter, null)
    pages.push(makePage(slot, 1, leaf.rev_content, bookRev, false, false, null))
  }
  while (visible().length < want) {
    const omitted = pages.find((page) => page.omitted)
    if (omitted) {
      omitted.omitted = false
      continue
    }
    const last = visible().at(-1) ?? pages.at(-1)
    const slot = last
      ? nextSlot(last.slot, style, leaf.scheme, leaf.letter)
      : firstSlot(leaf.scheme, leaf.letter, null)
    const origin = pages.find((page) => !page.overflow)?.slot ?? pages[0]?.slot ?? slot
    pages.push(makePage(slot, pages.length + 1, leaf.rev_content, bookRev, true, true, origin))
  }
  while (visible().length > want) {
    const extra = visible().at(-1)
    if (!extra) break
    extra.omitted = true
  }
  let seq = 0
  for (const page of pages) {
    if (page.omitted) continue
    seq += 1
    page.seq = seq
  }
  return { ...leaf, pages }
}

function makePage(
  slot: string,
  seq: number,
  rev_content: number,
  rev_page: number,
  overflow: boolean,
  dagger: boolean,
  reflow_of: string | null,
): LedgerPage {
  return {
    slot,
    seq,
    rev_content,
    rev_page,
    reflow_of,
    dagger,
    overflow,
    omitted: false,
    printed_as: null,
  }
}

export function stampPrintedAs(ledger: BookLedger): BookLedger {
  let ordinal = 0
  const leaves = ledger.leaves.map((leaf) => ({
    ...leaf,
    pages: leaf.pages.map((page) => {
      if (page.omitted) return { ...page, printed_as: null }
      ordinal += 1
      return { ...page, printed_as: ordinal }
    }),
  }))
  return { ...ledger, leaves }
}

export function effectivePages(ledger: BookLedger): Array<LedgerPage & { leafId: string; title: string }> {
  const rows: Array<LedgerPage & { leafId: string; title: string }> = []
  for (const leaf of ledger.leaves) {
    for (const page of leaf.pages) {
      if (page.omitted) continue
      rows.push({ ...page, leafId: leaf.id, title: leaf.title })
    }
  }
  return rows
}

export function lepRows(
  ledger: BookLedger,
): Array<{ slot: string; rev: string; section: string; dagger: boolean }> {
  return effectivePages(ledger).map((page) => ({
    slot: page.slot,
    rev: formatPageRev(page.rev_page),
    section: page.title,
    dagger: page.dagger,
  }))
}

/** One row of the book's own LEP: the slot as printed, its revision, and the SECTION group it is listed under. */
export type LepSourceRow = { slot: string; rev: number; group: string | null }

export type LepAssignment = {
  /** Pages per leaf id, in LEP order. `rev: null` is a start slot the LEP does not list (takes the leaf's rev). */
  pages: Map<string, Array<{ slot: string; rev: number | null }>>
  /** Slots that went to a leaf, in LEP order. */
  copied: string[]
  held: Array<{ slot: string; reason: string }>
  /** Leaves with no page: no slot in the LEP and no start from the source. */
  unpaginated: string[]
  /** Unpaginated leaves inside one SECTION group's run; the operator sets their lep_start. */
  start_unknown: string[]
}

/**
 * Copy LEP rows onto leaves. Within a SECTION group a slot belongs to the leaf with the greatest start
 * at or before it; a slot never goes to a leaf outside its group. Nothing is guessed: a row with no owner
 * is held, and a leaf with no start and no row stays unpaginated.
 */
export function assignLepRows(rows: LepSourceRow[], leaves: ManagedLeafInput[]): LepAssignment {
  const out: LepAssignment = { pages: new Map(), copied: [], held: [], unpaginated: [], start_unknown: [] }
  const seen = new Set<string>()
  const unique: LepSourceRow[] = []
  for (const row of rows) {
    if (seen.has(row.slot)) {
      out.held.push({ slot: row.slot, reason: 'listed twice in the LEP' })
      continue
    }
    seen.add(row.slot)
    unique.push(row)
  }

  // Each group's slots per family, as a rank interval, in LEP order.
  const groupKey = (row: LepSourceRow) => (row.group ?? '').replace(/\s+/g, ' ').trim().toUpperCase()
  const runs: Array<{ key: string; family: string; min: string; max: string }> = []
  for (const row of unique) {
    const key = groupKey(row)
    const family = slotFamily(row.slot)
    const run = runs.find((r) => r.key === key && r.family === family)
    if (!run) runs.push({ key, family, min: row.slot, max: row.slot })
    else {
      if (slotCompare(row.slot, run.min) < 0) run.min = row.slot
      if (slotCompare(row.slot, run.max) > 0) run.max = row.slot
    }
  }
  const starts = leaves.map((leaf) => ({ leaf, start: leaf.lep_start || inferStart(leaf) || null }))
  const runFor = (start: string) => {
    const family = slotFamily(start)
    const inFamily = runs.filter((r) => r.family === family)
    return (
      inFamily.find((r) => slotCompare(r.min, start) <= 0 && slotCompare(start, r.max) <= 0) ??
      inFamily
        .filter((r) => slotCompare(r.min, start) > 0)
        .sort((a, b) => slotCompare(a.min, b.min))[0] ??
      null
    )
  }
  const members = new Map<string, Array<{ id: string; start: string }>>()
  for (const { leaf, start } of starts) {
    if (!start) continue
    const run = runFor(start)
    if (!run) continue
    const id = `${run.key}\u0000${run.family}`
    members.set(id, [...(members.get(id) ?? []), { id: leaf.id, start }])
  }

  const groupOf = new Map<string, string>()
  for (const row of unique) {
    const candidates = (members.get(`${groupKey(row)}\u0000${slotFamily(row.slot)}`) ?? []).filter(
      (m) => slotCompare(m.start, row.slot) <= 0,
    )
    const owner = candidates.sort((a, b) => slotCompare(a.start, b.start)).at(-1)
    if (!owner) {
      out.held.push({ slot: row.slot, reason: 'no leaf in its LEP group starts at or before this page' })
      continue
    }
    out.pages.set(owner.id, [...(out.pages.get(owner.id) ?? []), { slot: row.slot, rev: row.rev }])
    out.copied.push(row.slot)
    if (!groupOf.has(owner.id)) groupOf.set(owner.id, groupKey(row))
  }

  // A start the LEP does not list still places the leaf, unless another leaf already has that slot.
  const taken = new Set(out.copied)
  for (const { leaf, start } of starts) {
    if (out.pages.has(leaf.id)) continue
    if (start && !taken.has(start)) {
      out.pages.set(leaf.id, [{ slot: start, rev: null }])
      taken.add(start)
      continue
    }
    out.unpaginated.push(leaf.id)
  }

  for (let i = 0; i < leaves.length; i += 1) {
    if (!out.unpaginated.includes(leaves[i].id) || (starts[i].start && taken.has(starts[i].start!))) continue
    const before = leaves.slice(0, i).reverse().find((leaf) => groupOf.has(leaf.id))
    const after = leaves.slice(i + 1).find((leaf) => groupOf.has(leaf.id))
    if (before && after && groupOf.get(before.id) === groupOf.get(after.id)) out.start_unknown.push(leaves[i].id)
  }
  return out
}

export function seedLedger(
  manual: ManualRecord,
  sections: SectionSummary[],
  options: { lep?: LepSourceRow[] } = {},
): BookLedger {
  const surface = manual.pagination?.control_surface ?? 'rev-only'
  const style: OverflowStyle = 'seq'
  const bookRev = parseRevNumber(manual.current_issued) || parseRevNumber(sections[0]?.rev_last_changed)
  const leavesInput: ManagedLeafInput[] = sections.map((section) => ({
    id: section.id,
    title: section.title,
    rev_last_changed: section.rev_last_changed,
    managed: section.managed,
    lep_start: section.lep_start,
  }))
  const regions = manual.pagination?.regions ?? []

  if (surface === 'lep' && options.lep?.length) {
    const copy = assignLepRows(options.lep, leavesInput)
    const leaves: LedgerLeaf[] = sections.map((section, index) => {
      const input = leavesInput[index]
      const rev = parseRevNumber(section.rev_last_changed) || bookRev
      const start = section.lep_start || inferStart(input) || null
      const owned = copy.pages.get(section.id)
      if (!owned?.length) {
        return { id: section.id, title: section.title, scheme: 'none', letter: null, rev_content: rev, pages: [], start }
      }
      const placed = { ...input, lep_start: start ?? owned[0].slot }
      const scheme = schemeForLeaf(placed, regions)
      const pages = owned.map((page, seq) =>
        makePage(page.slot, seq + 1, page.rev ?? rev, page.rev ?? rev, false, false, null),
      )
      return { id: section.id, title: section.title, scheme, letter: letterForLeaf(placed, scheme), rev_content: rev, pages, start }
    })
    return { control_surface: 'lep', overflow_style: style, leaves }
  }

  if (surface !== 'lep') {
    return {
      control_surface: surface,
      overflow_style: style,
      leaves: sections.map((section) => {
        const input = leavesInput.find((row) => row.id === section.id) ?? {
          id: section.id,
          title: section.title,
          rev_last_changed: section.rev_last_changed,
          managed: section.managed,
          lep_start: section.lep_start,
        }
        const scheme = schemeForLeaf(input, regions)
        return {
          id: section.id,
          title: section.title,
          scheme,
          letter: letterForLeaf(input, scheme),
          rev_content: parseRevNumber(section.rev_last_changed) || bookRev,
          pages: [],
          start: section.lep_start || inferStart(input) || null,
        }
      }),
    }
  }

  const owners = slotOwners(manual.lep_slots ?? [], leavesInput, formatRevNumber(bookRev))
  const byLeaf = new Map<string, LedgerPage[]>()
  for (const section of sections) byLeaf.set(section.id, [])
  for (const row of owners) {
    const leaf = leavesInput.find((item) => item.title === row.section)
    if (!leaf) continue
    const list = byLeaf.get(leaf.id) ?? []
    const rev = parseRevNumber(row.rev) || bookRev
    list.push(makePage(row.slot, list.length + 1, rev, rev, false, false, null))
    byLeaf.set(leaf.id, list)
  }

  const leaves: LedgerLeaf[] = sections.map((section) => {
    const input = leavesInput.find((row) => row.id === section.id)!
    const scheme = schemeForLeaf(input, regions)
    const letter = letterForLeaf(input, scheme)
    const rev = parseRevNumber(section.rev_last_changed) || bookRev
    let pages = byLeaf.get(section.id) ?? []
    const start = section.lep_start || inferStart(input) || null
    if (!pages.length) {
      pages = [makePage(firstSlot(scheme, letter, start), 1, rev, rev, false, false, null)]
    }
    return { id: section.id, title: section.title, scheme, letter, rev_content: rev, pages, start }
  })

  return { control_surface: 'lep', overflow_style: style, leaves }
}

export function parseLedger(raw: unknown, fallback: BookLedger): BookLedger {
  if (!raw || typeof raw !== 'object') return fallback
  const rec = raw as Record<string, unknown>
  const surface =
    rec.control_surface === 'lep' || rec.control_surface === 'les' || rec.control_surface === 'rev-only'
      ? rec.control_surface
      : fallback.control_surface
  const overflow_style: OverflowStyle = rec.overflow_style === 'suffix' ? 'suffix' : 'seq'
  const rows = Array.isArray(rec.leaves) ? rec.leaves : []
  const leaves: LedgerLeaf[] = rows.map((item, index) => {
    const row = (item ?? {}) as Record<string, unknown>
    const pages = Array.isArray(row.pages)
      ? row.pages.map((page, seq) => parsePage(page, seq + 1))
      : []
    return {
      id: String(row.id ?? fallback.leaves[index]?.id ?? `leaf-${index}`),
      title: String(row.title ?? fallback.leaves[index]?.title ?? ''),
      scheme: String(row.scheme ?? fallback.leaves[index]?.scheme ?? 'chapter-page'),
      letter: row.letter == null || row.letter === '' ? null : String(row.letter),
      rev_content: Number(row.rev_content ?? fallback.leaves[index]?.rev_content ?? 0),
      pages,
    }
  })
  if (!leaves.length) return { ...fallback, control_surface: surface, overflow_style }
  if (surface === 'lep') placeNewStarts(leaves, fallback)
  return { control_surface: surface, overflow_style, leaves }
}

/**
 * An unpaginated leaf whose lep_start has since been set takes its slot from that start, and the
 * slots after it that the leaf before it held (greatest start at or before the slot owns it).
 */
function placeNewStarts(leaves: LedgerLeaf[], fallback: BookLedger): void {
  for (const leaf of leaves) {
    if (leaf.scheme !== 'none' || leaf.pages.length) continue
    const seeded = fallback.leaves.find((item) => item.id === leaf.id)
    const start = seeded?.start
    if (!start) continue
    const family = slotFamily(start)
    const sameRun = (slot: string) => slotFamily(slot) === family && slotCompare(slot, start) >= 0
    const startsHere = (other: LedgerLeaf) => other.pages[0] && slotFamily(other.pages[0].slot) === family && slotCompare(other.pages[0].slot, start) === 0
    if (leaves.some(startsHere)) continue
    const moved: LedgerPage[] = []
    for (const other of leaves) {
      const first = other.pages[0]
      if (other === leaf || !first || slotFamily(first.slot) !== family || slotCompare(first.slot, start) >= 0) continue
      moved.push(...other.pages.filter((page) => sameRun(page.slot)))
      other.pages = other.pages.filter((page) => !sameRun(page.slot)).map((page, i) => ({ ...page, seq: i + 1 }))
    }
    if (!moved.some((page) => page.slot === start)) {
      moved.unshift(makePage(start, 1, leaf.rev_content, leaf.rev_content, false, false, null))
    }
    moved.sort((a, b) => slotCompare(a.slot, b.slot))
    leaf.pages = moved.map((page, i) => ({ ...page, seq: i + 1 }))
    leaf.scheme = seeded.scheme
    leaf.letter = seeded.letter
  }
}

function parsePage(raw: unknown, seq: number): LedgerPage {
  const row = (raw ?? {}) as Record<string, unknown>
  return {
    slot: String(row.slot ?? ''),
    seq: Number(row.seq ?? seq),
    rev_content: Number(row.rev_content ?? 0),
    rev_page: Number(row.rev_page ?? row.rev_content ?? 0),
    reflow_of: row.reflow_of == null || row.reflow_of === '' ? null : String(row.reflow_of),
    dagger: Boolean(row.dagger),
    overflow: Boolean(row.overflow),
    omitted: Boolean(row.omitted),
    printed_as: row.printed_as == null || row.printed_as === '' ? null : Number(row.printed_as),
  }
}

export function ledgerOnDisk(ledger: BookLedger): Record<string, unknown> {
  return {
    control_surface: ledger.control_surface,
    overflow_style: ledger.overflow_style,
    leaves: ledger.leaves.map((leaf) => ({
      id: leaf.id,
      title: leaf.title,
      scheme: leaf.scheme,
      letter: leaf.letter,
      rev_content: leaf.rev_content,
      pages: leaf.pages.map((page) => ({
        slot: page.slot,
        seq: page.seq,
        rev_content: page.rev_content,
        rev_page: page.rev_page,
        reflow_of: page.reflow_of,
        dagger: page.dagger,
        overflow: page.overflow,
        omitted: page.omitted,
        printed_as: page.printed_as,
      })),
    })),
  }
}

export function applyCounts(
  ledger: BookLedger,
  counts: Map<string, number>,
  bookRev: number,
): BookLedger {
  if (ledger.control_surface !== 'lep') return ledger
  const leaves = ledger.leaves.map((leaf) => {
    const n = counts.get(leaf.id)
    if (n == null) return leaf
    return applyPageCount(leaf, n, bookRev, ledger.overflow_style)
  })
  return stampPrintedAs({ ...ledger, leaves })
}

function toRoman(num: number): string {
  if (num <= 0) return 'i'
  const map: Array<[number, string]> = [
    [1000, 'm'],
    [900, 'cm'],
    [500, 'd'],
    [400, 'cd'],
    [100, 'c'],
    [90, 'xc'],
    [50, 'l'],
    [40, 'xl'],
    [10, 'x'],
    [9, 'ix'],
    [5, 'v'],
    [4, 'iv'],
    [1, 'i'],
  ]
  let n = num
  let out = ''
  for (const [value, glyph] of map) {
    while (n >= value) {
      out += glyph
      n -= value
    }
  }
  return out
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

export function leafSlots(ledger: BookLedger | null, sectionId: string): LedgerPage[] {
  if (!ledger) return []
  return ledger.leaves.find((leaf) => leaf.id === sectionId)?.pages.filter((page) => !page.omitted) ?? []
}
