import { useEditor, EditorContent } from '@tiptap/react'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api } from '../api.ts'
import { editorExtensions } from '../schema/extensions.ts'
import {
  blockIndexForLine,
  blockSourceRanges,
  bodyStartLine,
  parseSection,
  serializeSection,
} from '../schema/markdown.ts'
import type { DiffRow, Frontmatter, ReviewComment, SectionFile } from '../types.ts'
import { ViewToggle, type SectionView } from './ViewToggle.tsx'

type GutterMark = { line: number; top: number }

function workingLineForComment(comment: ReviewComment, rows: DiffRow[]): number {
  if (comment.side === 'new') return comment.line
  const at = rows.findIndex((row) => row.kind === 'del' && row.old_line === comment.line)
  if (at < 0) return comment.line
  for (let i = at + 1; i < rows.length; i += 1) {
    const line = rows[i].new_line
    if (line != null) return line
  }
  for (let i = at - 1; i >= 0; i -= 1) {
    const line = rows[i].new_line
    if (line != null) return line
  }
  return comment.line
}

export function SectionEditor({
  onChanged,
  readOnly = false,
  view = 'print',
  onView,
}: {
  onChanged: () => Promise<void>
  readOnly?: boolean
  view?: SectionView
  onView?: (view: SectionView) => void
}) {
  const { changeId, sectionId } = useParams()
  const [meta, setMeta] = useState<Frontmatter | null>(null)
  const [path, setPath] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(true)
  const [busy, setBusy] = useState(false)
  const [comments, setComments] = useState<ReviewComment[]>([])
  const [markdown, setMarkdown] = useState('')
  const [diffRows, setDiffRows] = useState<DiffRow[]>([])
  const [gutterMarks, setGutterMarks] = useState<GutterMark[]>([])
  const [canAnswer, setCanAnswer] = useState(false)
  const [reasons, setReasons] = useState<Record<string, string>>({})
  const paperRef = useRef<HTMLDivElement>(null)

  const editor = useEditor({
    extensions: editorExtensions,
    immediatelyRender: false,
    shouldRerenderOnTransaction: true,
    editable: !readOnly,
    content: { type: 'doc', content: [{ type: 'paragraph' }] },
    onUpdate: () => {
      if (!readOnly) setSaved(false)
    },
  })

  useEffect(() => {
    editor?.setEditable(!readOnly)
  }, [editor, readOnly])

  useEffect(() => {
    if (!changeId || !sectionId || !editor) return
    let cancelled = false
    api
      .workingSection(changeId, sectionId)
      .then(async (file: SectionFile) => {
        if (cancelled) return
        const parsed = parseSection(file.markdown)
        setMeta(parsed.meta)
        setPath(file.path)
        setMarkdown(file.markdown)
        editor.commands.setContent(parsed.doc)
        setSaved(true)
        try {
          const review = await api.reviewSection(changeId, sectionId)
          if (!cancelled) {
            setComments(review.comments)
            setDiffRows(review.rows)
            setCanAnswer(review.can_answer)
          }
        } catch {
          if (!cancelled) {
            setComments([])
            setDiffRows([])
            setCanAnswer(false)
          }
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Unable to open working copy.')
      })
    return () => {
      cancelled = true
    }
  }, [changeId, sectionId, editor])

  const canSave = useMemo(() => Boolean(editor && meta && changeId && sectionId && !saved), [editor, meta, changeId, sectionId, saved])

  useLayoutEffect(() => {
    const paper = paperRef.current
    if (!editor || !paper || !comments.length || !markdown) {
      setGutterMarks([])
      return
    }

    function measure() {
      const wrap = paperRef.current
      const view = editor?.view
      if (!wrap || !view) return
      const paperBox = wrap.getBoundingClientRect()
      const bodyStart = bodyStartLine(markdown)
      const ranges = blockSourceRanges(markdown)
      const byBlock = new Map<number, number[]>()
      for (const comment of comments) {
        if (comment.status !== 'open') continue
        const placeAt = workingLineForComment(comment, diffRows)
        const block = blockIndexForLine(placeAt, ranges, bodyStart)
        const lines = byBlock.get(block) ?? []
        if (!lines.includes(comment.line)) lines.push(comment.line)
        byBlock.set(block, lines)
      }
      const next: GutterMark[] = []
      for (const [block, lines] of byBlock) {
        let top = 28
        if (block < 0) {
          const title = wrap.querySelector('.title-field')
          if (title) top = title.getBoundingClientRect().top - paperBox.top + wrap.scrollTop
        } else {
          let pos = 0
          const doc = view.state.doc
          if (block < doc.childCount) {
            doc.forEach((node, offset, index) => {
              if (index === block) pos = offset
              void node
            })
            try {
              const coords = view.coordsAtPos(pos + 1)
              top = coords.top - paperBox.top + wrap.scrollTop
            } catch {
              top = 28
            }
          }
        }
        lines
          .sort((a, b) => a - b)
          .forEach((line, index) => {
            next.push({ line, top: top + index * 14 })
          })
      }
      setGutterMarks(next)
    }

    measure()
    const frame = requestAnimationFrame(measure)
    const ro = new ResizeObserver(measure)
    ro.observe(paper)
    window.addEventListener('resize', measure)
    return () => {
      cancelAnimationFrame(frame)
      ro.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [editor, comments, markdown, diffRows])

  function scrollToCommentLine(line: number) {
    const mark = paperRef.current?.querySelector(`[data-print-ln="${line}"]`)
    mark?.scrollIntoView({ block: 'center' })
  }

  async function reloadQueries() {
    if (!changeId || !sectionId) return
    const review = await api.reviewSection(changeId, sectionId)
    setComments(review.comments)
    setDiffRows(review.rows)
    setCanAnswer(review.can_answer)
  }

  async function answerQuery(commentId: string, status: 'done' | 'stand' | 'later') {
    if (!changeId) return
    if (status === 'done' && !saved) {
      const ok = await save()
      if (!ok) return
    }
    setBusy(true)
    setError(null)
    try {
      await api.answerComment(changeId, commentId, {
        status,
        reason: status === 'done' ? undefined : (reasons[commentId] ?? '').trim(),
      })
      await reloadQueries()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not answer the query.')
    } finally {
      setBusy(false)
    }
  }

  async function goReview() {
    if (!onView) return
    if (!readOnly && !saved) {
      const ok = await save()
      if (!ok) return
    }
    onView('review')
  }

  async function save(): Promise<boolean> {
    if (!editor || !meta || !changeId || !sectionId || readOnly) return false
    setBusy(true)
    setError(null)
    try {
      const markdown = serializeSection(meta, editor.getJSON())
      const file = await api.saveWorkingSection(changeId, sectionId, markdown)
      setMeta(file.meta)
      setSaved(true)
      await onChanged()
      return true
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed.')
      return false
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
          <p className="kicker">{readOnly ? 'PRINT' : 'WORKING COPY'} · {changeId}</p>
          <h1>{meta?.title ?? 'Section'}</h1>
          <p className="lede">
            {readOnly
              ? 'Rendered page as it will read. Switch to Review for incoming and outgoing lines.'
              : 'Edits write Markdown with YAML frontmatter to the working folder. Issued text is unchanged until this change is issued.'}
          </p>
        </div>
        <div className="actions">
          {onView ? <ViewToggle view={view} onChange={(next) => (next === 'review' ? void goReview() : onView(next))} /> : null}
          <Link className="btn ghost" to={`/changes/${changeId}`}>
            Back to packet
          </Link>
          {readOnly ? null : (
            <button className="btn primary" type="button" disabled={!canSave || busy} onClick={() => void save()}>
              {busy ? 'Writing…' : saved ? 'Saved' : 'Write section'}
            </button>
          )}
        </div>
      </div>

      {error ? <div className="banner error">{error}</div> : null}

      {comments.length ? (
        <section className="panel comment-return">
          <div className="panel-hd">
            QUERIES · {comments.filter((row) => row.status === 'open').length} open / {comments.length} —
            red gutter is open only
          </div>
          <div className="comment-list">
            {comments.map((comment) => (
              <div
                key={comment.id}
                className={`comment-card${comment.status === 'open' ? '' : ' is-closed'}`}
              >
                <button
                  type="button"
                  className="print-ln-badge"
                  aria-label={`Line ${comment.line}`}
                  onClick={() => scrollToCommentLine(comment.line)}
                >
                  {comment.line}
                </button>
                <div className="comment-card-body">
                  <div className="diff-thread-hd">
                    <strong>{comment.author}</strong>
                    <span className="meta">
                      {comment.status} · {comment.side === 'new' ? 'incoming' : 'outgoing'}
                      {comment.reason ? ` · ${comment.reason}` : ''}
                    </span>
                  </div>
                  <p>{comment.body}</p>
                  {comment.suggest ? <p className="meta">Suggest: {comment.suggest}</p> : null}
                  {canAnswer && comment.status === 'open' ? (
                    <div className="comment-actions">
                      <button
                        className="btn primary"
                        type="button"
                        disabled={busy}
                        onClick={() => void answerQuery(comment.id, 'done')}
                      >
                        Done
                      </button>
                      <input
                        type="text"
                        value={reasons[comment.id] ?? ''}
                        onChange={(event) =>
                          setReasons((current) => ({ ...current, [comment.id]: event.target.value }))
                        }
                        placeholder="Reason for Stand or Later"
                        aria-label={`Reason for ${comment.id}`}
                      />
                      <button
                        className="btn"
                        type="button"
                        disabled={busy || !(reasons[comment.id] ?? '').trim()}
                        onClick={() => void answerQuery(comment.id, 'stand')}
                      >
                        Stand
                      </button>
                      <button
                        className="btn ghost"
                        type="button"
                        disabled={busy || !(reasons[comment.id] ?? '').trim()}
                        onClick={() => void answerQuery(comment.id, 'later')}
                      >
                        Later
                      </button>
                    </div>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <div className="editor-chrome">
        {readOnly ? null : (
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
        )}
        <div className="editor-meta">
          <span>
            {meta?.id} · rev last changed {meta?.rev_last_changed}
          </span>
          <span>{path || `control/working/${changeId}`}</span>
        </div>
      </div>

      <div className={`paper-wrap${readOnly ? ' is-readonly' : ''}`} ref={paperRef}>
        {gutterMarks.map((mark) => (
          <span
            key={`${mark.line}-${mark.top}`}
            className="print-gutter-ln"
            data-print-ln={mark.line}
            style={{ top: mark.top }}
          >
            {mark.line}
          </span>
        ))}
        {meta ? (
          readOnly ? (
            <h2 className="title-field">{meta.title}</h2>
          ) : (
            <input
              className="title-field"
              value={meta.title}
              onChange={(event) => {
                setMeta({ ...meta, title: event.target.value })
                setSaved(false)
              }}
            />
          )
        ) : null}
        <EditorContent editor={editor} />
      </div>
    </>
  )
}
