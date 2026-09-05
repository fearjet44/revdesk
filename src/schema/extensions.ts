import { Extension, Node, mergeAttributes } from '@tiptap/core'
import Placeholder from '@tiptap/extension-placeholder'
import { TableKit } from '@tiptap/extension-table'
import StarterKit from '@tiptap/starter-kit'

const STEP_MAX_DEPTH = 5

function orderedListDepth(editor: { state: { selection: { $from: { depth: number; node: (d: number) => { type: { name: string } } } } } }): number {
  const { $from } = editor.state.selection
  let depth = 0
  for (let d = $from.depth; d > 0; d -= 1) {
    if ($from.node(d).type.name === 'orderedList') depth += 1
  }
  return depth
}

/** § ¶, nested steps, and Shift-Enter continuation paras. B/I/U are TipTap defaults. */
export const ManualKeys = Extension.create({
  name: 'manualKeys',
  priority: 1000,
  addKeyboardShortcuts() {
    return {
      'Mod-Alt-s': () => this.editor.commands.insertContent('§'),
      'Mod-Alt-p': () => this.editor.commands.insertContent('¶'),
      Tab: () => {
        if (!this.editor.isActive('listItem')) return false
        if (orderedListDepth(this.editor) >= STEP_MAX_DEPTH) return true
        return this.editor.commands.sinkListItem('listItem') || true
      },
      'Shift-Tab': () => {
        if (!this.editor.isActive('listItem')) return false
        return this.editor.commands.liftListItem('listItem') || true
      },
      'Shift-Enter': () => {
        if (!this.editor.isActive('listItem')) return false
        return this.editor.commands.splitBlock()
      },
    }
  },
})

const CALLOUTS = ['note', 'caution', 'warning'] as const

function callout(name: (typeof CALLOUTS)[number]) {
  return Node.create({
    name,
    group: 'block',
    content: 'block+',
    defining: true,
    parseHTML() {
      return [{ tag: `aside[data-callout="${name}"]` }]
    },
    renderHTML({ HTMLAttributes }) {
      return [
        'aside',
        mergeAttributes(HTMLAttributes, {
          'data-callout': name,
          class: `callout callout-${name}`,
        }),
        0,
      ]
    },
  })
}

export const Note = callout('note')
export const Caution = callout('caution')
export const Warning = callout('warning')

export const editorExtensions = [
  StarterKit.configure({
    heading: { levels: [1, 2, 3] },
    bulletList: false,
    blockquote: false,
    codeBlock: false,
    code: false,
    horizontalRule: false,
    strike: false,
    link: false,
    hardBreak: false,
  }),
  ManualKeys,
  TableKit.configure({
    table: { resizable: false },
  }),
  Note,
  Caution,
  Warning,
  Placeholder.configure({
    placeholder: 'Write the controlled text…',
  }),
]
