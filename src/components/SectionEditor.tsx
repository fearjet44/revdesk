import { useEditor, EditorContent } from '@tiptap/react'
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
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
import type { CrewFinding, DiffRow, Frontmatter, ReviewComment, SectionFile } from '../types.ts'
import { WRITE_MARKS, writeMarkAfterFirst } from '../../server/marks.ts'
import {
  DEFAULT_THEME,
  leafNumberFromTitle,
  nextHeadingStamp,
  paperCalloutStyle,
  replaceHeadingStamp,
  reshapeHeadingStamp,
  stepMarkerCss,
  type DocTheme,
  type HeadingHit,
} from '../../server/theme.ts'
import { FindingList } from './FindingList.tsx'
import { ViewToggle, type SectionView } from './ViewToggle.tsx'

type GutterMark = { line: number; top: number }

const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.userAgent)

function chord(letter: string, withAlt = false): string {
  if (IS_MAC) return withAlt ? `⌘⌥${letter}` : `⌘${letter}`
  return withAlt ? `Ctrl+Alt+${letter}` : `Ctrl+${letter}`
}

function ToolBtn({
  label,
  tip,
  className,
  active,
  onClick,
}: {
  label: string
  tip: string
  className?: string
  active?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      className={`${className ?? ''}${active ? ' is-on' : ''}`.trim()}
      aria-label={`${label} (${tip})`}
      data-tip={tip}
      onClick={onClick}
    >
      {label}
    </button>
  )
}

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
  const [writeMark, setWriteMark] = useState('')
  const [writeNote, setWriteNote] = useState('')
  const [hasPriorMark, setHasPriorMark] = useState(false)
  const [theme, setTheme] = useState<DocTheme>(DEFAULT_THEME)
  const [findings, setFindings] = useState<CrewFinding[]>([])
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
            setTheme(review.theme ?? DEFAULT_THEME)
            try {
              const notes = await api.findings(review.change.manual, sectionId)
              if (!cancelled) setFindings(notes)
            } catch {
              if (!cancelled) setFindings([])
            }
            const touch = review.change.touched.find((item) => item.id === sectionId)
            if (touch?.mark) {
              setWriteMark(touch.mark)
              setWriteNote(touch.mark_note ?? '')
              setHasPriorMark(true)
            } else {
              setHasPriorMark(false)
            }
          }
        } catch {
          if (!cancelled) {
            setComments([])
            setDiffRows([])
            setCanAnswer(false)
            setFindings([])
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

  const markRow = WRITE_MARKS.find((row) => row.code === writeMark)
  const markVisible = WRITE_MARKS.filter((row) => !writeMarkAfterFirst(row) || hasPriorMark)
  const markReady = Boolean(
    writeMark &&
      markVisible.some((row) => row.code === writeMark) &&
      (!markRow?.needsNote || writeNote.trim()),
  )
  const canSave = useMemo(
    () => Boolean(editor && meta && changeId && sectionId && !saved && !readOnly && markReady),
    [editor, meta, changeId, sectionId, saved, readOnly, markReady],
  )

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
      const file = await api.saveWorkingSection(changeId, sectionId, markdown, {
        mark: writeMark,
        note: writeNote.trim() || undefined,
      })
      setMeta(file.meta)
      setSaved(true)
      setHasPriorMark(true)
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

  function applyHeading(level: 1 | 2 | 3 | 4 | 5) {
    if (!editor) return
    if (editor.isActive('heading', { level })) {
      editor.chain().focus().toggleHeading({ level }).run()
      return
    }
    const leaf = leafNumberFromTitle(meta?.title ?? '', meta?.id)
    const $at = editor.state.selection.$from
    const currentLevel =
      $at.parent.type.name === 'heading' ? Number($at.parent.attrs.level ?? 1) : 0
    const nestUnderSelf = currentLevel >= 3 && level > currentLevel
    const reshaped = nestUnderSelf
      ? reshapeHeadingStamp(theme, $at.parent.textContent, level, leaf)
      : null
    const end = $at.parent.type.name === 'heading' ? $at.before($at.depth) : $at.pos
    const before: HeadingHit[] = []
    if (!reshaped) {
      editor.state.doc.nodesBetween(0, end, (node) => {
        if (node.type.name === 'heading') {
          before.push({ level: Number(node.attrs.level ?? 1), text: node.textContent })
        }
      })
    }
    const stamp = reshaped ?? nextHeadingStamp(theme, before, level, leaf)
    editor
      .chain()
      .focus()
      .toggleHeading({ level })
      .command(({ tr }) => {
        const $now = tr.selection.$from
        if ($now.parent.type.name !== 'heading') return false
        const next = replaceHeadingStamp($now.parent.textContent, theme.heading.scheme, stamp)
        if (next === $now.parent.textContent) return true
        tr.insertText(next, $now.start(), $now.end())
        return true
      })
      .run()
  }

  if (!changeId || !sectionId) return null

  return (
    <div>
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
        </div>
      </div>

      {error ? <div className="banner error">{error}</div> : null}

      <FindingList findings={findings} note="incoming from Issued · answers later" />

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
          <div className="write-dock" role="region" aria-label="Write section">
            <label className="write-mark">
              <span className="meta">Mark</span>
              <select
                value={writeMark}
                onChange={(event) => setWriteMark(event.target.value)}
                aria-label="Write mark"
              >
                <option value="">Why this write…</option>
                {markVisible.map((row) => (
                  <option key={row.code} value={row.code}>
                    {row.code} — {row.label}
                  </option>
                ))}
              </select>
            </label>
            <input
              type="text"
              value={writeNote}
              onChange={(event) => setWriteNote(event.target.value)}
              placeholder={markRow?.needsNote ? 'Finding / letter id' : 'Note (optional)'}
              aria-label="Write mark note"
            />
            <button className="btn primary" type="button" disabled={!canSave || busy} onClick={() => void save()}>
              {busy ? 'Writing…' : saved ? 'Saved' : 'Write section'}
            </button>
          </div>
        )}
        {readOnly ? null : (
        <div className="toolbar">
          <ToolBtn
            label="B"
            tip={chord('B')}
            className="mark mark-b"
            active={editor?.isActive('bold')}
            onClick={() => editor?.chain().focus().toggleBold().run()}
          />
          <ToolBtn
            label="I"
            tip={chord('I')}
            className="mark mark-i"
            active={editor?.isActive('italic')}
            onClick={() => editor?.chain().focus().toggleItalic().run()}
          />
          <ToolBtn
            label="U"
            tip={chord('U')}
            className="mark mark-u"
            active={editor?.isActive('underline')}
            onClick={() => editor?.chain().focus().toggleUnderline().run()}
          />
          <ToolBtn
            label="§"
            tip={chord('S', true)}
            className="mark mark-sym"
            onClick={() => editor?.chain().focus().insertContent('§').run()}
          />
          <ToolBtn
            label="¶"
            tip={chord('P', true)}
            className="mark mark-sym"
            onClick={() => editor?.chain().focus().insertContent('¶').run()}
          />
          <span className="toolbar-gap" />
          {([1, 2, 3, 4, 5] as const).map((level) => (
            <button
              key={level}
              type="button"
              className={editor?.isActive('heading', { level }) ? 'is-on' : ''}
              onClick={() => applyHeading(level)}
            >
              H{level}
            </button>
          ))}
          <button type="button" className={editor?.isActive('paragraph') ? 'is-on' : ''} onClick={() => editor?.chain().focus().setParagraph().run()}>
            Para
          </button>
          <ToolBtn
            label="Steps"
            tip={IS_MAC ? '⇥ nest · ⇧⇥ out · ⇧↩ para' : 'Tab nest · Shift+Tab out · Shift+Enter para'}
            active={editor?.isActive('orderedList')}
            onClick={() => editor?.chain().focus().toggleOrderedList().run()}
          />
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

      <style>{stepMarkerCss(theme.steps.markers)}</style>
      <div
        className={`paper-wrap${readOnly ? ' is-readonly' : ''}`}
        ref={paperRef}
        style={paperCalloutStyle(theme) as CSSProperties}
      >
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
    </div>
  )
}
