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

    const step = line.match(/^(\d+)\.\s+(.*)$/)
    if (step) {
      const items: JSONContent[] = []
      while (i < lines.length) {
        const item = lines[i].match(/^\d+\.\s+(.*)$/)
        if (!item) break
        items.push({
          type: 'listItem',
          content: [{ type: 'paragraph', content: parseInline(item[1]) }],
        })
        i += 1
      }
      blocks.push({ type: 'orderedList', attrs: { start: 1 }, content: items })
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

function parseInline(text: string): JSONContent[] {
  const nodes: JSONContent[] = []
  const pattern = /(\*\*[^*]+\*\*|\*[^*]+\*)/g
  let last = 0
  let match: RegExpExecArray | null
  while ((match = pattern.exec(text))) {
    if (match.index > last) nodes.push({ type: 'text', text: text.slice(last, match.index) })
    const token = match[0]
    if (token.startsWith('**')) {
      nodes.push({ type: 'text', text: token.slice(2, -2), marks: [{ type: 'bold' }] })
    } else {
      nodes.push({ type: 'text', text: token.slice(1, -1), marks: [{ type: 'italic' }] })
    }
    last = match.index + token.length
  }
  if (last < text.length) nodes.push({ type: 'text', text: text.slice(last) })
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
      return (node.content ?? [])
        .map((item, index) => {
          const inner = (item.content ?? []).map(serializeBlock).join('\n\n')
          const [first, ...rest] = inner.split('\n')
          const head = `${index + 1}. ${first}`
          const tail = rest.map((line) => (line ? `   ${line}` : '')).join('\n')
          return tail ? `${head}\n${tail}` : head
        })
        .join('\n')
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
    if (marks.has('bold') && marks.has('italic')) return `***${text}***`
    if (marks.has('bold')) return `**${text}**`
    if (marks.has('italic')) return `*${text}*`
    return text
  }
  return (node.content ?? []).map(serializeInline).join('')
}
