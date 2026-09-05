import { useEditor, EditorContent } from '@tiptap/react'
import { useEffect, useState, type CSSProperties } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api } from '../api.ts'
import { editorExtensions } from '../schema/extensions.ts'
import { parseSection } from '../schema/markdown.ts'
import { DEFAULT_THEME, paperCalloutStyle, stepMarkerCss, type DocTheme } from '../../server/theme.ts'
import type { Frontmatter, ManualDetail, SectionSummary } from '../types.ts'

export function IssuedSection({ onChanged }: { onChanged: () => Promise<void> }) {
  const { manualId, sectionId } = useParams()
  const navigate = useNavigate()
  const [meta, setMeta] = useState<Frontmatter | null>(null)
  const [path, setPath] = useState('')
  const [manual, setManual] = useState<ManualDetail | null>(null)
  const [section, setSection] = useState<SectionSummary | null>(null)
  const [theme, setTheme] = useState<DocTheme>(DEFAULT_THEME)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

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
        setPath(file.path)
        setManual(file.manual)
        setSection(file.section)
        setTheme(file.theme ?? DEFAULT_THEME)
        editor.commands.setContent(parsed.doc)
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Unable to open the issued page.')
      })
    return () => {
      cancelled = true
    }
  }, [manualId, sectionId, editor])

  async function openPage() {
    if (!manual || !section) return
    setBusy(true)
    setError(null)
    try {
      const change = await api.startChange({
        manual: manual.id,
        title: section.title,
        reason: 'Working copy',
        sectionIds: [section.id],
      })
      await onChanged()
      navigate(`/changes/${change.id}/sections/${section.id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not open the page.')
      setBusy(false)
    }
  }

  if (error && !meta) return <div className="banner error">{error}</div>
  if (!meta || !manual) return <div className="empty">Pulling the issued page…</div>

  const openChange = section?.open_change

  return (
    <div>
      <div className="page-head">
        <div>
          <p className="kicker">ISSUED · PRINT ONLY · {manual.abbrev}</p>
          <h1>{meta.title}</h1>
          <p className="lede">
            View-only paper of the launched leaf. This is the controlled copy. Open dirties a
            working copy; the PDF of the book is reference only.
          </p>
        </div>
        <div className="actions">
          {openChange ? (
            <Link className="btn ghost" to={`/changes/${openChange}`}>
              On {openChange}
            </Link>
          ) : (
            <button className="btn primary" type="button" disabled={busy} onClick={() => void openPage()}>
              {busy ? 'Opening…' : 'Open'}
            </button>
          )}
          <Link className="btn ghost" to={`/manuals/${manual.id}`}>
            Back to issued
          </Link>
        </div>
      </div>

      {error ? <div className="banner error">{error}</div> : null}

      <div className="editor-chrome">
        <div className="editor-meta">
          <span>
            {meta.id} · rev last changed {meta.rev_last_changed} · {manual.current_issued ?? 'unlaunched'}
          </span>
          <span>{path}</span>
        </div>
      </div>

      <style>{stepMarkerCss(theme.steps.markers)}</style>
      <div className="paper-wrap is-readonly" style={paperCalloutStyle(theme) as CSSProperties}>
        <h2 className="title-field">{meta.title}</h2>
        <EditorContent editor={editor} />
      </div>
    </div>
  )
}
