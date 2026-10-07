import { Extension, Node, mergeAttributes } from '@tiptap/core'
import Placeholder from '@tiptap/extension-placeholder'
import { TableKit } from '@tiptap/extension-table'
import StarterKit from '@tiptap/starter-kit'
import { createFigureView } from './figure-view.ts'
import { DEFAULT_MERMAID } from './mermaid.ts'
import { createMermaidView } from './mermaid-view.ts'

const STEP_MAX_DEPTH = 5

function listDepth(editor: { state: { selection: { $from: { depth: number; node: (d: number) => { type: { name: string } } } } } }): number {
  const { $from } = editor.state.selection
  let depth = 0
  for (let d = $from.depth; d > 0; d -= 1) {
    const name = $from.node(d).type.name
    if (name === 'orderedList' || name === 'bulletList') depth += 1
  }
  return depth
}

/** § ¶, nested steps and bullets, and Shift-Enter continuation paras. B/I/U are TipTap defaults. */
export const ManualKeys = Extension.create({
  name: 'manualKeys',
  priority: 1000,
  addKeyboardShortcuts() {
    return {
      'Mod-Alt-s': () => this.editor.commands.insertContent('§'),
      'Mod-Alt-p': () => this.editor.commands.insertContent('¶'),
      Tab: () => {
        if (!this.editor.isActive('listItem')) return false
        if (listDepth(this.editor) >= STEP_MAX_DEPTH) return true
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

  export const Mermaid = Node.create({
    name: 'mermaid',
    group: 'block',
    atom: true,
    selectable: true,
    draggable: false,
    addAttributes() {
      return {
        source: {
          default: DEFAULT_MERMAID,
          parseHTML: (element) => element.getAttribute('data-source') ?? '',
          renderHTML: (attributes) => ({ 'data-source': attributes.source }),
        },
      }
    },
    parseHTML() {
      return [{ tag: 'div[data-mermaid]' }]
    },
    renderHTML({ HTMLAttributes }) {
      return ['div', mergeAttributes(HTMLAttributes, { 'data-mermaid': '', class: 'mermaid-figure' })]
    },
    addNodeView() {
      return (props) => createMermaidView(props)
    },
  })

  export const FIGURE_WIDTHS = ['25%', '50%', '75%', '100%'] as const

  export const Figure = Node.create<{ manualId: string }>({
    name: 'figure',
    group: 'block',
    atom: true,
    selectable: true,
    draggable: false,
    addOptions() {
      return { manualId: '' }
    },
    addAttributes() {
      return {
        src: {
          default: '',
          parseHTML: (element) => element.getAttribute('data-src') ?? '',
          renderHTML: (attributes) => ({ 'data-src': attributes.src }),
        },
        caption: {
          default: '',
          parseHTML: (element) => element.getAttribute('data-caption') ?? '',
          renderHTML: (attributes) => ({ 'data-caption': attributes.caption }),
        },
        width: {
          default: '100%',
          parseHTML: (element) => element.getAttribute('data-width') ?? '100%',
          renderHTML: (attributes) => ({ 'data-width': attributes.width }),
        },
      }
    },
    parseHTML() {
      return [{ tag: 'figure[data-figure]' }]
    },
    renderHTML({ HTMLAttributes }) {
      return ['figure', mergeAttributes(HTMLAttributes, { 'data-figure': '', class: 'figure' })]
    },
    addNodeView() {
      const manualId = this.options.manualId
      return (props) => createFigureView(props, manualId)
    },
  })

  export function buildEditorExtensions({ manualId }: { manualId: string }) {
    return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3, 4, 5] },
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
    Mermaid,
    Figure.configure({ manualId }),
    Placeholder.configure({
      placeholder: 'Write the controlled text…',
    }),
  ]
}

export const editorExtensions = buildEditorExtensions({ manualId: '' })
