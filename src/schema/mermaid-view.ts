import type { NodeViewRenderer, NodeViewRendererProps } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { MERMAID_INIT } from './mermaid.ts'

type MermaidApi = {
  initialize: (config: typeof MERMAID_INIT) => void
  render: (id: string, source: string) => Promise<{ svg: string }>
}

let mermaidPromise: Promise<MermaidApi> | null = null
let seq = 0

function loadMermaid(): Promise<MermaidApi> {
  mermaidPromise ??= import('mermaid').then((mod) => {
    const mermaid = (mod.default ?? mod) as MermaidApi
    mermaid.initialize(MERMAID_INIT)
    return mermaid
  })
  return mermaidPromise
}

export const createMermaidView: NodeViewRenderer = ({ node, editor, getPos }: NodeViewRendererProps) => {
  const wrap = document.createElement('div')
  wrap.className = 'mermaid-figure'
  wrap.setAttribute('data-mermaid', '')
  wrap.contentEditable = 'false'

  const kicker = document.createElement('div')
  kicker.className = 'mermaid-kicker'
  kicker.textContent = 'Mermaid'

  const sourceBox = document.createElement('textarea')
  sourceBox.className = 'mermaid-source'
  sourceBox.rows = 8
  sourceBox.spellcheck = false
  sourceBox.setAttribute('aria-label', 'Mermaid source')
  sourceBox.value = String(node.attrs.source ?? '')

  const err = document.createElement('div')
  err.className = 'mermaid-error'
  err.hidden = true

  const preview = document.createElement('div')
  preview.className = 'mermaid-preview'

  wrap.append(kicker, sourceBox, err, preview)

  function syncChrome() {
    const showSource = editor.isEditable && wrap.classList.contains('is-selected')
    sourceBox.hidden = !showSource
    kicker.hidden = !editor.isEditable
  }
  syncChrome()

  let renderGen = 0
  let timer = 0

  async function render(source: string) {
    const gen = ++renderGen
    const trimmed = source.trim()
    if (!trimmed) {
      preview.replaceChildren()
      err.textContent = 'Write a mermaid diagram.'
      err.hidden = false
      return
    }
    try {
      const mermaid = await loadMermaid()
      if (gen !== renderGen) return
      const id = `revdeskMmd${seq += 1}`
      const { svg } = await mermaid.render(id, trimmed)
      if (gen !== renderGen) return
      preview.innerHTML = svg
      err.hidden = true
      err.textContent = ''
    } catch (error) {
      if (gen !== renderGen) return
      preview.replaceChildren()
      err.textContent = error instanceof Error ? error.message : 'Diagram failed.'
      err.hidden = false
    }
  }

  void render(sourceBox.value)

  sourceBox.addEventListener('input', () => {
    const value = sourceBox.value
    const pos = getPos()
    if (typeof pos === 'number') {
      editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { source: value }))
    }
    window.clearTimeout(timer)
    timer = window.setTimeout(() => void render(value), 200)
  })

  return {
    dom: wrap,
    update(updated: PMNode) {
      if (updated.type.name !== 'mermaid') return false
      const source = String(updated.attrs.source ?? '')
      if (document.activeElement !== sourceBox && sourceBox.value !== source) {
        sourceBox.value = source
        void render(source)
      }
      syncChrome()
      return true
    },
    selectNode() {
      wrap.classList.add('is-selected')
      syncChrome()
    },
    deselectNode() {
      wrap.classList.remove('is-selected')
      syncChrome()
    },
    stopEvent(event: Event) {
      const target = event.target as Node | null
      return Boolean(target && sourceBox.contains(target))
    },
    ignoreMutation: () => true,
    destroy() {
      window.clearTimeout(timer)
      renderGen += 1
    },
  }
}
