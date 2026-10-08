import { Selection } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'

/** Mirrors FIGURE_MAX_BYTES in server/figures.ts (that module pulls in node:fs, so the browser cannot import it). */
export const FIGURE_MAX_BYTES = 10 * 1024 * 1024
export const FIGURE_ACCEPT = 'image/png,image/jpeg,image/gif,image/svg+xml,image/webp'
export const FIGURE_TOO_BIG = 'Figure is over the 10 MB limit.'

export type FigureUpload = (file: File) => Promise<string>
export type FigureHooks = { upload: FigureUpload | null; onError: ((message: string) => void) | null }

export function imageFiles(list: FileList | null | undefined): File[] {
  return Array.from(list ?? []).filter((file) => file.type.startsWith('image/'))
}

/** Upload one file and report a failure instead of throwing, so callers stay one line. */
export async function uploadOrReport(hooks: FigureHooks, file: File): Promise<string | null> {
  if (!hooks.upload) return null
  try {
    return await hooks.upload(file)
  } catch (error) {
    hooks.onError?.(error instanceof Error ? error.message : 'Could not add the figure.')
    return null
  }
}

/** Insert a figure block at `pos` (or the selection), split out of any paragraph, and focus its caption. */
export function insertFigure(view: EditorView, src: string, pos?: number | null): void {
  const { state } = view
  const type = state.schema.nodes.figure
  if (!type) return
  const tr = state.tr
  if (typeof pos === 'number') {
    tr.setSelection(Selection.near(tr.doc.resolve(Math.min(Math.max(pos, 0), tr.doc.content.size))))
  }
  const from = tr.selection.from
  const node = type.create({ src, caption: '', width: '100%' })
  tr.replaceSelectionWith(node)
  let at = -1
  tr.doc.nodesBetween(Math.max(0, tr.mapping.map(from, -1) - 1), Math.min(tr.doc.content.size, tr.mapping.map(from) + 1), (child, p) => {
    if (at < 0 && child === node) at = p
    return at < 0
  })
  if (at < 0) {
    tr.doc.descendants((child, p) => {
      if (at < 0 && child.type === type && child.attrs.src === src && p >= from - 1) at = p
      return at < 0
    })
  }
  if (at >= 0 && at + node.nodeSize >= tr.doc.content.size) {
    tr.insert(at + node.nodeSize, state.schema.nodes.paragraph.create())
  }
  view.dispatch(tr.scrollIntoView())
  if (at < 0) return
  const dom = view.nodeDOM(at)
  if (dom instanceof HTMLElement) dom.querySelector<HTMLInputElement>('input.figure-caption')?.focus()
}
