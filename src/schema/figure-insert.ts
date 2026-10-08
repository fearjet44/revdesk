import { Selection } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'

/** Mirrors FIGURE_MAX_BYTES in server/figures.ts (that module pulls in node:fs, so the browser cannot import it). */
export const FIGURE_MAX_BYTES = 10 * 1024 * 1024
export const FIGURE_ACCEPT = 'image/png,image/jpeg,image/gif,image/svg+xml,image/webp'
export const FIGURE_TOO_BIG = 'Figure is over the 10 MB limit.'
export const FIGURE_ONLY_IMAGES = 'Only images can be added as figures: PNG, JPEG, GIF, SVG, WebP.'

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

/** Where a dropped file lands: the drop point clamped into the text box, so the gutter, margins and title all work. */
function dropPos(view: EditorView, clientX: number, clientY: number): number | null {
  const box = view.dom.getBoundingClientRect()
  if (clientY < box.top) return 0
  if (clientY > box.bottom) return null
  const left = Math.min(Math.max(clientX, box.left + 1), box.right - 1)
  const top = Math.min(Math.max(clientY, box.top + 1), box.bottom - 1)
  return view.posAtCoords({ left, top })?.pos ?? null
}

/** The end of the document, with an empty paragraph to land in when the last block is a table or figure (so it does not go into the last cell). */
function endPos(view: EditorView): number {
  const { doc, schema } = view.state
  if (!doc.lastChild?.isTextblock) view.dispatch(view.state.tr.insert(doc.content.size, schema.nodes.paragraph.create()))
  return view.state.doc.content.size
}

/** Take the first image of a drop and insert it at the nearest block. Returns false when there was nothing to take. */
export function dropFigure(view: EditorView, hooks: FigureHooks, files: FileList | null | undefined, clientX: number, clientY: number): boolean {
  if (!view.editable || !hooks.upload || !files?.length) return false
  const [file] = imageFiles(files)
  if (!file) {
    hooks.onError?.(FIGURE_ONLY_IMAGES)
    return true
  }
  const pos = dropPos(view, clientX, clientY)
  void uploadOrReport(hooks, file).then((src) => {
    if (src) insertFigure(view, src, pos ?? endPos(view))
  })
  return true
}
