import { parseBody, type JSONContent } from '../../src/schema/markdown.ts'

export const GATE = { overall: 0.98, leaf: 0.95 }
const SNIPPETS_PER_LEAF = 20
const SNIPPET_CONTEXT = 3
const SNIPPET_MAX_WORDS = 16

export type Word = { word: string; norm: string }

/** NFKC, lowercase, punctuation and symbols stripped, split on whitespace. */
export function words(text: string): Word[] {
  const out: Word[] = []
  for (const word of text.normalize('NFKC').split(/\s+/)) {
    const norm = word.toLowerCase().replace(/[\p{P}\p{S}\p{Cf}]/gu, '')
    if (norm) out.push({ word, norm })
  }
  return out
}

export function tokens(text: string): string[] {
  return words(text).map((w) => w.norm)
}

export type Bag = Map<string, number>

export function bag(list: string[]): Bag {
  const out: Bag = new Map()
  for (const token of list) out.set(token, (out.get(token) ?? 0) + 1)
  return out
}

export function bagSize(b: Bag): number {
  let n = 0
  for (const v of b.values()) n += v
  return n
}

/** Multiset a − b. */
export function minus(a: Bag, b: Bag): Bag {
  const out: Bag = new Map(a)
  for (const [token, n] of b) {
    const left = (out.get(token) ?? 0) - n
    if (left > 0) out.set(token, left)
    else out.delete(token)
  }
  return out
}

export function overlap(source: Bag, output: Bag): number {
  let n = 0
  for (const [token, count] of source) n += Math.min(count, output.get(token) ?? 0)
  return n
}

/** Every piece of text a reader sees in a parsed leaf: text nodes, table cells, captions, callouts. */
export function docText(doc: JSONContent): string {
  const parts: string[] = []
  const visit = (node: JSONContent) => {
    if (node.type === 'text' && node.text) parts.push(node.text)
    if (node.type === 'figure' && node.attrs?.caption) parts.push(String(node.attrs.caption))
    if (node.type === 'mermaid' && node.attrs?.source) parts.push(String(node.attrs.source))
    for (const child of node.content ?? []) visit(child)
    if (node.type !== 'text') parts.push('\n')
  }
  visit(doc)
  return parts.join(' ')
}

export function markdownTokens(markdown: string): string[] {
  return tokens(docText(parseBody(markdown)))
}

/** Short windows of source text whose words the output does not have. */
export function unmatchedSnippets(source: Word[], output: Bag, max = SNIPPETS_PER_LEAF): string[] {
  const left: Bag = new Map(output)
  const missing = source.map((w) => {
    const n = left.get(w.norm) ?? 0
    if (n > 0) {
      left.set(w.norm, n - 1)
      return false
    }
    return true
  })
  const snippets: string[] = []
  let i = 0
  while (i < source.length && snippets.length < max) {
    if (!missing[i]) {
      i += 1
      continue
    }
    let end = i
    while (end + 1 < source.length && (missing[end + 1] || (end + 2 < source.length && missing[end + 2]))) end += 1
    const from = Math.max(0, i - SNIPPET_CONTEXT)
    const to = Math.min(source.length, Math.max(end + 1 + SNIPPET_CONTEXT, from + 1))
    const slice = source.slice(from, Math.min(to, from + SNIPPET_MAX_WORDS)).map((w) => w.word)
    snippets.push(`${from > 0 ? '… ' : ''}${slice.join(' ')}${to < source.length ? ' …' : ''}`)
    i = end + 1
  }
  return snippets
}

export type LeafReport = {
  id: string
  title: string
  kind: 'front' | 'section' | 'appendix'
  /** null for a leaf with no source words of its own (managed, or a picture-only page). */
  coverage: number | null
  source_words: number
  matched_words: number
  note?: string
  unmatched: string[]
}

export type DroppedLine = { text: string; count: number; reason: 'repeats' | 'page-label' | 'revision-footer' }

