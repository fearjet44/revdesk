import type { Frontmatter } from '../types.ts'

export type Mark = {
  type: string
  attrs?: Record<string, unknown>
}

export type JSONContent = {
  type: string
  attrs?: Record<string, unknown>
  content?: JSONContent[]
  marks?: Mark[]
  text?: string
}

export function splitFrontmatter(markdown: string): { meta: Frontmatter; body: string } {
  const match = markdown.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/)
  if (!match) throw new Error('Section is missing YAML frontmatter.')
  const meta: Frontmatter = { id: '', title: '', rev_last_changed: '' }
  for (const line of match[1].split('\n')) {
    const idx = line.indexOf(':')
    if (idx === -1) continue
    const key = line.slice(0, idx).trim()
    const value = line.slice(idx + 1).trim().replace(/^['"]|['"]$/g, '')
    if (key === 'id' || key === 'title' || key === 'rev_last_changed') meta[key] = value
  }
  if (!meta.id || !meta.title || !meta.rev_last_changed) {
    throw new Error('Frontmatter must include id, title, and rev_last_changed.')
  }
  return { meta, body: match[2].replace(/^\n/, '') }
}

export function withFrontmatter(meta: Frontmatter, body: string): string {
  return `---\nid: ${meta.id}\ntitle: ${meta.title}\nrev_last_changed: ${meta.rev_last_changed}\n---\n\n${body.replace(/^\n+/, '').replace(/\s*$/, '\n')}`
}

export type SourceBlockRange = {
  start: number
  end: number
}

/** 1-based source line of the first body character after YAML frontmatter. */
export function bodyStartLine(markdown: string): number {
  const { body } = splitFrontmatter(markdown)
  if (!body) {
    const prefix = markdown.match(/^---\n[\s\S]*?\n---\n?/)?.[0] ?? markdown
    return Math.max(1, prefix.split('\n').length)
  }
  const idx = markdown.indexOf(body)
  if (idx <= 0) return 1
  return markdown.slice(0, idx).split('\n').length
}

/** Source-line span of each top-level body block, matching `parseBody` order. */
export function blockSourceRanges(markdown: string): SourceBlockRange[] {
  const { body } = splitFrontmatter(markdown)
  const start = bodyStartLine(markdown)
  const lines = body.replace(/\n+$/, '').split('\n')
  if (lines.length === 1 && lines[0] === '') return []
  const blocks: SourceBlockRange[] = []
  let i = 0
  while (i < lines.length) {
    if (!lines[i].trim()) {
      i += 1
      continue
    }
    const from = i
    i = advanceBlock(lines, i)
    blocks.push({ start: start + from, end: start + i - 1 })
  }
  return blocks
}

/** -1 = title / frontmatter. Otherwise index into `blockSourceRanges`. */
export function blockIndexForLine(line: number, blocks: SourceBlockRange[], bodyStart: number): number {
  if (line < bodyStart) return -1
  const hit = blocks.findIndex((block) => line >= block.start && line <= block.end)
  if (hit >= 0) return hit
  const next = blocks.findIndex((block) => block.start > line)
  if (next >= 0) return next
  return blocks.length ? blocks.length - 1 : -1
}

function advanceBlock(lines: string[], i: number): number {
  const line = lines[i]
  if (/^:::(note|caution|warning)\s*$/.test(line)) {
    i += 1
    while (i < lines.length && lines[i].trim() !== ':::') i += 1
    if (i < lines.length) i += 1
    return i
  }
  if (line.startsWith('|')) {
    while (i < lines.length && lines[i].startsWith('|')) i += 1
    return i
  }
  if (/^(#{1,3})\s+/.test(line)) return i + 1
  if (/^\d+\.\s+/.test(line)) {
    i += 1
    while (i < lines.length) {
      if (!lines[i].trim()) {
        const next = nextNonBlank(lines, i + 1)
        if (next < lines.length && (isStepAt(lines[next], 0) || leadingSpaces(lines[next]) > 0)) {
          i = next
          continue
        }
        break
      }
      if (isStepAt(lines[i], 0) || leadingSpaces(lines[i]) > 0) {
        i += 1
        continue
      }
      break
    }
    return i
  }
  i += 1
  while (i < lines.length && lines[i].trim() && !isBlockStart(lines[i])) i += 1
  return i
}

export function parseBody(markdown: string): JSONContent {
  const lines = markdown.replace(/\n+$/, '').split('\n')
  const blocks: JSONContent[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]
    if (!line.trim()) {
      i += 1
      continue
    }

    const fence = line.match(/^:::(note|caution|warning)\s*$/)
    if (fence) {
      const inner: string[] = []
      i += 1
      while (i < lines.length && lines[i].trim() !== ':::') {
        inner.push(lines[i])
        i += 1
      }
      if (i < lines.length) i += 1
      const children = parseBody(inner.join('\n')).content ?? [{ type: 'paragraph' }]
      blocks.push({ type: fence[1], content: children })
      continue
    }

    if (line.startsWith('|')) {
      const tableLines: string[] = []
      while (i < lines.length && lines[i].startsWith('|')) {
        tableLines.push(lines[i])
        i += 1
      }
      const table = parseTable(tableLines)
      if (table) blocks.push(table)
      continue
    }

    const heading = line.match(/^(#{1,3})\s+(.+)$/)
    if (heading) {
      blocks.push({
        type: 'heading',
        attrs: { level: heading[1].length },
        content: parseInline(heading[2].trim()),
      })
      i += 1
      continue
    }

    if (isStepAt(line, 0)) {
      const parsed = parseOrderedList(lines, i, 0, 1)
      blocks.push(parsed.node)
      i = parsed.next
      continue
    }

    const para: string[] = [line]
    i += 1
    while (i < lines.length && lines[i].trim() && !isBlockStart(lines[i])) {
      para.push(lines[i])
      i += 1
    }
    blocks.push({ type: 'paragraph', content: parseInline(para.join(' ')) })
  }

  return { type: 'doc', content: blocks.length ? blocks : [{ type: 'paragraph' }] }
}

export function serializeBody(doc: JSONContent): string {
  const blocks = (doc.content ?? []).map(serializeBlock).filter((block) => block.length > 0)
  return `${blocks.join('\n\n')}\n`
}

export function parseSection(markdown: string): { meta: Frontmatter; doc: JSONContent } {
  const { meta, body } = splitFrontmatter(markdown)
  return { meta, doc: parseBody(body) }
}

export function serializeSection(meta: Frontmatter, doc: JSONContent): string {
  return withFrontmatter(meta, serializeBody(doc))
}

function isBlockStart(line: string): boolean {
  return (
    /^(#{1,3})\s+/.test(line) ||
    /^\d+\.\s+/.test(line) ||
    line.startsWith('|') ||
    /^:::(note|caution|warning)\s*$/.test(line) ||
    line.trim() === ':::'
  )
}

const STEP_INDENT = 3
const STEP_MAX_DEPTH = 5

function nextNonBlank(lines: string[], i: number): number {
  while (i < lines.length && !lines[i].trim()) i += 1
  return i
}

function leadingSpaces(line: string): number {
  let n = 0
  while (n < line.length && line[n] === ' ') n += 1
  return n
}

function isStepAt(line: string, indent: number): boolean {
  return matchStep(line, indent) != null
}

function matchStep(line: string, indent: number): string | null {
  if (leadingSpaces(line) !== indent) return null
  const match = line.slice(indent).match(/^(\d+)\.\s+(.*)$/)
  return match ? match[2] : null
}

function stripItemPrefix(line: string, indent: number): string {
  const need = indent + STEP_INDENT
  if (line.startsWith(' '.repeat(need))) return line.slice(need)
  return line.slice(indent).replace(/^\s+/, '')
}

function parseOrderedList(
  lines: string[],
  i: number,
  indent: number,
  depth: number,
): { node: JSONContent; next: number } {
  const items: JSONContent[] = []
  while (i < lines.length) {
    if (!lines[i].trim()) {
      const next = nextNonBlank(lines, i + 1)
      if (next < lines.length && (isStepAt(lines[next], indent) || leadingSpaces(lines[next]) > indent)) {
        i = next
        continue
      }
      break
    }
    const text = matchStep(lines[i], indent)
    if (text == null) break
    i += 1
    const content: JSONContent[] = [{ type: 'paragraph', content: parseInline(text) }]
    const nestedIndent = indent + STEP_INDENT
    while (i < lines.length) {
      if (!lines[i].trim()) {
        const next = nextNonBlank(lines, i + 1)
        if (next < lines.length && isStepAt(lines[next], indent)) break
        if (next < lines.length && leadingSpaces(lines[next]) > indent) {
          i = next
          continue
        }
        break
      }
      if (isStepAt(lines[i], indent)) break
      if (depth < STEP_MAX_DEPTH && isStepAt(lines[i], nestedIndent)) {
        const nested = parseOrderedList(lines, i, nestedIndent, depth + 1)
        content.push(nested.node)
        i = nested.next
        continue
      }
      if (leadingSpaces(lines[i]) > indent) {
        content.push({ type: 'paragraph', content: parseInline(stripItemPrefix(lines[i], indent)) })
        i += 1
        continue
      }
      break
    }
    items.push({ type: 'listItem', content })
  }
  return {
    node: { type: 'orderedList', attrs: { start: 1 }, content: items },
    next: i,
  }
}

function serializeOrderedList(node: JSONContent, indent: number): string {
  const pad = ' '.repeat(indent)
  const hanging = ' '.repeat(indent + STEP_INDENT)
  return (node.content ?? [])
    .map((item, index) => {
      const chunks: string[] = []
      let marked = false
      for (const child of item.content ?? []) {
        if (child.type === 'orderedList') {
          chunks.push(serializeOrderedList(child, indent + STEP_INDENT))
          continue
        }
        const text = child.type === 'paragraph' ? serializeInline(child) : serializeBlock(child)
        const lines = text.split('\n')
        if (!marked) {
          chunks.push(`${pad}${index + 1}. ${lines[0] ?? ''}`)
          for (const line of lines.slice(1)) chunks.push(line ? `${hanging}${line}` : '')
          marked = true
        } else {
          for (const line of lines) chunks.push(line ? `${hanging}${line}` : hanging)
        }
      }
      if (!marked) chunks.push(`${pad}${index + 1}. `)
      return chunks.join('\n')
    })
    .join('\n')
}

function parseTable(lines: string[]): JSONContent | null {
  const rows = lines
    .map((line) =>
      line
        .trim()
        .replace(/^\|/, '')
        .replace(/\|$/, '')
        .split('|')
        .map((cell) => cell.trim()),
    )
    .filter((cells) => cells.some((cell) => cell.length > 0))

  if (rows.length < 2) return null
  const hasSep = rows[1].every((cell) => /^:?-+:?$/.test(cell))
  const header = rows[0]
  const body = hasSep ? rows.slice(2) : rows.slice(1)
  const tableRows: JSONContent[] = [
    {
      type: 'tableRow',
      content: header.map((cell) => ({
        type: 'tableHeader',
        content: [{ type: 'paragraph', content: parseInline(cell) }],
      })),
    },
    ...body.map((cells) => ({
      type: 'tableRow',
      content: padRow(cells, header.length).map((cell) => ({
        type: 'tableCell',
        content: [{ type: 'paragraph', content: parseInline(cell) }],
      })),
    })),
  ]
  return { type: 'table', content: tableRows }
}

function padRow(cells: string[], width: number): string[] {
  const next = cells.slice(0, width)
  while (next.length < width) next.push('')
  return next
}

function applyMark(nodes: JSONContent[], type: string): JSONContent[] {
  return nodes.map((node) => {
    if (node.type !== 'text') {
      return { ...node, content: applyMark(node.content ?? [], type) }
    }
    const marks = node.marks ?? []
    if (marks.some((mark) => mark.type === type)) return node
    return { ...node, marks: [...marks, { type }] }
  })
}

function parseInline(text: string): JSONContent[] {
  const nodes: JSONContent[] = []
  let i = 0
  while (i < text.length) {
    if (text.startsWith('<u>', i)) {
      const end = text.indexOf('</u>', i + 3)
      if (end >= 0) {
        nodes.push(...applyMark(parseInline(text.slice(i + 3, end)), 'underline'))
        i = end + 4
        continue
      }
    }
    if (text.startsWith('***', i)) {
      const end = text.indexOf('***', i + 3)
      if (end >= 0) {
        nodes.push(...applyMark(applyMark(parseInline(text.slice(i + 3, end)), 'bold'), 'italic'))
        i = end + 3
        continue
      }
    }
    if (text.startsWith('**', i)) {
      const end = text.indexOf('**', i + 2)
      if (end >= 0) {
        nodes.push(...applyMark(parseInline(text.slice(i + 2, end)), 'bold'))
        i = end + 2
        continue
      }
    }
    if (text[i] === '*') {
      const end = text.indexOf('*', i + 1)
      if (end >= 0) {
        nodes.push(...applyMark(parseInline(text.slice(i + 1, end)), 'italic'))
        i = end + 1
        continue
      }
    }
    let next = text.length
    const u = text.indexOf('<u>', i)
    const star = text.indexOf('*', i)
    if (u >= 0) next = Math.min(next, u)
    if (star >= 0) next = Math.min(next, star)
    if (next === i) next = i + 1
    nodes.push({ type: 'text', text: text.slice(i, next) })
    i = next
  }
  return nodes
}

function serializeBlock(node: JSONContent): string {
  switch (node.type) {
    case 'heading': {
      const level = Number(node.attrs?.level ?? 1)
      return `${'#'.repeat(Math.min(Math.max(level, 1), 3))} ${serializeInline(node)}`
    }
    case 'paragraph':
      return serializeInline(node)
    case 'note':
    case 'caution':
    case 'warning':
      return `:::${node.type}\n${(node.content ?? []).map(serializeBlock).join('\n\n')}\n:::`
    case 'orderedList':
      return serializeOrderedList(node, 0)
    case 'bulletList':
      return (node.content ?? [])
        .map((item) => `- ${serializeInline(item.content?.[0] ?? item)}`)
        .join('\n')
    case 'table':
      return serializeTable(node)
    default:
      return serializeInline(node)
  }
}

function serializeTable(node: JSONContent): string {
  const rows = node.content ?? []
  const cells = rows.map((row) =>
    (row.content ?? []).map((cell) => serializeInline(cell.content?.[0] ?? cell).replace(/\|/g, '\\|')),
  )
  if (!cells.length) return ''
  const width = Math.max(...cells.map((row) => row.length))
  const padded = cells.map((row) => {
    const next = row.slice()
    while (next.length < width) next.push('')
    return next
  })
  const header = padded[0]
  const sep = header.map(() => '---')
  const lines = [
    `| ${header.join(' | ')} |`,
    `| ${sep.join(' | ')} |`,
    ...padded.slice(1).map((row) => `| ${row.join(' | ')} |`),
  ]
  return lines.join('\n')
}

function serializeInline(node: JSONContent): string {
  if (node.type === 'text') {
    const text = node.text ?? ''
    const marks = new Set((node.marks ?? []).map((mark) => mark.type))
    let out = text
    if (marks.has('bold') && marks.has('italic')) out = `***${out}***`
    else if (marks.has('bold')) out = `**${out}**`
    else if (marks.has('italic')) out = `*${out}*`
    if (marks.has('underline')) out = `<u>${out}</u>`
    return out
  }
  return (node.content ?? []).map(serializeInline).join('')
}
