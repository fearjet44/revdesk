import { Editor } from '@tiptap/core'
import { editorExtensions } from '../src/schema/extensions.ts'
import { parseBody, serializeBody } from '../src/schema/markdown.ts'

let failed = 0

function check(label: string, ok: boolean, detail?: string) {
  if (ok) {
    console.log(`ok ${label}`)
    return
  }
  failed += 1
  console.error(`FAIL ${label}${detail ? `\n${detail}` : ''}`)
}

function withEditor(body: string, fn: (editor: Editor) => void) {
  const editor = new Editor({
    extensions: editorExtensions,
    content: parseBody(body),
  })
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
    if ($from.node(d).type.name === 'orderedList') depth += 1
  }
  return depth
}

function selectText(editor: Editor, needle: string): boolean {
  let from = -1
  editor.state.doc.descendants((node, pos) => {
    if (from >= 0 || !node.isText || node.text !== needle) return
    from = pos
  })
  if (from < 0) return false
  return editor.commands.setTextSelection(from + needle.length)
}

withEditor('1. Alpha\n2. Bravo\n', (editor) => {
  check('cursor on Bravo', selectText(editor, 'Bravo'))
  check('start depth 1', listDepth(editor) === 1, serializeBody(editor.getJSON()))
  const sunk = editor.commands.sinkListItem('listItem')
  check('Tab nests second step', sunk && listDepth(editor) === 2, serializeBody(editor.getJSON()))
  const md = serializeBody(editor.getJSON())
  check('nested markdown indent', md.includes('   1. Bravo'), md)
  const lifted = editor.commands.liftListItem('listItem')
  check('Shift+Tab promotes', lifted && listDepth(editor) === 1, serializeBody(editor.getJSON()))
})

withEditor('1. Alpha\n', (editor) => {
  check('cursor on Alpha', selectText(editor, 'Alpha'))
  const split = editor.commands.splitBlock()
  check('Shift+Enter splits in item', split)
  const md = serializeBody(editor.getJSON())
  check(
    'continuation para same item',
    md.startsWith('1. Alpha\n   ') && !md.includes('\n2. '),
    md,
  )
  const item = editor.getJSON().content?.[0]?.content?.[0]
  check('two paras in the same item', (item?.content?.length ?? 0) === 2, md)
})

withEditor('1. A\n2. B\n', (editor) => {
  check('cursor on B', selectText(editor, 'B'))
  check('sink B', editor.commands.sinkListItem('listItem') && listDepth(editor) === 2)
  check('split at 2', editor.commands.splitListItem('listItem'))
  check('type C', editor.commands.insertContent({ type: 'text', text: 'C' }))
  check('sink C', editor.commands.sinkListItem('listItem') && listDepth(editor) === 3)
  check('split at 3', editor.commands.splitListItem('listItem'))
  check('type D', editor.commands.insertContent({ type: 'text', text: 'D' }))
  check('sink D', editor.commands.sinkListItem('listItem') && listDepth(editor) === 4)
  check('split at 4', editor.commands.splitListItem('listItem'))
  check('type E', editor.commands.insertContent({ type: 'text', text: 'E' }))
  check('sink E', editor.commands.sinkListItem('listItem') && listDepth(editor) === 5)
  const fifth = editor.commands.sinkListItem('listItem')
  check('sixth nest refused', !fifth && listDepth(editor) === 5, serializeBody(editor.getJSON()))
})

if (failed) process.exit(1)
console.log(`pass steps-check fail=${failed}`)
