import type { NodeViewRenderer, NodeViewRendererProps } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { Selection } from '@tiptap/pm/state'
import { FIGURE_ACCEPT, uploadOrReport, type FigureHooks } from './figure-insert.ts'

const WIDTHS = ['25%', '50%', '75%', '100%']

export function createFigureView(
  { node, editor, getPos }: NodeViewRendererProps,
  manualId: string,
  hooks: FigureHooks,
): ReturnType<NodeViewRenderer> {
  const wrap = document.createElement('figure')
  wrap.className = 'figure'
  wrap.setAttribute('data-figure', '')
  wrap.contentEditable = 'false'

  const frame = document.createElement('div')
  frame.className = 'figure-frame'
  const img = document.createElement('img')
  img.alt = ''
  const missing = document.createElement('div')
  missing.className = 'figure-missing'
  missing.hidden = true
  frame.append(img, missing)

  const caption = document.createElement('input')
  caption.type = 'text'
  caption.className = 'figure-caption'
  caption.placeholder = 'Caption'
  caption.setAttribute('aria-label', 'Figure caption')
  const text = document.createElement('figcaption')

  const tools = document.createElement('div')
  tools.className = 'figure-tools'
  tools.setAttribute('role', 'group')
  tools.setAttribute('aria-label', 'Figure size and image')
  const sizeButtons = WIDTHS.map((width) => {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'figure-width'
    button.textContent = width
    button.setAttribute('aria-label', `Width ${width}`)
    button.addEventListener('click', () => patch({ width }))
    return button
  })
  const replace = document.createElement('button')
  replace.type = 'button'
  replace.className = 'figure-replace'
  replace.textContent = 'Replace image'
  const picker = document.createElement('input')
  picker.type = 'file'
  picker.accept = FIGURE_ACCEPT
  picker.hidden = true
  picker.setAttribute('data-figure-replace', '')
  tools.append(...sizeButtons, replace, picker)
  wrap.append(frame, tools, caption, text)

  let shownSrc = ''
  let selected = false

  function patch(attrs: Record<string, unknown>) {
    const pos = getPos()
    if (typeof pos !== 'number') return
    const current = editor.state.doc.nodeAt(pos)
    if (!current) return
    editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { ...current.attrs, ...attrs }))
  }

  function paint(current: PMNode) {
    const src = String(current.attrs.src ?? '')
    const file = src.split('/').pop() ?? src
    if (src !== shownSrc) {
      shownSrc = src
      missing.hidden = true
      img.hidden = false
      img.src = `/api/manuals/${encodeURIComponent(manualId)}/figures/${encodeURIComponent(file)}`
      missing.textContent = `Figure missing: ${file}`
    }
    wrap.className = `figure figure-w${String(current.attrs.width ?? '100%').replace('%', '')}${selected ? ' is-selected' : ''}`
    const cap = String(current.attrs.caption ?? '')
    const editable = editor.isEditable
    caption.hidden = !editable
    tools.hidden = !editable || !hooks.upload
    const width = String(current.attrs.width ?? '100%')
    sizeButtons.forEach((button) => button.setAttribute('aria-pressed', String(button.textContent === width)))
    text.hidden = editable || !cap
    text.textContent = cap
    if (document.activeElement !== caption && caption.value !== cap) caption.value = cap
  }

  img.addEventListener('error', () => {
    img.hidden = true
    missing.hidden = false
  })

  caption.addEventListener('input', () => {
    const pos = getPos()
    if (typeof pos !== 'number') return
    const current = editor.state.doc.nodeAt(pos)
    const next = caption.value.replace(/\n/g, ' ')
    if (!current || current.attrs.caption === next) return
    editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { ...current.attrs, caption: next }))
  })

  replace.addEventListener('click', () => picker.click())
  picker.addEventListener('change', () => {
    const file = picker.files?.[0]
    picker.value = ''
    if (!file) return
    replace.disabled = true
    void uploadOrReport(hooks, file)
      .then((src) => {
        if (src) patch({ src })
      })
      .finally(() => {
        replace.disabled = false
      })
  })

  caption.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' || event.isComposing) return
    event.preventDefault()
    const pos = getPos()
    if (typeof pos !== 'number') return
    const current = editor.state.doc.nodeAt(pos)
    if (!current) return
    const end = pos + current.nodeSize
    const tr = editor.state.tr
    if (end >= tr.doc.content.size) tr.insert(end, editor.schema.nodes.paragraph.create())
    tr.setSelection(Selection.near(tr.doc.resolve(end), 1))
    editor.view.dispatch(tr.scrollIntoView())
    editor.view.focus()
  })

  paint(node)

  return {
    dom: wrap,
    update(updated: PMNode) {
      if (updated.type.name !== 'figure') return false
      paint(updated)
      return true
    },
    selectNode() {
      selected = true
      wrap.classList.add('is-selected')
    },
    deselectNode() {
      selected = false
      wrap.classList.remove('is-selected')
    },
    stopEvent(event: Event) {
      const target = event.target as Node | null
      return Boolean(target && (caption.contains(target) || tools.contains(target)))
    },
    ignoreMutation: () => true,
  }
}
