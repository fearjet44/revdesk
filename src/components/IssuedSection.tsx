import { useEditor, EditorContent } from '@tiptap/react'
import { useEffect, useState, type CSSProperties } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api } from '../api.ts'
import { editorExtensions } from '../schema/extensions.ts'
import { parseSection } from '../schema/markdown.ts'
import { DEFAULT_THEME, paperCalloutStyle, stepMarkerCss, type DocTheme } from '../../server/theme.ts'
import type { CrewFinding, Frontmatter, IssueRecord, ManualDetail } from '../types.ts'
import { FindingList } from './FindingList.tsx'

export function IssuedSection() {
  const { issueId, sectionId } = useParams()
  const [meta, setMeta] = useState<Frontmatter | null>(null)
  const [issue, setIssue] = useState<IssueRecord | null>(null)
  const [manual, setManual] = useState<ManualDetail | null>(null)
  const [theme, setTheme] = useState<DocTheme>(DEFAULT_THEME)
  const [findings, setFindings] = useState<CrewFinding[]>([])
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [canFind, setCanFind] = useState(false)

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
    if (!issueId || !sectionId || !editor) return
    let cancelled = false
    api
      .crewSection(issueId, sectionId)
      .then((file) => {
        if (cancelled) return
        const parsed = parseSection(file.markdown)
        setMeta(parsed.meta)
        setIssue(file.issue)
        setManual(file.manual)
        setTheme(file.theme ?? DEFAULT_THEME)
        setFindings(file.findings ?? [])
        setCanFind(file.can_find)
        editor.commands.setContent(parsed.doc)
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Unable to open the issued page.')
      })
    return () => {
      cancelled = true
    }
  }, [issueId, sectionId, editor])

  async function leaveFinding() {
    if (!issueId || !sectionId || !draft.trim()) return
    setBusy(true)
    setError(null)
    try {
      const next = await api.addFinding(issueId, sectionId, draft.trim())
      setFindings((current) => [next, ...current])
      setDraft('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not leave the finding.')
    } finally {
      setBusy(false)
    }
  }

  if (error && !meta) return <div className="banner error">{error}</div>
  if (!meta || !issue || !manual) return <div className="empty">Pulling the issued page…</div>

  return (
    <div>
      <div className="page-head">
        <div>
          <p className="kicker">ISSUED · CREW · {manual.abbrev}</p>
          <h1>{meta.title}</h1>
          <p className="lede">
            Read-only paper of the launched leaf. This is the controlled copy. Leave a crew finding
            on this page; it does not edit the book.
          </p>
        </div>
        <div className="actions">
          <Link className="btn ghost" to={`/issues/${issue.id}`}>
            Back to issued
          </Link>
        </div>
      </div>

      {error ? <div className="banner error">{error}</div> : null}

      <FindingList findings={findings} />

      {canFind ? (
        <section className="panel comment-return">
          <div className="panel-hd">LEAVE A CREW FINDING</div>
          <div className="cf-composer">
            <textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="What should the author look at on this page?"
              aria-label="Crew finding"
            />
            <button
              className="btn primary"
              type="button"
              disabled={busy || !draft.trim()}
              onClick={() => void leaveFinding()}
            >
              {busy ? 'Saving…' : 'Leave CF'}
            </button>
          </div>
        </section>
      ) : null}

      <style>{stepMarkerCss(theme.steps.markers)}</style>
      <div className="paper-wrap is-readonly is-crew" style={paperCalloutStyle(theme) as CSSProperties}>
        <h2 className="title-field">{meta.title}</h2>
        <EditorContent editor={editor} />
      </div>
    </div>
  )
}
