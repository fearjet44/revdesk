import mammoth from 'mammoth'
import { parseBody, serializeBody, type JSONContent, type Mark } from '../../src/schema/markdown.ts'
import { FIGURE_MAX_BYTES, figureName } from '../figures.ts'
import { inferManagedKind } from '../managed.ts'
import { RepoError } from '../repo.ts'
import type { ManagedKind } from '../types.ts'
import type { DroppedLine } from './report.ts'

/* ---------- The slice of mammoth's document model this importer reads ---------- */

export type DocxNode = {
  type: string
  children?: DocxNode[]
  value?: string
  styleName?: string | null
  numbering?: { level: string | number; isOrdered: boolean } | null
  isBold?: boolean
  isItalic?: boolean
  isUnderline?: boolean
  fontSize?: number | null
  breakType?: string
  colSpan?: number
  rowSpan?: number
  contentType?: string
  altText?: string
  read?: () => Promise<Buffer>
}

export type DocxModel = { doc: DocxNode; raw: string; ignored: string[] }

/** mammoth's document model. The HTML it also renders is thrown away. */
export async function readDocx(bytes: Buffer): Promise<DocxModel> {
  let captured: DocxNode | null = null
  let result: { messages: Array<{ message: string }> }
  try {
    result = await mammoth.convertToHtml(
      { buffer: bytes },
      {
        transformDocument: (doc: DocxNode) => {
          captured = doc
          return doc
        },
      },
    )
  } catch (error) {
    throw new RepoError(2, `This Word file could not be read: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (!captured) throw new RepoError(5, 'The Word reader returned no document.')
  const ignored = result.messages
    .map((m) => m.message.match(/unrecognised element was ignored: (.+)$/i)?.[1])
    .filter((name): name is string => Boolean(name))
  return { doc: captured, raw: await docxRawText(bytes), ignored }
}

export async function docxRawText(bytes: Buffer): Promise<string> {
  try {
    return (await mammoth.extractRawText({ buffer: bytes })).value
  } catch (error) {
    throw new RepoError(2, `This Word file could not be read: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/* ---------- Flattened blocks ---------- */

type Seg = { text: string; bold: boolean; italic: boolean; underline: boolean }

type Para = {
  kind: 'para'
  /** Text with line breaks as \n and tabs as \t. */
  text: string
  segs: Seg[]
  style: string
  numbering: { level: number; ordered: boolean } | null
  bold: boolean
  size: number | null
  top: boolean
  dropped?: DroppedLine['reason']
}

type Img = { kind: 'image'; contentType: string; altText: string; read?: () => Promise<Buffer> }

type Cell = { blocks: Block[]; colSpan: number; rowSpan: number }

type Tbl = { kind: 'table'; rows: Cell[][] }

type Block = Para | Img | Tbl

function flatten(nodes: DocxNode[], top: boolean): Block[] {
  const out: Block[] = []
  for (const node of nodes) {
    if (node.type === 'paragraph') out.push(...flattenParagraph(node, top))
    else if (node.type === 'table') out.push(flattenTable(node))
    else if (node.type === 'image') out.push(image(node))
    else if (node.children) out.push(...flatten(node.children, top))
  }
  return out
}

function image(node: DocxNode): Img {
  return { kind: 'image', contentType: node.contentType ?? '', altText: node.altText ?? '', read: node.read }
}

function flattenTable(node: DocxNode): Tbl {
  const rows = (node.children ?? [])
    .filter((row) => row.type === 'tableRow')
    .map((row) =>
      (row.children ?? [])
        .filter((cell) => cell.type === 'tableCell')
        .map((cell) => ({
          blocks: flatten(cell.children ?? [], false),
          colSpan: Math.max(1, cell.colSpan ?? 1),
          rowSpan: Math.max(1, cell.rowSpan ?? 1),
        })),
    )
  return { kind: 'table', rows }
}

/** A paragraph, then its pictures, then anything nested in it (text boxes). */
function flattenParagraph(node: DocxNode, top: boolean): Block[] {
  const segs: Seg[] = []
  const images: Img[] = []
  const nested: Block[] = []
  const sizes = new Map<number, number>()
  const visit = (child: DocxNode, run: DocxNode | null) => {
    if (child.type === 'paragraph' || child.type === 'table') {
      nested.push(...flatten([child], top))
      return
    }
    if (child.type === 'image') {
      images.push(image(child))
      return
    }
    const marks = {
      bold: Boolean(run?.isBold),
      italic: Boolean(run?.isItalic),
      underline: Boolean(run?.isUnderline),
    }
    if (child.type === 'text') {
      segs.push({ text: child.value ?? '', ...marks })
      if (run?.fontSize && child.value?.trim()) {
        sizes.set(run.fontSize, (sizes.get(run.fontSize) ?? 0) + child.value.length)
      }
      return
    }
    if (child.type === 'tab') {
      segs.push({ text: '\t', ...marks })
      return
    }
    if (child.type === 'break') {
      segs.push({ text: '\n', ...marks })
      return
    }
    const nextRun = child.type === 'run' ? child : run
    for (const grand of child.children ?? []) visit(grand, nextRun)
  }
  for (const child of node.children ?? []) visit(child, null)
  const text = segs.map((s) => s.text).join('')
  const visible = segs.filter((s) => s.text.trim())
  let size: number | null = null
  let best = 0
  for (const [pt, n] of sizes) {
    if (n > best) {
      best = n
      size = pt
    }
  }
  const para: Para = {
    kind: 'para',
    text,
    segs,
    style: node.styleName ?? '',
    numbering: node.numbering
      ? { level: Number(node.numbering.level) || 0, ordered: node.numbering.isOrdered !== false }
      : null,
    bold: visible.length > 0 && visible.every((s) => s.bold),
    size,
    top,
  }
  return [para, ...images, ...nested]
}

/* ---------- Text helpers ---------- */

function collapse(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

/** Collapsed, but tabs kept: Word TOCs use tab leaders. */
function tabbed(text: string): string {
  return text.replace(/[^\S\t]+/g, ' ').replace(/ ?\t[\t ]*/g, '\t').trim()
}

/** Comparison key: letters and digits only, upper-case. */
export function matchKey(text: string): string {
  return text
    .normalize('NFKC')
    .toUpperCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

const PAGE_REF = String.raw`(?:[A-Z]{1,3}(?:-[A-Z]{1,2})?-\d+[a-z]?|\d+-\d+|[IVXLC]{1,7}|[ivxlc]{1,7}|\d{1,4})`
const TOC_ENTRY = new RegExp(String.raw`(\S.*?)(?:\s*\.{2,}\s*|[ \t]*\t[ \t]*)(${PAGE_REF})(?=\s|$)`, 'g')
const ROMAN = /^(?=[ivxlc]+$)(?:x{0,3}l?|xl)(?:ix|iv|v?i{0,3})$/i

function romanValue(token: string): number {
  const values: Record<string, number> = { i: 1, v: 5, x: 10, l: 50, c: 100 }
  const chars = token.toLowerCase().split('')
  return chars.reduce((n, ch, i) => {
    const v = values[ch] ?? 0
    return (values[chars[i + 1]] ?? 0) > v ? n - v : n + v
  }, 0)
}

export function isRoman(token: string): boolean {
  return token.length > 0 && ROMAN.test(token)
}

const PAGE_LABEL = [/^\d+-\d+$/, /^[A-Z]{1,2}(-[A-Z])?-\d+$/, /^[ivxlc]+$/i, /^Page \d+( of \d+)?$/i]
const REVISION_FOOTER = [/Revision \d+ \d{2}-[A-Za-z]{3}-\d{4}/i, /\bRevision:?\s+\S+.*\bPage:?\s*[A-Za-z0-9-]+$/i]

const SECTION_LINE =
  /^(?:SECTION|Section)\s+(\d{1,2}|[A-Z]{1,2}(?:\s*(?:THRU|Thru|thru|THROUGH|through|[-–—])\s*[A-Z]{1,2})?)(?![\p{L}\p{N}])\s*[:.\-–—]?\s*(.*)$/u
const APPENDIX_LINE = /^(?:APPENDIX|Appendix)\s+([A-Z]{1,2}|\d{1,2})(?![\p{L}\p{N}])\s*[:.\-–—]?\s*(.*)$/u
const BULLETIN_LINE = /^(?:[A-Z][A-Za-z]{1,10}\s+)?bulletin\s+(?:no\.?|number|#)\s*\d+[a-z]?$/i
const FRONT_TITLE =
  /^(record of revisions?|list of effective pages|list of effective sections|table of contents|source of training document|transmittal(?: sheet| letter)?|highlights(?: of (?:the )?changes?)?|revision acknowledge?ments?|table of bulletins(?: \(tob\))?)$/i
const CALLOUT = /^\s*(NOTE|CAUTION|WARNING)\s*(?::\s*|\n\s*|$)/i
const TYPED_NUMBER = /^\s*(\()?(\d{1,3}|[A-Za-z]|[ivxlc]{2,6}|[IVXLC]{2,6})(\.\)|\)|\.)\s+/
const TYPED_BULLET = /^\s*([•·▪○◦\-–])\s+/
const NUMBERED_HEADING = /^(\d+(?:\.\d+)+)\s+\S/

function sectionNumber(raw: string): string {
  const parts = raw.split(/\s*(?:THRU|THROUGH|[-–—])\s*/i).filter(Boolean)
  return parts.map((p) => p.toUpperCase()).join('-')
}

/* ---------- TOC ---------- */

export type TocEntry = { title: string; key: string; page: string; level: number; styled: boolean; used?: boolean }

export function parseTocLine(text: string): { entries: Array<{ title: string; page: string }>; rest: string } {
  const entries: Array<{ title: string; page: string }> = []
  let last = 0
  TOC_ENTRY.lastIndex = 0
  for (const match of text.matchAll(TOC_ENTRY)) {
    entries.push({ title: collapse(match[1]).replace(/[\s.]+$/, ''), page: match[2] })
    last = (match.index ?? 0) + match[0].length
  }
  return { entries, rest: collapse(text.slice(last)) }
}

function findToc(blocks: Block[]): { start: number; end: number; entries: TocEntry[] } | null {
  const start = blocks.findIndex((b) => b.kind === 'para' && b.top && /^table of contents$/i.test(collapse(b.text)))
  if (start === -1) return null
  const entries: TocEntry[] = []
  let pending = ''
  let pendingLevel = 1
  let end = start + 1
  for (let i = start + 1; i < blocks.length; i += 1) {
    const block = blocks[i]
    if (block.kind !== 'para') break
    const text = tabbed(block.text)
    if (!text) {
      end = i + 1
      continue
    }
    const level = Number(block.style.match(/^TOC\s*(\d)/i)?.[1] ?? 0)
    const parsed = parseTocLine(pending ? `${pending} ${text}` : text)
    if (!parsed.entries.length && !level) {
      if (pending || !entries.length) break
      pending = text
      pendingLevel = 1
      end = i + 1
      continue
    }
    for (const entry of parsed.entries) {
      entries.push({ ...entry, key: matchKey(entry.title), level: pending ? pendingLevel : level || 1, styled: level > 0 })
      pending = ''
    }
    if (parsed.rest) {
      pending = parsed.rest
      pendingLevel = level || 1
    }
    end = i + 1
  }
  return { start, end, entries }
}

/* ---------- Leaves ---------- */

export type DocxSectionRef = { kind: 'front' | 'section' | 'appendix'; number: string | null; start: string | null }

export type DocxLeafDraft = {
  kind: 'front' | 'section' | 'appendix'
  number: string | null
  title: string
  start: string
  head: string | null
  managed: ManagedKind | null
  bulletin: boolean
  cover: boolean
  blocks: Block[]
}

export type DocxLeaf = {
  kind: 'front' | 'section' | 'appendix'
  number: string | null
  title: string
  start: string
  managed: ManagedKind | null
  bulletin: boolean
  doc: JSONContent
  markdown: string
  source: string[]
  converted: string[]
  flattened: number
  figures: PendingFigure[]
  placeholders: Array<{ name: string; content_type: string; reason: string }>
  managed_figures: number
}

export type PendingFigure = { name: string; ext: string; bytes: Buffer }

export type DocxWalk = {
  leaves: DocxLeaf[]
  dropped: DroppedLine[]
  regions: Array<{ name: string; scheme: 'letter-cover' | 'roman-front' | 'section-page' | 'chapter-page'; slots?: string[] }>
  lep_rows: string[]
  lep_unmatched: string[]
  revision: { number: number | null; date: string | null }
  stats: {
    asterisks: number
    table_pipes: number
    guarded_line_starts: number
    marks_dropped: number
    typed_numbers: number
    callout_labels: number
  }
}

export type WalkOptions = { sections?: DocxSectionRef[] }

export async function walkDocx(root: DocxNode, options: WalkOptions = {}): Promise<DocxWalk> {
  const blocks = flatten(root.children ?? [], true)
  markRunningLines(blocks)
  const toc = findToc(blocks)
  const entries = toc?.entries ?? []
  const median = medianSize(blocks)
  const drafts = splitLeaves(blocks, toc, entries)
  const dropped = droppedLines(blocks)
  const sectionPrefixes = new Set<string>()
  for (const draft of drafts) {
    if (draft.kind === 'front' || !draft.number) continue
    const classified = options.sections?.find((s) => s.kind === draft.kind && s.number === draft.number)
    const fromToc = entries.find((e) => draft.head && e.key === matchKey(draft.head.split(/:\s/)[0]))
    draft.start = classified?.start ?? (fromToc && !isRoman(fromToc.page) ? fromToc.page : '')
    if (draft.start) sectionPrefixes.add(draft.start.replace(/-\d+[a-z]?$/, ''))
  }

  const lep = lepSlots(drafts, sectionPrefixes)
  const cover = drafts.find((d) => d.cover)
  if (cover && lep.cover.length) cover.start = lep.cover[0]

  const stats: DocxWalk['stats'] = {
    asterisks: 0,
    table_pipes: 0,
    guarded_line_starts: 0,
    marks_dropped: 0,
    typed_numbers: 0,
    callout_labels: 0,
  }
  const imageCounter = { n: 0 }
  const leaves: DocxLeaf[] = []
  for (const draft of drafts) {
    leaves.push(await buildLeaf(draft, { entries, median, stats, imageCounter }))
  }

  const regions: DocxWalk['regions'] = []
  if (lep.cover.length) regions.push({ name: 'cover', scheme: 'letter-cover', slots: lep.cover })
  if (lep.roman.length) {
    const roman = [...lep.roman].sort((a, b) => romanValue(a) - romanValue(b))
    regions.push({ name: 'front-matter', scheme: 'roman-front', slots: roman })
  }
  if (lep.chapter) regions.push({ name: 'body', scheme: 'chapter-page' })
  if (lep.section) regions.push({ name: lep.chapter ? 'appendix' : 'body', scheme: 'section-page' })

  return {
    leaves,
    dropped,
    regions,
    lep_rows: lep.rows,
    lep_unmatched: lep.unmatched,
    revision: coverRevision(drafts),
    stats,
  }
}

function markRunningLines(blocks: Block[]): void {
  const counts = new Map<string, number>()
  const candidates = blocks.filter(
    (b): b is Para => b.kind === 'para' && b.top && !b.numbering && collapse(b.text).length > 0 && collapse(b.text).length <= 80,
  )
  for (const para of candidates) {
    const key = collapse(para.text)
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  for (const para of candidates) {
    const key = collapse(para.text)
    if (PAGE_LABEL.some((re) => re.test(key))) para.dropped = 'page-label'
    else if (REVISION_FOOTER.some((re) => re.test(key))) para.dropped = 'revision-footer'
    else if ((counts.get(key) ?? 0) >= 3) para.dropped = 'repeats'
  }
}

function droppedLines(blocks: Block[]): DroppedLine[] {
  const rows = new Map<string, DroppedLine>()
  for (const block of blocks) {
    if (block.kind !== 'para' || !block.dropped) continue
    const text = collapse(block.text)
    const row = rows.get(text) ?? { text, count: 0, reason: block.dropped }
    row.count += 1
    rows.set(text, row)
  }
  return [...rows.values()]
}

function medianSize(blocks: Block[]): number {
  const weighted: Array<[number, number]> = []
  for (const block of blocks) {
    if (block.kind !== 'para' || !block.top || block.size === null) continue
    weighted.push([block.size, collapse(block.text).length])
  }
  if (!weighted.length) return 0
  weighted.sort((a, b) => a[0] - b[0])
  const total = weighted.reduce((n, [, w]) => n + w, 0)
  let seen = 0
  for (const [size, w] of weighted) {
    seen += w
    if (seen >= total / 2) return size
  }
  return weighted[weighted.length - 1][0]
}

function nextText(blocks: Block[], from: number): { index: number; para: Para } | null {
  for (let i = from; i < blocks.length; i += 1) {
    const block = blocks[i]
    if (block.kind !== 'para') return null
    if (block.dropped) continue
    if (collapse(block.text)) return { index: i, para: block }
  }
  return null
}

function titleLike(para: Para): boolean {
  const text = collapse(para.text)
  if (!text || text.length > 120 || para.numbering) return false
  if (SECTION_LINE.test(text) || APPENDIX_LINE.test(text)) return false
  const letters = text.replace(/[^\p{L}]/gu, '')
  const upper = letters.replace(/[^\p{Lu}]/gu, '').length
  return para.bold || /^(heading|title)/i.test(para.style) || (letters.length > 0 && upper / letters.length >= 0.8)
}

function splitLeaves(blocks: Block[], toc: ReturnType<typeof findToc>, entries: TocEntry[]): DocxLeafDraft[] {
  const drafts: DocxLeafDraft[] = []
  let current: DocxLeafDraft = {
    kind: 'front',
    number: null,
    title: 'Cover',
    start: '',
    head: null,
    managed: null,
    bulletin: false,
    cover: true,
    blocks: [],
  }
  const used = new Set<string>()
  const tocEnd = toc ? toc.end : 0
  // A styled TOC with no Section/Appendix entries is chaptered: its top entries are leaves.
  const chaptered =
    entries.some((e) => e.styled) && !entries.some((e) => SECTION_LINE.test(e.title) || APPENDIX_LINE.test(e.title))
  const open = (draft: Omit<DocxLeafDraft, 'blocks' | 'cover' | 'bulletin' | 'managed'> & { bulletin?: boolean }) => {
    drafts.push(current)
    current = {
      ...draft,
      bulletin: draft.bulletin ?? false,
      cover: false,
      managed: draft.kind === 'front' ? inferManagedKind(draft.title) : null,
      blocks: [],
    }
  }

  for (let i = 0; i < blocks.length; i += 1) {
    const block = blocks[i]
    if (block.kind !== 'para' || !block.top) {
      current.blocks.push(block)
      continue
    }
    const text = collapse(block.text)
    const key = matchKey(text)
    const afterToc = !toc || i >= tocEnd
    const isEntryLine = parseTocLine(tabbed(block.text)).entries.length > 0

    if (text && text.length <= 120 && !isEntryLine) {
      const section = afterToc ? text.match(SECTION_LINE) : null
      const appendix = afterToc && !section ? text.match(APPENDIX_LINE) : null
      const hit = section ?? appendix
      if (hit) {
        const kind = section ? 'section' : 'appendix'
        const number = section ? sectionNumber(hit[1]) : hit[1].toUpperCase()
        const id = `${kind}:${number}`
        if (!used.has(id)) {
          used.add(id)
          block.dropped = undefined
          let title = collapse(hit[2]).replace(/^[:.\-–—\s]+/, '')
          let head = text
          const parts: Block[] = [block]
          if (!title) {
            const next = nextText(blocks, i + 1)
            if (next && titleLike(next.para)) {
              title = collapse(next.para.text)
              head = `${text}${/[:.]$/.test(text) ? '' : ':'} ${title}`
              for (let j = i + 1; j <= next.index; j += 1) parts.push(blocks[j])
              i = next.index
            }
          }
          open({ kind, number, title, start: '', head })
          current.blocks.push(...parts)
          continue
        }
      }
      const entry = entries.find((e) => !e.used && e.key === key && isRoman(e.page))
      const frontTitle = FRONT_TITLE.test(text)
      const bulletin = BULLETIN_LINE.test(text) && text.length <= 60
      const chapter =
        afterToc && chaptered
          ? entries.find(
              (e) =>
                !e.used &&
                e.key === key &&
                e.styled &&
                e.level === 1 &&
                !isRoman(e.page) &&
                (block.bold || /^(heading 1|title)$/i.test(block.style) || /^(chapter|part)\s+\w+/i.test(text)),
            )
          : null
      const frontEntry = entry && (entry.level === 1 || current.managed || current.cover) ? entry : null
      if (!used.has(`front:${key}`) && (frontEntry || frontTitle || bulletin || chapter)) {
        used.add(`front:${key}`)
        if (frontEntry) frontEntry.used = true
        if (chapter) chapter.used = true
        block.dropped = undefined
        open({
          kind: 'front',
          number: null,
          title: text,
          start: frontEntry ? frontEntry.page : '',
          head: text,
          bulletin: bulletin || /table of bulletins/i.test(text),
        })
        current.blocks.push(block)
        continue
      }
    }
    current.blocks.push(block)
  }
  drafts.push(current)
  return drafts.filter((d) => !d.cover || d.blocks.some(hasContent))
}

function hasContent(block: Block): boolean {
  if (block.kind === 'image') return true
  if (block.kind === 'table') return block.rows.some((row) => row.some((cell) => cell.blocks.some(hasContent)))
  return !block.dropped && collapse(block.text).length > 0
}

/** LEP rows from the List of Effective Pages leaf's tables, as printed. */
function lepSlots(drafts: DocxLeafDraft[], prefixes: Set<string>) {
  const out = { rows: [] as string[], cover: [] as string[], roman: [] as string[], section: false, chapter: false, unmatched: [] as string[] }
  const lep = drafts.find((d) => d.managed === 'lep')
  if (!lep) return out
  const cells: string[] = []
  const visit = (block: Block) => {
    if (block.kind === 'table') for (const row of block.rows) for (const cell of row) cell.blocks.forEach(visit)
    else if (block.kind === 'para' && !block.top) cells.push(collapse(block.text))
  }
  lep.blocks.forEach(visit)
  const seen = new Set<string>()
  for (const cell of cells) {
    if (!/^(?:[A-Za-z]|[IVXLCivxlc]{1,7}|[A-Z0-9]{1,3}(?:-[A-Z0-9]{1,3}){1,2})$/.test(cell) || seen.has(cell)) continue
    seen.add(cell)
    out.rows.push(cell)
    if (isRoman(cell)) out.roman.push(cell)
    else if (/^[A-Za-z]$/.test(cell)) out.cover.push(cell.toLowerCase())
    else if (/^\d+-\d+$/.test(cell)) out.chapter = true
    else if (/^[A-Z]{1,3}(?:-[A-Z]{1,2})?-\d+$/.test(cell) && (!prefixes.size || prefixes.has(cell.replace(/-\d+$/, '')))) out.section = true
    else out.unmatched.push(cell)
  }
  return out
}

const WORD_NUMBERS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17,
  eighteen: 18, nineteen: 19, twenty: 20,
}

/** Revision and date as a cover prints them ("Revision: One", "Date: 12/31/2025"). */
function coverRevision(drafts: DocxLeafDraft[]): DocxWalk['revision'] {
  const front = drafts.slice(0, 3).flatMap((d) => d.blocks).filter((b): b is Para => b.kind === 'para')
  const text = front.map((p) => p.text).join('\n')
  const rev = text.match(/\bRevision:?\s+(\d{1,3}|[A-Za-z]+)\b/i)?.[1]
  const number = rev ? (/^\d+$/.test(rev) ? Number(rev) : WORD_NUMBERS[rev.toLowerCase()] ?? null) : null
  const date = text.match(/\bDate:?\s+(\d{1,2})\/(\d{1,2})\/(\d{4})\b/)
  return {
    number,
    date: date ? `${date[3]}-${date[1].padStart(2, '0')}-${date[2].padStart(2, '0')}` : null,
  }
}

/* ---------- One leaf → JSONContent ---------- */

type BuildContext = {
  entries: TocEntry[]
  median: number
  stats: DocxWalk['stats']
  imageCounter: { n: number }
}

type LeafState = BuildContext & {
  converted: string[]
  source: string[]
  flattened: number
  figures: PendingFigure[]
  placeholders: DocxLeaf['placeholders']
}

async function buildLeaf(draft: DocxLeafDraft, ctx: BuildContext): Promise<DocxLeaf> {
  const state: LeafState = { ...ctx, converted: [], source: [], flattened: 0, figures: [], placeholders: [] }
  collectSource(draft.blocks, state.source)
  const base = {
    kind: draft.kind,
    number: draft.number,
    title: draft.title,
    start: draft.start,
    managed: draft.managed,
    bulletin: draft.bulletin,
  }
  if (draft.managed) {
    return {
      ...base,
      doc: { type: 'doc', content: [] },
      markdown: '',
      source: state.source,
      converted: [],
      flattened: 0,
      figures: [],
      placeholders: [],
      managed_figures: countImages(draft.blocks),
    }
  }
  const content: JSONContent[] = []
  let blocks = draft.blocks
  if (draft.head) {
    content.push({ type: 'heading', attrs: { level: 1 }, content: plainText(draft.head) })
    const firstText = blocks.findIndex((b) => b.kind === 'para' && collapse(b.text))
    // The title line(s) became the H1.
    let skip = firstText + 1
    if (draft.kind !== 'front' && draft.head !== collapse((blocks[firstText] as Para).text)) {
      const next = nextText(blocks, firstText + 1)
      if (next) skip = next.index + 1
    }
    blocks = blocks.slice(skip)
  }
  content.push(...(await buildBlocks(blocks, state)))
  const doc: JSONContent = { type: 'doc', content: mergeLists(content) }
  const markdown = doc.content?.length ? serializeBody(doc) : ''
  return {
    ...base,
    doc,
    markdown,
    source: state.source,
    converted: state.converted,
    flattened: state.flattened,
    figures: state.figures,
    placeholders: state.placeholders,
    managed_figures: 0,
  }
}

function collectSource(blocks: Block[], out: string[]) {
  for (const block of blocks) {
    if (block.kind === 'para' && !block.dropped) out.push(block.text)
    if (block.kind === 'table') for (const row of block.rows) for (const cell of row) collectSource(cell.blocks, out)
  }
}

function countImages(blocks: Block[]): number {
  let n = 0
  for (const block of blocks) {
    if (block.kind === 'image') n += 1
    if (block.kind === 'table') for (const row of block.rows) for (const cell of row) n += countImages(cell.blocks)
  }
  return n
}

type ListDraft = { depth: number; kind: 'orderedList' | 'bulletList'; inline: JSONContent[] }

async function buildBlocks(blocks: Block[], state: LeafState): Promise<JSONContent[]> {
  const out: JSONContent[] = []
  const typed = typedRuns(blocks)
  let list: ListDraft[] = []
  let wordBase: number | null = null
  let wordDepth = -1
  let typedStack: string[] = []
  const flush = () => {
    if (list.length) out.push(...buildLists(list))
    list = []
    wordBase = null
    wordDepth = -1
    typedStack = []
  }

  for (let i = 0; i < blocks.length; i += 1) {
    const block = blocks[i]
    if (block.kind === 'image') {
      flush()
      const caption = blocks[i + 1]
      let text = collapse(block.altText)
      if (caption?.kind === 'para' && /^caption$/i.test(caption.style) && collapse(caption.text)) {
        text = collapse(caption.text)
        i += 1
      }
      out.push(await figure(block, text, state))
      continue
    }
    if (block.kind === 'table') {
      flush()
      out.push(...(await table(block, state)))
      continue
    }
    if (block.dropped) continue
    const text = collapse(block.text)
    if (!text) continue

    const callout = calloutOf(block)
    if (callout) {
      flush()
      let inner = callout.rest
      if (!collapse(segText(inner))) {
        const next = nextText(blocks, i + 1)
        if (next) {
          inner = next.para.segs
          i = next.index
        }
      }
      state.converted.push(callout.label)
      state.stats.callout_labels += 1
      const para = paragraph(inner, state)
      out.push({ type: callout.kind, content: para ? [para] : [{ type: 'paragraph', content: [] }] })
      continue
    }

    const heading = headingLevel(block, blocks[i + 1], state)
    if (heading) {
      flush()
      let words = block.text
      if (heading.merge) {
        words = `${block.text} ${(blocks[i + 1] as Para).text}`
        i += 1
      }
      out.push(guardBlock({ type: 'heading', attrs: { level: heading.level }, content: plainText(words) }, state))
      continue
    }

    if (block.numbering) {
      if (wordBase === null || block.numbering.level < wordBase) wordBase = block.numbering.level
      wordDepth = block.numbering.level - wordBase
      typedStack = []
      list.push({
        depth: wordDepth,
        kind: block.numbering.ordered ? 'orderedList' : 'bulletList',
        inline: inline(block.segs, state),
      })
      continue
    }

    const marker = typed.get(i)
    if (marker) {
      const base = wordDepth + 1
      let at = typedStack.indexOf(marker.key)
      if (at === -1) {
        typedStack.push(marker.key)
        at = typedStack.length - 1
      } else typedStack = typedStack.slice(0, at + 1)
      state.converted.push(marker.text)
      if (marker.kind === 'orderedList') state.stats.typed_numbers += 1
      list.push({ depth: base + at, kind: marker.kind, inline: inline(dropChars(block.segs, marker.length), state) })
      continue
    }

    flush()
    const para = paragraph(block.segs, state)
    if (para) out.push(para)
  }
  flush()
  return out
}

/** Hand-typed numbering ("1.)", "(a.)", "(i.)") in runs of two or more paragraphs; typed bullets alone. */
function typedRuns(blocks: Block[]): Map<number, { key: string; kind: ListDraft['kind']; text: string; length: number }> {
  const marks = new Map<number, { key: string; kind: ListDraft['kind']; text: string; length: number }>()
  let run: number[] = []
  let lastLetter: Record<string, string> = {}
  const close = () => {
    if (run.length < 2) for (const i of run) if (marks.get(i)?.kind === 'orderedList') marks.delete(i)
    run = []
    lastLetter = {}
  }
  for (let i = 0; i < blocks.length; i += 1) {
    const block = blocks[i]
    if (block.kind !== 'para') {
      close()
      continue
    }
    if (block.dropped || !collapse(block.text)) continue
    const bullet = !block.numbering ? block.text.match(TYPED_BULLET) : null
    if (bullet) {
      marks.set(i, { key: 'bullet', kind: 'bulletList', text: bullet[1], length: bullet[0].length })
      continue
    }
    const m = !block.numbering ? block.text.match(TYPED_NUMBER) : null
    if (!m) {
      close()
      continue
    }
    const paren = m[1] ? 'p' : ''
    const value = m[2]
    const close3 = m[3]
    let cls: string
    if (/^\d+$/.test(value)) cls = 'n'
    else if (value.length > 1 || /^[ivx]$/i.test(value)) {
      const prev = lastLetter[`${paren}${close3}${value === value.toLowerCase() ? 'l' : 'L'}`]
      const letterFollows =
        value.length === 1 && prev && prev.charCodeAt(0) + 1 === value.charCodeAt(0)
      cls = letterFollows ? 'l' : 'r'
    } else cls = 'l'
    const caseKey = value === value.toLowerCase() ? 'l' : 'L'
    if (cls === 'l') lastLetter[`${paren}${close3}${caseKey}`] = value
    marks.set(i, {
      key: `${cls}${caseKey}${paren}${close3}`,
      kind: 'orderedList',
      text: m[0].trim(),
      length: m[0].length,
    })
    run.push(i)
  }
  close()
  return marks
}

function buildLists(items: ListDraft[]): JSONContent[] {
  const roots: JSONContent[] = []
  const stack: Array<{ depth: number; list: JSONContent }> = []
  for (const item of items) {
    if (!item.inline.length) continue
    const topDepth = stack.length ? stack[stack.length - 1].depth : -1
    let depth = Math.max(0, Math.min(item.depth, 4, topDepth + 1))
    while (stack.length && stack[stack.length - 1].depth > depth) stack.pop()
    let top = stack[stack.length - 1]
    if (top && top.depth === depth && top.list.type !== item.kind) {
      stack.pop()
      top = stack[stack.length - 1]
    }
    if (!top || top.depth < depth) {
      if (!top) depth = 0
      const list: JSONContent =
        item.kind === 'orderedList'
          ? { type: 'orderedList', attrs: { start: 1 }, content: [] }
          : { type: 'bulletList', content: [] }
      if (!top) roots.push(list)
      else top.list.content!.at(-1)!.content!.push(list)
      stack.push({ depth, list })
      top = stack[stack.length - 1]
    }
    top.list.content!.push({ type: 'listItem', content: [{ type: 'paragraph', content: item.inline }] })
  }
  return roots.map((node) => guardBlock(node))
}

function mergeLists(blocks: JSONContent[]): JSONContent[] {
  const out: JSONContent[] = []
  for (const block of blocks) {
    const prev = out[out.length - 1]
    if (prev && (block.type === 'orderedList' || block.type === 'bulletList') && prev.type === block.type) {
      prev.content = [...(prev.content ?? []), ...(block.content ?? [])]
      continue
    }
    out.push(block)
  }
  return out
}

function headingLevel(para: Para, next: Block | undefined, state: LeafState): { level: number; merge: boolean } | null {
  const text = collapse(para.text)
  if (text.length > 160) return null
  const style = para.style.match(/^heading\s*([1-5])$/i)
  if (style) return { level: Math.max(2, Number(style[1])), merge: false }
  if (/^title$/i.test(para.style)) return { level: 2, merge: false }
  const key = matchKey(text)
  const level = (entry: TocEntry) => Math.min(5, Math.max(2, entry.level === 1 ? 2 : entry.level))
  const entry = state.entries.find((e) => !e.used && e.key === key && key.length > 0)
  if (entry) {
    entry.used = true
    return { level: level(entry), merge: false }
  }
  if (next?.kind === 'para' && !next.dropped && key) {
    const joined = matchKey(`${text} ${collapse(next.text)}`)
    const split = state.entries.find((e) => !e.used && e.key === joined && e.key.startsWith(key))
    if (split) {
      split.used = true
      return { level: level(split), merge: true }
    }
  }
  const numbered = text.match(NUMBERED_HEADING)
  if (numbered && text.length <= 120 && (para.bold || (para.size !== null && state.median > 0 && para.size > state.median))) {
    const parts = numbered[1].split('.')
    if (parts.length > 1 && parts[parts.length - 1] === '0') parts.pop()
    return { level: Math.min(5, Math.max(2, parts.length)), merge: false }
  }
  return null
}

function calloutOf(para: Para): { kind: 'note' | 'caution' | 'warning'; label: string; rest: Seg[] } | null {
  const style = para.style.match(/^(note|caution|warning)$/i)
  const m = para.text.match(CALLOUT)
  if (m) {
    return { kind: m[1].toLowerCase() as 'note', label: m[1], rest: dropChars(para.segs, m[0].length) }
  }
  if (style) return { kind: style[1].toLowerCase() as 'note', label: '', rest: para.segs }
  return null
}

function segText(segs: Seg[]): string {
  return segs.map((s) => s.text).join('')
}

function dropChars(segs: Seg[], n: number): Seg[] {
  const out: Seg[] = []
  let left = n
  for (const seg of segs) {
    if (left >= seg.text.length) {
      left -= seg.text.length
      continue
    }
    out.push({ ...seg, text: seg.text.slice(left) })
    left = 0
  }
  return out
}

/* ---------- Inline ---------- */

function marksOf(seg: Seg): Mark[] {
  const marks: Mark[] = []
  if (seg.bold) marks.push({ type: 'bold' })
  if (seg.italic) marks.push({ type: 'italic' })
  if (seg.underline) marks.push({ type: 'underline' })
  return marks
}

function sameMarks(a: Mark[] | undefined, b: Mark[] | undefined): boolean {
  return (a ?? []).map((m) => m.type).join() === (b ?? []).map((m) => m.type).join()
}

function textNode(text: string, marks: Mark[]): JSONContent {
  return marks.length ? { type: 'text', text, marks } : { type: 'text', text }
}

/** Runs → text nodes with marks. Whitespace collapses; characters the Markdown reader treats as syntax are swapped. */
function inline(segs: Seg[], state: LeafState): JSONContent[] {
  const nodes: JSONContent[] = []
  for (const seg of segs) {
    let text = seg.text.replace(/\s/g, ' ')
    if (text.includes('*')) {
      state.stats.asterisks += (text.match(/\*/g) ?? []).length
      text = text.replace(/\*/g, '∗')
    }
    if (/<\/?u>/.test(text)) {
      state.stats.guarded_line_starts += 1
      text = text.replace(/<(\/?u>)/g, '<⁠$1')
    }
    const prev = nodes[nodes.length - 1]
    // Spaces between two bold words stay inside the bold run.
    const marks = text.trim() ? marksOf(seg) : (prev?.marks ?? [])
    if (prev && sameMarks(prev.marks, marks)) prev.text += text
    else nodes.push(textNode(text, marks))
  }
  // Collapse spaces across node boundaries, then trim the ends.
  let lastSpace = true
  for (const node of nodes) {
    let text = node.text!.replace(/ {2,}/g, ' ')
    if (lastSpace) text = text.replace(/^ /, '')
    if (text) lastSpace = text.endsWith(' ')
    node.text = text
  }
  const kept = nodes.filter((n) => n.text)
  if (kept.length) kept[kept.length - 1].text = kept[kept.length - 1].text!.replace(/ +$/, '')
  return mergeAdjacent(kept.filter((n) => n.text))
}

function mergeAdjacent(nodes: JSONContent[]): JSONContent[] {
  const out: JSONContent[] = []
  for (const node of nodes) {
    const prev = out[out.length - 1]
    if (prev && prev.type === 'text' && node.type === 'text' && sameMarks(prev.marks, node.marks)) {
      prev.text = `${prev.text}${node.text}`
      continue
    }
    out.push({ ...node })
  }
  return out
}

function plainText(text: string): JSONContent[] {
  const clean = collapse(text.replace(/\*/g, '∗'))
  return clean ? [{ type: 'text', text: clean }] : []
}

const LINE_START = /^(#{1,5}\s|\d+\.\s|-\s|\||:::|```mermaid|!\[)/

function paragraph(segs: Seg[], state: LeafState): JSONContent | null {
  const content = inline(segs, state)
  if (!content.length) return null
  const first = content[0]
  if (!first.marks && LINE_START.test(first.text ?? '')) {
    first.text = `⁠${first.text}`
    state.stats.guarded_line_starts += 1
  }
  return guardBlock({ type: 'paragraph', content }, state)
}

/* ---------- Round trip ---------- */

export function sameNode(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
    return a.every((item, i) => sameNode(item, b[i]))
  }
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false
  const ka = Object.keys(a).filter((k) => (a as Record<string, unknown>)[k] !== undefined)
  const kb = Object.keys(b).filter((k) => (b as Record<string, unknown>)[k] !== undefined)
  if (ka.length !== kb.length) return false
  return ka.every((k) => sameNode((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]))
}

/** Adjacent text nodes with the same marks are one run; the reader may split them. */
export function canonical(node: JSONContent): JSONContent {
  if (!node.content) return node
  const content = node.content.map(canonical)
  return { ...node, content: mergeAdjacent(content) }
}

export function roundTrips(doc: JSONContent): boolean {
  return sameNode(canonical(parseBody(serializeBody(doc))), canonical(doc))
}

function stripMarks(node: JSONContent): JSONContent {
  if (node.type === 'text') return { type: 'text', text: node.text }
  if (!node.content) return node
  return { ...node, content: mergeAdjacent(node.content.map(stripMarks)) }
}

/** A block whose marks the Markdown reader would misread keeps its words and loses its marks. */
function guardBlock(block: JSONContent, state?: LeafState): JSONContent {
  if (roundTrips({ type: 'doc', content: [block] })) return block
  const plain = stripMarks(block)
  if (state && roundTrips({ type: 'doc', content: [plain] })) state.stats.marks_dropped += 1
  return plain
}

/* ---------- Tables ---------- */

async function table(tbl: Tbl, state: LeafState): Promise<JSONContent[]> {
  if (tbl.rows.length === 1 && tbl.rows[0].length === 1) {
    const cell = tbl.rows[0][0]
    const first = cell.blocks.find((b): b is Para => b.kind === 'para' && Boolean(collapse(b.text)))
    const callout = first ? calloutOf(first) : null
    if (callout && first) {
      state.converted.push(callout.label)
      state.stats.callout_labels += 1
      const rest = cell.blocks.map((b) => (b === first ? { ...first, text: segText(callout.rest), segs: callout.rest } : b))
      const inner = await buildBlocks(rest.map(asTop), state)
      return [{ type: callout.kind, content: inner.length ? inner : [{ type: 'paragraph', content: [] }] }]
    }
    // A one-cell table is a layout box: its contents are ordinary blocks.
    return buildBlocks(cell.blocks.map(asTop), state)
  }

  const figures: Img[] = []
  const grid: Array<Array<{ inline: JSONContent[]; merged: boolean }>> = []
  const carry = new Map<number, { inline: JSONContent[]; left: number }>()
  for (const row of tbl.rows) {
    const out: Array<{ inline: JSONContent[]; merged: boolean }> = []
    const takeCarry = () => {
      while (carry.has(out.length)) {
        const c = carry.get(out.length)!
        out.push({ inline: c.inline.map((n) => ({ ...n })), merged: true })
        c.left -= 1
        if (c.left <= 0) carry.delete(out.length - 1)
      }
    }
    for (const cell of row) {
      takeCarry()
      const content = cellInline(cell, state, figures)
      const merged = cell.colSpan > 1 || cell.rowSpan > 1
      if (merged) state.flattened += 1
      for (let span = 0; span < cell.colSpan; span += 1) {
        if (cell.rowSpan > 1) carry.set(out.length, { inline: content, left: cell.rowSpan - 1 })
        out.push({ inline: content.map((n) => ({ ...n })), merged })
      }
    }
    takeCarry()
    grid.push(out)
  }
  const rows = grid.filter((row) => row.some((cell) => cell.inline.length))
  const blocks: JSONContent[] = []
  if (rows.length) {
    const width = Math.max(...rows.map((row) => row.length))
    const node: JSONContent = {
      type: 'table',
      content: rows.map((row, r) => ({
        type: 'tableRow',
        content: Array.from({ length: width }, (_, c) => ({
          type: r === 0 ? 'tableHeader' : 'tableCell',
          content: [{ type: 'paragraph', content: row[c]?.inline ?? [] }],
        })),
      })),
    }
    blocks.push(guardBlock(node, state))
  }
  for (const img of figures) blocks.push(await figure(img, collapse(img.altText), state))
  return blocks
}

function asTop(block: Block): Block {
  return block.kind === 'para' ? { ...block, top: true } : block
}

function cellInline(cell: Cell, state: LeafState, figures: Img[]): JSONContent[] {
  const parts: Seg[][] = []
  let lists = false
  const visit = (block: Block) => {
    if (block.kind === 'image') figures.push(block)
    else if (block.kind === 'table') {
      lists = true
      for (const row of block.rows) for (const c of row) c.blocks.forEach(visit)
    } else if (collapse(block.text)) {
      if (block.numbering) lists = true
      parts.push(block.segs)
    }
  }
  cell.blocks.forEach(visit)
  if (parts.length > 1 || lists) state.flattened += 1
  const segs: Seg[] = []
  parts.forEach((p, i) => {
    if (i) segs.push({ text: ' ', bold: false, italic: false, underline: false })
    segs.push(...p)
  })
  const content = inline(segs, state)
  for (const node of content) {
    if (node.text?.includes('|')) {
      state.stats.table_pipes += (node.text.match(/\|/g) ?? []).length
      node.text = node.text.replace(/\|/g, '¦')
    }
  }
  return content
}

/* ---------- Figures ---------- */

const FIGURE_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/gif': 'gif',
  'image/svg+xml': 'svg',
  'image/webp': 'webp',
}

async function figure(img: Img, caption: string, state: LeafState): Promise<JSONContent> {
  state.imageCounter.n += 1
  const ext = FIGURE_EXT[img.contentType.toLowerCase()]
  const sourceExt = img.contentType.split('/').pop()?.replace(/^x-/, '').replace(/\+xml$/, '') || 'bin'
  const name = `image${state.imageCounter.n}.${ext ?? sourceExt}`
  const placeholder = (reason: string): JSONContent => {
    state.placeholders.push({ name, content_type: img.contentType || 'unknown', reason })
    return {
      type: 'paragraph',
      content: [{ type: 'text', text: `![${sourceExt.toUpperCase()} image not converted: ${name}]()` }],
    }
  }
  if (!ext) return placeholder('type not supported')
  let bytes: Buffer
  try {
    bytes = img.read ? Buffer.from(await img.read()) : Buffer.alloc(0)
  } catch {
    return placeholder('could not be read')
  }
  if (!bytes.length) return placeholder('empty')
  if (bytes.length > FIGURE_MAX_BYTES) return placeholder('over 10 MB')
  const file = figureName(bytes, ext)
  state.figures.push({ name: file, ext, bytes })
  return { type: 'figure', attrs: { src: `figures/${file}`, caption, width: '100%' } }
}

