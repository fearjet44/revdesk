import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api } from '../api.ts'
import type { DiffRow, ReviewComment, SectionReview } from '../types.ts'
import { ViewToggle, type SectionView } from './ViewToggle.tsx'

type LineKey = string

function lineKey(side: 'old' | 'new', line: number): LineKey {
  return `${side}:${line}`
}

function rowKey(row: DiffRow, index: number): string {
  if (row.kind === 'del' && row.old_line != null) return lineKey('old', row.old_line)
  if (row.new_line != null) return lineKey('new', row.new_line)
  return `row-${index}`
}

function rowSide(row: DiffRow): { side: 'old' | 'new'; line: number } | null {
  if (row.kind === 'del' && row.old_line != null) return { side: 'old', line: row.old_line }
  if (row.new_line != null) return { side: 'new', line: row.new_line }
  if (row.old_line != null) return { side: 'old', line: row.old_line }
  return null
}

export function ReviewSection({
  onChanged,
  view = 'review',
  onView,
}: {
  onChanged: () => Promise<void>
  view?: SectionView
  onView?: (view: SectionView) => void
}) {
  const { changeId, sectionId } = useParams()
  const [review, setReview] = useState<SectionReview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<LineKey | null>(null)
  const [draft, setDraft] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const shellRef = useRef<HTMLDivElement>(null)
  const composerRef = useRef<HTMLTextAreaElement>(null)

  async function load() {
    if (!changeId || !sectionId) return
    const next = await api.reviewSection(changeId, sectionId)
    setReview(next)
  }

  useEffect(() => {
    let cancelled = false
    load().catch((err: unknown) => {
      if (!cancelled) setError(err instanceof Error ? err.message : 'Unable to open the review.')
    })
    return () => {
      cancelled = true
    }
  }, [changeId, sectionId])

  useEffect(() => {
    if (draft !== null) composerRef.current?.focus()
  }, [draft])

  const commentsByLine = useMemo(() => {
    const map = new Map<LineKey, ReviewComment[]>()
    for (const comment of review?.comments ?? []) {
      const key = lineKey(comment.side, comment.line)
      const list = map.get(key)
      if (list) list.push(comment)
      else map.set(key, [comment])
    }
    return map
  }, [review])

  function selectRow(row: DiffRow) {
    const target = rowSide(row)
    if (!target) return
    setSelected(lineKey(target.side, target.line))
    shellRef.current?.focus()
  }

  function openComposer(seed = '') {
    if (!review?.can_comment) return
    setDraft(seed)
  }

  function onShellKey(event: KeyboardEvent<HTMLDivElement>) {
    if (draft !== null) return
    if (!review) return
    const rows = review.rows
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const delta = event.key === 'ArrowDown' ? 1 : -1
      const current = rows.findIndex((row) => {
        const target = rowSide(row)
        return target ? lineKey(target.side, target.line) === selected : false
      })
      const nextIndex = current < 0 ? (delta > 0 ? 0 : rows.length - 1) : current + delta
      const clamped = Math.max(0, Math.min(rows.length - 1, nextIndex))
      const target = rowSide(rows[clamped])
      if (target) setSelected(lineKey(target.side, target.line))
      return
    }
    if (event.key === 'Escape') {
      setSelected(null)
      return
    }
    if (!review.can_comment || !selected) return
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      openComposer('')
      return
    }
    if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault()
      openComposer(event.key)
    }
  }

  async function postComment() {
    if (!changeId || !sectionId || !review || !selected || !draft?.trim()) return
    const [side, lineRaw] = selected.split(':')
    const line = Number(lineRaw)
    if ((side !== 'old' && side !== 'new') || !Number.isInteger(line)) return
    setBusy(true)
    setError(null)
    try {
      await api.addComment(changeId, { section: sectionId, line, side, body: draft.trim() })
      setDraft(null)
      await load()
      await onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not write the comment.')
    } finally {
      setBusy(false)
    }
  }

  if (!changeId || !sectionId) return null
  if (!review) {
    return error ? <div className="banner error">{error}</div> : <div className="empty">Opening the review…</div>
  }

  const added = review.rows.filter((row) => row.kind === 'add').length
  const removed = review.rows.filter((row) => row.kind === 'del').length

  return (
    <>
      <div className="page-head">
        <div>
          <p className="kicker">REVIEW · {changeId}</p>
          <h1>{review.section.title}</h1>
          <p className="lede">
            Incoming lines are green, outgoing lines are red. Line numbers match the markdown file.
            Click a line and type to leave a comment for the author. Comments are git notes on{' '}
            <span className="mono">{review.branch ?? 'change/' + changeId}</span>
            {review.commit ? ` @ ${review.commit.slice(0, 7)}` : ''}.
          </p>
        </div>
        <div className="actions">
          {onView ? <ViewToggle view={view} onChange={onView} /> : null}
          <Link className="btn ghost" to={`/changes/${changeId}`}>
            Back to packet
          </Link>
        </div>
      </div>

      {error ? <div className="banner error">{error}</div> : null}

      <div className="diff-chrome">
        <span>
          {review.section.id} · {removed} outgoing · {added} incoming
        </span>
        <span>
          {review.notes_ref}
          {review.commit ? ` · ${review.commit.slice(0, 12)}` : ' · no snapshot yet'}
        </span>
      </div>

      <div
        ref={shellRef}
        className="diff-file"
        tabIndex={0}
        role="textbox"
        aria-label="Review diff. Click a line and type to comment."
        onKeyDown={onShellKey}
      >
        {review.rows.map((row, index) => {
          const target = rowSide(row)
          const key = rowKey(row, index)
          const active = target ? lineKey(target.side, target.line) === selected : false
          const threads = target ? commentsByLine.get(lineKey(target.side, target.line)) ?? [] : []
          const composingHere = active && draft !== null
          return (
            <div key={key}>
              <button
                type="button"
                className={`diff-row ${row.kind}${active ? ' is-on' : ''}`}
                onClick={() => selectRow(row)}
              >
                <span className="diff-ln">{row.old_line ?? ''}</span>
                <span className="diff-ln">{row.new_line ?? ''}</span>
                <span className="diff-sign" aria-hidden>
                  {row.kind === 'add' ? '+' : row.kind === 'del' ? '−' : ' '}
                </span>
                <span className="diff-code">{row.text === '' ? ' ' : row.text}</span>
              </button>
              {threads.map((comment) => (
                <div
                  key={comment.id}
                  className={`diff-thread${comment.status === 'open' ? '' : ' is-closed'}`}
                >
                  <div className="diff-thread-hd">
                    <strong>{comment.author}</strong>
                    <span className="meta">
                      {comment.status} · {comment.side === 'new' ? 'incoming' : 'outgoing'} L
                      {comment.line}
                    </span>
                  </div>
                  <p>{comment.body}</p>
                  {comment.reason ? <p className="meta">{comment.reason}</p> : null}
                </div>
              ))}
              {composingHere ? (
                <div className="diff-composer">
                  <textarea
                    ref={composerRef}
                    value={draft ?? ''}
                    onChange={(event) => setDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Escape') {
                        event.preventDefault()
                        setDraft(null)
                        shellRef.current?.focus()
                      }
                      if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                        event.preventDefault()
                        void postComment()
                      }
                    }}
                    placeholder="Comment to return to the author"
                    rows={4}
                  />
                  <div className="actions">
                    <button
                      className="btn primary"
                      type="button"
                      disabled={busy || !draft?.trim()}
                      onClick={() => void postComment()}
                    >
                      {busy ? 'Writing…' : 'Add comment'}
                    </button>
                    <button
                      className="btn ghost"
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        setDraft(null)
                        shellRef.current?.focus()
                      }}
                    >
                      Cancel
                    </button>
                    <span className="meta">Ctrl+Enter to post</span>
                  </div>
                </div>
              ) : null}
            </div>
          )
        })}
      </div>
    </>
  )
}
