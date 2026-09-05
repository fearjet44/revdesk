import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api } from '../api.ts'

export function ManualPdfView() {
  const { issueId } = useParams()
  const [src, setSrc] = useState<string | null>(null)
  const [filename, setFilename] = useState('manual-reference.pdf')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!issueId) return
    let cancelled = false
    let objectUrl = ''
    fetch(api.pdfUrl({ issueId }, { kind: 'reference' }))
      .then(async (response) => {
        if (!response.ok) {
          const data = (await response.json()) as { error?: string }
          throw new Error(data.error ?? `PDF failed (${response.status})`)
        }
        const header = response.headers.get('content-disposition') ?? ''
        const named = header.match(/filename="([^"]+)"/)?.[1]
        const blob = await response.blob()
        return { blob, named }
      })
      .then(({ blob, named }) => {
        if (cancelled) return
        objectUrl = URL.createObjectURL(blob)
        if (named) setFilename(named)
        setSrc(objectUrl)
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Unable to build the PDF.')
      })
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [issueId])

  function download() {
    if (!src) return
    const link = document.createElement('a')
    link.href = src
    link.download = filename
    link.click()
  }

  return (
    <div className="pdf-desk">
      <header className="pdf-desk-bar">
        <div>
          <div className="wordmark">REVDESK</div>
          <p className="pdf-desk-note">
            Reference only — this is not a controlled copy. Header stamp includes the download time.
          </p>
        </div>
        <div className="actions">
          <button className="btn primary" type="button" disabled={!src} onClick={download}>
            Download
          </button>
          {issueId ? (
            <Link className="btn ghost" to={`/issues/${issueId}`}>
              Back to issued
            </Link>
          ) : null}
        </div>
      </header>
      {error ? <div className="banner error">{error}</div> : null}
      {!error && !src ? <div className="empty">Building the PDF…</div> : null}
      {src ? <iframe className="pdf-frame" title={filename} src={src} /> : null}
    </div>
  )
}
