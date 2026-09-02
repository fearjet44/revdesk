import { useEditor, EditorContent } from '@tiptap/react'
import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api } from '../api.ts'
import { editorExtensions } from '../schema/extensions.ts'
import { parseSection, serializeSection } from '../schema/markdown.ts'
import type { Frontmatter, SectionFile } from '../types.ts'

export function SectionEditor({ onChanged }: { onChanged: () => Promise<void> }) {
  const { changeId, sectionId } = useParams()
  const [meta, setMeta] = useState<Frontmatter | null>(null)
  const [path, setPath] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(true)
  const [busy, setBusy] = useState(false)

  const editor = useEditor({
    extensions: editorExtensions,
    immediatelyRender: false,
    shouldRerenderOnTransaction: true,
    content: { type: 'doc', content: [{ type: 'paragraph' }] },
    onUpdate: () => setSaved(false),
  })

  useEffect(() => {
    if (!changeId || !sectionId || !editor) return
    let cancelled = false
    api
      .workingSection(changeId, sectionId)
      .then((file: SectionFile) => {
        if (cancelled) return
        const parsed = parseSection(file.markdown)
        setMeta(parsed.meta)
        setPath(file.path)
        editor.commands.setContent(parsed.doc)
        setSaved(true)
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Unable to open working copy.')
      })
    return () => {
      cancelled = true
    }
  }, [changeId, sectionId, editor])

  const canSave = useMemo(() => Boolean(editor && meta && changeId && sectionId && !saved), [editor, meta, changeId, sectionId, saved])

  async function save() {
    if (!editor || !meta || !changeId || !sectionId) return
    setBusy(true)
    setError(null)
    try {
      const markdown = serializeSection(meta, editor.getJSON())
      const file = await api.saveWorkingSection(changeId, sectionId, markdown)
      setMeta(file.meta)
      setSaved(true)
      await onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed.')
    } finally {
      setBusy(false)
    }
  }

  function insertCallout(type: 'note' | 'caution' | 'warning') {
    editor?.chain().focus().insertContent({ type, content: [{ type: 'paragraph' }] }).run()
  }

  if (!changeId || !sectionId) return null

  return (
    <>
      <div className="page-head">
        <div>
          <p className="kicker">WORKING COPY · {changeId}</p>
          <h1>{meta?.title ?? 'Section'}</h1>
          <p className="lede">
            Edits write Markdown with YAML frontmatter to the working folder. Issued text is
            unchanged until this change is issued.
          </p>
        </div>
        <div className="actions">
          <Link className="btn ghost" to={`/changes/${changeId}`}>
            Back to packet
          </Link>
          <button className="btn primary" type="button" disabled={!canSave || busy} onClick={() => void save()}>
            {busy ? 'Writing…' : saved ? 'Saved' : 'Write section'}
          </button>
        </div>
      </div>

      {error ? <div className="banner error">{error}</div> : null}

      <div className="editor-chrome">
        <div className="toolbar">
          <button type="button" className={editor?.isActive('heading', { level: 1 }) ? 'is-on' : ''} onClick={() => editor?.chain().focus().toggleHeading({ level: 1 }).run()}>
            H1
          </button>
          <button type="button" className={editor?.isActive('heading', { level: 2 }) ? 'is-on' : ''} onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()}>
            H2
          </button>
          <button type="button" className={editor?.isActive('heading', { level: 3 }) ? 'is-on' : ''} onClick={() => editor?.chain().focus().toggleHeading({ level: 3 }).run()}>
            H3
          </button>
          <button type="button" className={editor?.isActive('paragraph') ? 'is-on' : ''} onClick={() => editor?.chain().focus().setParagraph().run()}>
            Para
          </button>
          <button type="button" className={editor?.isActive('bold') ? 'is-on' : ''} onClick={() => editor?.chain().focus().toggleBold().run()}>
            Bold
          </button>
          <button type="button" className={editor?.isActive('italic') ? 'is-on' : ''} onClick={() => editor?.chain().focus().toggleItalic().run()}>
            Italic
          </button>
          <button type="button" className={editor?.isActive('orderedList') ? 'is-on' : ''} onClick={() => editor?.chain().focus().toggleOrderedList().run()}>
            Steps
          </button>
          <button type="button" onClick={() => insertCallout('note')}>Note</button>
          <button type="button" onClick={() => insertCallout('caution')}>Caution</button>
          <button type="button" onClick={() => insertCallout('warning')}>Warning</button>
          <button type="button" onClick={() => editor?.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}>
            Table
          </button>
        </div>
        <div className="editor-meta">
          <span>
            {meta?.id} · rev last changed {meta?.rev_last_changed}
          </span>
          <span>{path || `control/working/${changeId}`}</span>
        </div>
      </div>

      <div className="paper-wrap">
        {meta ? (
          <input
            className="title-field"
            value={meta.title}
            onChange={(event) => {
              setMeta({ ...meta, title: event.target.value })
              setSaved(false)
            }}
          />
        ) : null}
        <EditorContent editor={editor} />
      </div>
    </>
  )
}
