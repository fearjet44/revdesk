import { useEditor, EditorContent } from '@tiptap/react'
import { useEffect, useState, type CSSProperties } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api } from '../api.ts'
import { editorExtensions } from '../schema/extensions.ts'
import { parseSection } from '../schema/markdown.ts'
import { DEFAULT_THEME, paperCalloutStyle, stepMarkerCss, type DocTheme } from '../../server/theme.ts'
import type { Frontmatter, ManualDetail } from '../types.ts'

export function ManagedSection() {
  const { manualId, sectionId } = useParams()
  const [meta, setMeta] = useState<Frontmatter | null>(null)
  const [manual, setManual] = useState<ManualDetail | null>(null)
  const [theme, setTheme] = useState<DocTheme>(DEFAULT_THEME)
  const [error, setError] = useState<string | null>(null)

  const editor = useEditor({
    extensions: editorExtensions,
    immediatelyRender: false,
    editable: false,
    content: { type: 'doc', content: [{ type: 'paragraph' }] },
  })

  useEffect(() => {
    editor?.setEditable(false)
  }, [editor])

  useEffect(() => {
    if (!manualId || !sectionId || !editor) return
    let cancelled = false
    api
      .issuedSection(manualId, sectionId)
      .then((file) => {
        if (cancelled) return
        const parsed = parseSection(file.markdown)
        setMeta(parsed.meta)
        setManual(file.manual)
        setTheme(file.theme ?? DEFAULT_THEME)
        editor.commands.setContent(parsed.doc)
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Unable to open the managed page.')
      })
    return () => {
      cancelled = true
    }
  }, [manualId, sectionId, editor])

  if (error && !meta) return <div className="banner error">{error}</div>
  if (!meta || !manual) return <div className="empty">Pulling the managed page…</div>

  return (
    <div>
      <div className="page-head">
        <div>
          <p className="kicker">AUTOMATICALLY MANAGED · {manual.abbrev}</p>
          <h1>{meta.title}</h1>
          <p className="lede">
            Derived from the launched book. Not an author page. Open a procedure leaf to edit.
          </p>
        </div>
        <div className="actions">
          <Link className="btn ghost" to={`/manuals/${manual.id}`}>
            Back to manual
          </Link>
        </div>
      </div>

      {error ? <div className="banner error">{error}</div> : null}

      <style>{stepMarkerCss(theme.steps.markers)}</style>
      <div className="paper-wrap is-readonly" style={paperCalloutStyle(theme) as CSSProperties}>
        <h2 className="title-field">{meta.title}</h2>
        <EditorContent editor={editor} />
      </div>
    </div>
  )
}
