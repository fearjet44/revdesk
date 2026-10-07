import type { NodeViewRenderer, NodeViewRendererProps } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'

export function createFigureView({ node, editor, getPos }: NodeViewRendererProps, manualId: string): ReturnType<NodeViewRenderer> {
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
  wrap.append(frame, caption, text)

  let shownSrc = ''
  let selected = false

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
    if (!current) return
    editor.view.dispatch(
      editor.state.tr.setNodeMarkup(pos, undefined, { ...current.attrs, caption: caption.value.replace(/\n/g, ' ') }),
    )
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
      return Boolean(target && caption.contains(target))
    },
    ignoreMutation: () => true,
  }
}
