import { useId, useRef, useState } from 'react'
import { api, encodeLetterFile } from '../api.ts'
import type { IngestApplyResult, IngestPreview } from '../types.ts'

const ACCEPT =
  '.pdf,.txt,.docx,application/pdf,text/plain,application/vnd.openxmlformats-officedocument.wordprocessingml.document'
const EXISTS_NOTE = 'is already in this library'

export function IngestDialog({
  onClose,
  onDone,
}: {
  onClose: () => void
  onDone: () => Promise<void>
}) {
  const inputId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<IngestPreview | null>(null)
  const [result, setResult] = useState<IngestApplyResult | null>(null)
  const [busy, setBusy] = useState<'inspect' | 'ingest' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [practice, setPractice] = useState(false)
  const [replace, setReplace] = useState(false)
  const [exists, setExists] = useState(false)

  async function inspect() {
    if (!file) return
    setBusy('inspect')
    setError(null)
    setResult(null)
    try {
      const content = await encodeLetterFile(file)
      setPreview(await api.classifyIngest({ filename: file.name, content }))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not inspect the book.')
      setPreview(null)
    } finally {
      setBusy(null)
    }
  }

  async function ingest() {
    if (!file) return
    setBusy('ingest')
    setError(null)
    setExists(false)
    try {
      const content = await encodeLetterFile(file)
      const written = await api.ingestBook({
        filename: file.name,
        content,
        bodies: practice ? 'practice' : 'source',
        replace,
      })
      setResult(written)
      await onDone()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not bring the book onto the desk.'
      setExists(message.includes(EXISTS_NOTE))
      setError(message)
    } finally {
      setBusy(null)
    }
  }

  const name = file?.name ?? ''

  return (
    <div className="modal-back" role="presentation" onClick={onClose}>
      <div className="modal ingest-modal" role="dialog" aria-labelledby="ingest-title" onClick={(event) => event.stopPropagation()}>
        <div className="panel-hd">INGEST A BOOK</div>
        <div className="modal-body">
          <p className="modal-note">
            Choose a PDF, Word file, or text export. Revdesk keeps the section map and brings in
            the text.
            {practice ? ' A practice copy keeps the section map and fills placeholder text instead.' : ''}
          </p>
          <div className={`field ${!file && error ? 'invalid' : ''}`}>
            <label htmlFor={inputId}>Source book</label>
            <div className="file-pick">
              <input
                ref={inputRef}
                id={inputId}
                type="file"
                accept={ACCEPT}
                disabled={busy !== null}
                onChange={(event) => {
                  setFile(event.target.files?.[0] ?? null)
                  setPreview(null)
                  setResult(null)
                  setError(null)
                  setExists(false)
                  setReplace(false)
                }}
              />
              <button
                className="btn"
                type="button"
                disabled={busy !== null}
                onClick={() => inputRef.current?.click()}
              >
                Choose book
              </button>
              <span className={`file-pick-name ${name ? '' : 'empty'}`}>{name || 'No book chosen'}</span>
            </div>
          </div>
          <label className="check">
            <input
              type="checkbox"
              checked={practice}
              disabled={busy !== null}
              onChange={(event) => setPractice(event.target.checked)}
            />{' '}
            Practice copy (placeholder text, keeps the section map)
          </label>
          {error ? <div className="banner error">{error}</div> : null}
          {exists ? (
            <label className="check">
              <input
                type="checkbox"
                checked={replace}
                disabled={busy !== null}
                onChange={(event) => setReplace(event.target.checked)}
              />{' '}
              Replace the existing book
            </label>
          ) : null}
          {preview ? (
            <div className="ingest-preview">
              <p className="kicker">Section map</p>
              <p className="ingest-meta">
                {preview.source.filename} · {preview.control_surface} · {preview.control_class_guess ?? preview.kind_guess}
                {preview.revision.label ? ` · ${preview.revision.label}` : ''}
                {preview.source.pages ? ` · ${preview.source.pages} pages` : ''}
              </p>
              <p className="modal-note">
                {preview.sections.length} leaves.
                {practice ? ' Bodies on the desk will be lorem, not the source text.' : ''}
              </p>
              <div className="ingest-leaves">
                {preview.sections.length === 0 ? <div className="empty">No sections found.</div> : null}
                {preview.sections.map((section, index) => (
                  <div key={`${section.kind}-${section.number ?? index}`} className="ingest-leaf">
                    <span className="mono">{section.number ?? section.kind}</span>
                    <span>{section.title}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
          {result ? (
            <div className="banner ok">
              {result.abbrev} · {result.title} · {result.sections} sections on the desk
              {result.matched_gold ? ' · known book map' : ''}.
            </div>
          ) : null}
        </div>
        <div className="modal-foot">
          <button className="btn ghost" type="button" onClick={onClose}>
            {result ? 'Close' : 'Cancel'}
          </button>
          {!preview && !result ? (
            <button className="btn primary" type="button" disabled={!file || busy !== null} onClick={() => void inspect()}>
              {busy === 'inspect' ? 'Inspecting…' : 'Inspect map'}
            </button>
          ) : null}
          {preview && !result ? (
            <button className="btn primary" type="button" disabled={busy !== null} onClick={() => void ingest()}>
              {busy === 'ingest' ? 'Writing…' : 'Bring onto the desk'}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  )
}