export type ImportReport = {
  manual: string
  source: { filename: string; sha256: string }
  gate: { overall: number; leaf: number }
  passed: boolean
  accepted_gaps: boolean
  coverage: { overall: number; source_words: number; matched_words: number }
  leaves: LeafReport[]
  dropped_lines: DroppedLine[]
  managed: Array<{ id: string; title: string; managed: string; note: string; source_words: number; figures: number }>
  bulletins: Array<{ id: string; title: string; note: string }>
  flattened_cells: { count: number; by_leaf: Record<string, number> }
  figures: { written: number; placeholders: Array<{ leaf: string; name: string; content_type: string; reason: string }> }
  converted: { typed_numbers: number; callout_labels: number }
  substituted: { asterisks: number; table_pipes: number; guarded_line_starts: number; marks_dropped: number }
  lep: { rows: number; unmatched_rows: string[] }
  /** Word elements the reader skipped (WordArt, shapes); their text is not in the count. */
  ignored_elements: string[]
}

export type LeafCoverageInput = {
  id: string
  title: string
  kind: LeafReport['kind']
  managed: string | null
  bulletin: boolean
  /** Source text that belongs to this leaf, after running lines were dropped. */
  source: string[]
  /** Source text deliberately turned into structure (typed numbers, callout labels). */
  converted: string[]
  /** The leaf body as it will be written. */
  markdown: string
}

export function coverageFor(input: LeafCoverageInput): { report: LeafReport; output: Bag; source: Bag } {
  const sourceWords = removeWords(input.source.flatMap((text) => words(text)), bag(input.converted.flatMap(tokens)))
  const source = bag(sourceWords.map((w) => w.norm))
  const output = bag(markdownTokens(input.markdown))
  const total = bagSize(source)
  const matched = overlap(source, output)
  return {
    source,
    output,
    report: {
      id: input.id,
      title: input.title,
      kind: input.kind,
      coverage: total ? round(matched / total) : null,
      source_words: total,
      matched_words: matched,
      unmatched: total ? unmatchedSnippets(sourceWords, output) : [],
    },
  }
}

function removeWords(list: Word[], drop: Bag): Word[] {
  const left: Bag = new Map(drop)
  return list.filter((w) => {
    const n = left.get(w.norm) ?? 0
    if (n <= 0) return true
    left.set(w.norm, n - 1)
    return false
  })
}

export function round(n: number): number {
  return Math.floor(n * 10000) / 10000
}

export function percent(n: number | null): string {
  return n === null ? '—' : `${(Math.floor(n * 1000) / 10).toFixed(1)}%`
}

/** Leaves under the per-leaf gate, worst first. */
export function worstLeaves(report: ImportReport, limit = 5): LeafReport[] {
  return report.leaves
    .filter((leaf) => leaf.coverage !== null)
    .sort((a, b) => (a.coverage ?? 1) - (b.coverage ?? 1))
    .slice(0, limit)
}

export function gateProblem(report: ImportReport): string | null {
  const low = report.leaves.filter((leaf) => leaf.coverage !== null && leaf.coverage < report.gate.leaf)
  if (report.coverage.overall >= report.gate.overall && !low.length) return null
  const worst = (low.length ? low : worstLeaves(report))
    .sort((a, b) => (a.coverage ?? 1) - (b.coverage ?? 1))
    .slice(0, 5)
    .map((leaf) => `${leaf.id} ${percent(leaf.coverage)}`)
  return [
    `Text would be lost: ${percent(report.coverage.overall)} of the source words came through (gate ${percent(report.gate.overall)} overall, ${percent(report.gate.leaf)} per leaf).`,
    `Worst leaves: ${worst.join(', ')}.`,
    'Nothing was written. Accept the gaps to bring it in anyway.',
  ].join(' ')
}

export function formatReportSummary(report: ImportReport): string {
  const lines = [
    `coverage ${percent(report.coverage.overall)}  (${report.coverage.matched_words}/${report.coverage.source_words} words)${report.passed ? '' : '  BELOW GATE, gaps accepted'}`,
    `leaves ${report.leaves.length}  managed ${report.managed.length}  bulletins ${report.bulletins.length}`,
    `dropped running lines ${report.dropped_lines.length} (${report.dropped_lines.reduce((n, row) => n + row.count, 0)} times)`,
    `flattened table cells ${report.flattened_cells.count}`,
    `figures ${report.figures.written}  placeholders ${report.figures.placeholders.length}`,
  ]
  if (report.lep.unmatched_rows.length) lines.push(`LEP rows that match no section: ${report.lep.unmatched_rows.join(', ')}`)
  lines.push('worst leaves:')
  for (const leaf of worstLeaves(report)) lines.push(`  ${percent(leaf.coverage).padStart(6)}  ${leaf.id}`)
  return lines.join('\n')
}
