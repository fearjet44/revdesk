import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Editor } from '@tiptap/core'
import { editorExtensions } from '../src/schema/extensions.ts'
import { buildManualHtml, type IssuedBook } from '../server/print.ts'
import { DEFAULT_THEME } from '../server/theme.ts'
import {
  blockSourceRanges,
  parseBody,
  parseSection,
  serializeBody,
  splitFrontmatter,
  withFrontmatter,
} from '../src/schema/markdown.ts'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
let failed = 0

function check(label: string, ok: boolean, detail?: string) {
  if (ok) {
    console.log(`ok ${label}`)
    return
  }
  failed += 1
  console.error(`FAIL ${label}${detail ? `\n${detail}` : ''}`)
}

// Round trip: parse(serialize(doc)) equals doc, and serialize(parse(text)) equals text.
const cases: Array<[string, string]> = [
  ['flat bullets', '- Alpha\n- Bravo\n- Charlie\n'],
  ['nested bullets', '- Alpha\n   - Bravo\n      - Charlie\n   - Delta\n- Echo\n'],
  ['bullets inside steps', '1. Do this:\n   - first\n   - second\n2. Then that.\n'],
  ['steps inside bullets', '- Before you go:\n   1. Check fuel\n   2. Check weather\n- Done.\n'],
  ['mixed three deep', '1. Top\n   - Mid\n      1. Low\n      2. Lower\n   - Mid two\n2. Next\n'],
  ['marks in bullets', '- **bold** and *italic* and <u>under</u> and ***both***\n- <u>**PIC**</u> decides\n'],
  ['continuation paragraph', '- First line\n   second paragraph in the item\n- Next\n'],
  ['bullets then steps', '- a\n- b\n\n1. one\n2. two\n'],
  ['steps then bullets', '1. one\n2. two\n\n- a\n- b\n'],
  ['paragraph around lists', 'Intro text.\n\n- a\n- b\n\nOutro text.\n'],
  ['bullets in callout', ':::note\n- keep this\n- and this\n:::\n'],
  ['callout then bullets', ':::caution\nCareful.\n:::\n\n- after\n'],
  ['empty bullet', '- \n- x\n'],
]
for (const [label, text] of cases) {
  const doc = parseBody(text)
  const out = serializeBody(doc)
  check(`text stable: ${label}`, out === text, out)
  check(`doc stable: ${label}`, JSON.stringify(parseBody(out)) === JSON.stringify(doc))
}

// A list item ends the paragraph above; dashes elsewhere stay text.
const above = parseBody('Intro line\n- a\n- b\n')
check(
  'bullet line ends the paragraph above',
  above.content?.[0]?.type === 'paragraph' && above.content?.[1]?.type === 'bulletList',
  JSON.stringify(above),
)
for (const text of ['a - b - c', '--', '-text', 'pre -- post', '--- rule-ish', '-']) {
  const doc = parseBody(`${text}\n`)
  check(
    `stays paragraph: ${text}`,
    doc.content?.length === 1 && doc.content[0].type === 'paragraph' && serializeBody(doc) === `${text}\n`,
    JSON.stringify(doc),
  )
}
const wrapped = parseBody('line one\nline - two\n')
check('mid-line dash does not split', wrapped.content?.length === 1 && wrapped.content[0].type === 'paragraph')

// Shape of a mixed tree.
const mixed = parseBody('- A\n   1. B\n      - C\n')
const a = mixed.content?.[0]
const b = a?.content?.[0]?.content?.[1]
const c = b?.content?.[0]?.content?.[1]
check('mixed shape', a?.type === 'bulletList' && b?.type === 'orderedList' && c?.type === 'bulletList', JSON.stringify(mixed))

// Depth cap: STEP_MAX_DEPTH = 5 lists total; a sixth level is item text, not a list.
const deep = parseBody('- 1\n   - 2\n      - 3\n         - 4\n            - 5\n               - 6\n')
let levels = 0
let node = deep.content?.[0]
while (node && (node.type === 'bulletList' || node.type === 'orderedList')) {
  levels += 1
  node = node.content?.[0]?.content?.find((child) => child.type === 'bulletList' || child.type === 'orderedList')
}
check('depth capped at five', levels === 5, `levels=${levels}`)

// Source ranges follow parseBody block order.
const rangeSrc = withFrontmatter(
  { id: 'x', title: 'X', rev_last_changed: 'R1' },
  '# Head\n\nIntro\n- a\n- b\n\n1. one\n   - nested\n2. two\n- tail\n\nEnd.\n',
)
const ranges = blockSourceRanges(rangeSrc)
const types = (parseSection(rangeSrc).doc.content ?? []).map((block) => block.type)
check(
  'block ranges match parse order',
  ranges.length === types.length,
  `${ranges.length} ranges vs ${types.join(',')}`,
)
check('types in order', types.join(',') === 'heading,paragraph,bulletList,orderedList,bulletList,paragraph', types.join(','))

