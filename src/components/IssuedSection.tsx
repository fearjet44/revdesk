import { useEditor, EditorContent } from '@tiptap/react'
import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api } from '../api.ts'
import { buildEditorExtensions } from '../schema/extensions.ts'
import { parseSection } from '../schema/markdown.ts'
import { DEFAULT_THEME, paperCalloutStyle, stepMarkerCss } from '../../server/theme.ts'
import type { CrewSectionFile, CrewFinding, Frontmatter, IssueRecord, ManualDetail, SlotStamp } from '../types.ts'
import { FindingList } from './FindingList.tsx'

export function IssuedSection() {
  const { issueId, sectionId } = useParams()
  const [file, setFile] = useState<{ key: string; data: CrewSectionFile } | null>(null)
  const [error, setError] = useState<{ key: string; message: string } | null>(null)
  const key = `${issueId}/${sectionId}`

  useEffect(() => {
    if (!issueId || !sectionId) return
    let cancelled = false
    api
      .crewSection(issueId, sectionId)
      .then((data) => {
        if (!cancelled) setFile({ key, data })
      })
      .catch((err: unknown) => {
        if (!cancelled) setError({ key, message: err instanceof Error ? err.message : 'Unable to open the issued page.' })
      })
    return () => {
      cancelled = true
    }
  }, [issueId, sectionId, key])

  if (file?.key === key) return <IssuedSectionBody key={key} issueId={issueId!} sectionId={sectionId!} file={file.data} />
  if (error?.key === key) return <div className="banner error">{error.message}</div>
  return <div className="empty">Pulling the issued page…</div>
}

function IssuedSectionBody({ issueId, sectionId, file }: { issueId: string; sectionId: string; file: CrewSectionFile }) {
  const parsed = useMemo(() => parseSection(file.markdown), [file])
  const meta: Frontmatter = parsed.meta
  const issue: IssueRecord = file.issue
  const manual: ManualDetail = file.manual
  const theme = file.theme ?? DEFAULT_THEME
  const pages: SlotStamp[] = file.pages ?? []
  const canFind = file.can_find
  const [findings, setFindings] = useState<CrewFinding[]>(file.findings ?? [])
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const extensions = useMemo(() => buildEditorExtensions({ manualId: manual.id }), [manual.id])
  const editor = useEditor(
    {
      extensions,
      immediatelyRender: false,
      editable: false,
      content: parsed.doc,
    },
    [extensions],
  )

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

  return (
    <div>
      <div className="page-head">
        <div>
          <p className="kicker">ISSUED · CREW · {manual.abbrev}</p>
          <h1>{meta.title}</h1>
          <p className="lede">
            {meta.managed
              ? 'Automatically managed paper of the launched leaf. Leave a crew finding here; it does not edit the book.'
              : 'Read-only paper of the launched leaf. This is the controlled copy. Leave a crew finding on this page; it does not edit the book.'}
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
        <SlotFooter pages={pages} />
      </div>
    </div>
  )
}

export function SlotFooter({ pages }: { pages: SlotStamp[] }) {
  if (!pages.length) return null
  return (
    <div className="paper-slots">
      {pages.map((page) => (
        <span key={page.slot}>
          {page.slot}
          {page.dagger ? ' †' : ''} · {page.rev}
        </span>
      ))}
    </div>
  )
}
