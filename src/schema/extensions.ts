import { Node, mergeAttributes } from '@tiptap/core'
import Placeholder from '@tiptap/extension-placeholder'
import { TableKit } from '@tiptap/extension-table'
import StarterKit from '@tiptap/starter-kit'

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
  }),
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