// Every leaf body in data/ and fixtures/ round-trips byte for byte. (Frontmatter is not the
// schema's concern: it drops quotes around some titles, same as before this task.)
function walkMd(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walkMd(abs))
    else if (entry.name.endsWith('.md')) out.push(abs)
  }
  return out
}
const leaves = [
  ...walkMd(path.join(root, 'data', 'manuals')),
  ...walkMd(path.join(root, 'fixtures')),
].filter((abs) => abs.includes(`${path.sep}sections${path.sep}`))
let sweepFailed = 0
for (const abs of leaves.sort()) {
  const { body } = splitFrontmatter(readFileSync(abs, 'utf8'))
  if (serializeBody(parseBody(body)) !== body.replace(/\n*$/, '\n')) {
    sweepFailed += 1
    console.error(`NOT BYTE-IDENTICAL ${path.relative(root, abs)}`)
  }
}
check(`all ${leaves.length} leaf bodies byte-identical`, leaves.length > 0 && sweepFailed === 0)

// Editor behavior.
function withEditor(content: unknown, fn: (editor: Editor) => void) {
  const editor = new Editor({ extensions: editorExtensions, content: content as never })
  try {
    fn(editor)
  } finally {
    editor.destroy()
  }
}

function listDepth(editor: Editor): number {
  const { $from } = editor.state.selection
  let depth = 0
  for (let d = $from.depth; d > 0; d -= 1) {
    const name = $from.node(d).type.name
    if (name === 'orderedList' || name === 'bulletList') depth += 1
  }
  return depth
}

function selectText(editor: Editor, needle: string): boolean {
  let from = -1
  editor.state.doc.descendants((n, pos) => {
    if (from >= 0 || !n.isText || n.text !== needle) return
    from = pos
  })
  if (from < 0) return false
  return editor.commands.setTextSelection(from + needle.length)
}

withEditor(parseBody('- Alpha\n- Bravo\n'), (editor) => {
  check('bullets load into the editor', editor.state.doc.firstChild?.type.name === 'bulletList')
  check('cursor on Bravo', selectText(editor, 'Bravo'))
  check('sink bullet', editor.commands.sinkListItem('listItem') && listDepth(editor) === 2)
  const md = serializeBody(editor.getJSON())
  check('nested bullet markdown', md === '- Alpha\n   - Bravo\n', md)
  check('lift bullet', editor.commands.liftListItem('listItem') && listDepth(editor) === 1)
})

withEditor(parseBody('Plain\n'), (editor) => {
  check('cursor on Plain', selectText(editor, 'Plain'))
  check('toggle bullets on', editor.chain().toggleBulletList().run() && editor.isActive('bulletList'))
  check('bullets markdown', serializeBody(editor.getJSON()) === '- Plain\n')
  check('toggle bullets off', editor.chain().toggleBulletList().run() && !editor.isActive('bulletList'))
  check('plain again', serializeBody(editor.getJSON()) === 'Plain\n')
})

withEditor(parseBody('1. Alpha\n2. Bravo\n'), (editor) => {
  check('cursor on Bravo (steps)', selectText(editor, 'Bravo'))
  check('sink into steps', editor.commands.sinkListItem('listItem'))
  check('toggle bullets on nested step', editor.chain().toggleBulletList().run())
  const md = serializeBody(editor.getJSON())
  check('bullets nested under a step', md === '1. Alpha\n   - Bravo\n', md)
})

withEditor(parseBody('- A\n'), (editor) => {
  check('cursor on A', selectText(editor, 'A'))
  for (const [name, text] of [['B', 'B'], ['C', 'C'], ['D', 'D'], ['E', 'E']] as const) {
    check(`split before ${name}`, editor.commands.splitListItem('listItem'))
    check(`type ${name}`, editor.commands.insertContent({ type: 'text', text }))
    check(`sink ${name}`, editor.commands.sinkListItem('listItem'))
  }
  check('five levels deep', listDepth(editor) === 5, serializeBody(editor.getJSON()))
})

// Paper.
const book: IssuedBook = {
  manual: {
    id: 'gom',
    title: 'General Operations Manual',
    abbrev: 'GOM',
    control_class: 'faa-accepted',
    control: 'FAA accepted',
    owner: 'Chief Pilot',
    authority: 'poi',
    instrument_required: true,
    current_issued: 'GOM-R13',
    next_revision: 14,
    effective: '2025-12-31',
  },
  theme: DEFAULT_THEME,
  files: [
    {
      path: 'manuals/gom/sections/000-lists.md',
      meta: { id: 'gom-lists', title: 'Lists', rev_last_changed: 'R13' },
      markdown: `---
id: gom-lists
title: Lists
rev_last_changed: R13
---

# Lists

- **Alpha** item
   - nested
      - deeper
- Bravo

1. Step one
   - bullet in step
2. Step two
`,
      body: '# Lists\n',
    },
  ],
}
const html = buildManualHtml(book, { kind: 'reference', downloadedAt: new Date(Date.UTC(2026, 8, 5)) }).html
check('print renders ul', html.includes('<ul><li><p><strong>Alpha</strong> item</p><ul><li><p>nested</p><ul><li><p>deeper</p></li></ul></li></ul></li><li><p>Bravo</p></li></ul>'))
check('print keeps ol for steps', html.includes('<ol><li><p>Step one</p><ul><li><p>bullet in step</p></li></ul></li><li><p>Step two</p></li></ol>'))
check('print has disc/circle/square', html.includes('list-style: disc') && html.includes('list-style: circle') && html.includes('list-style: square'))
check('print bullets do not advance step counter', html.includes('.ProseMirror ul > li { counter-increment: none; }'))

if (failed) {
  console.error(`\n${failed} failed`)
  process.exit(1)
}
console.log('\nok bullets-check')
