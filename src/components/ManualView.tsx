import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api } from '../api.ts'
import type { ManualDetail } from '../types.ts'
import { StartChangeDialog } from './StartChangeDialog.tsx'
import { formatDate } from '../status.ts'

export function ManualView({ onChanged }: { onChanged: () => Promise<void> }) {
  const { manualId } = useParams()
  const navigate = useNavigate()
  const [manual, setManual] = useState<ManualDetail | null>(null)
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!manualId) return
    let cancelled = false
    api
      .manual(manualId)
      .then((data) => {
        if (!cancelled) setManual(data)
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Unable to load manual.')
      })
    return () => {
      cancelled = true
    }
  }, [manualId])

  if (error) return <div className="banner error">{error}</div>
  if (!manual) return <div className="empty">Pulling the issued book…</div>

  return (
    <>
      <div className="page-head">
        <div>
          <p className="kicker">{manual.abbrev} · {manual.control}</p>
          <h1>{manual.title}</h1>
          <p className="lede">
            Current issued revision {manual.current_issued}, effective {formatDate(manual.effective)}.
            Owner: {manual.owner}. Open a change to copy a section into a working folder.
          </p>
        </div>
        <div className="actions">
          <button className="btn primary" type="button" onClick={() => setOpen(true)}>
            Open a change
          </button>
        </div>
      </div>

      <section className="panel">
        <div className="panel-hd">
          <span>ISSUED SECTIONS</span>
          <span>{manual.current_issued}</span>
        </div>
        <div className="rows">
          {manual.sections.map((section) => (
            <div key={section.id} className="row">
              <span className="mono">{section.id}</span>
              <span>
                <div className="title">{section.title}</div>
                <div className="meta">{section.path}</div>
              </span>
              <span className="mono">{section.rev_last_changed}</span>
              {section.open_change ? (
                <Link className="btn ghost" to={`/changes/${section.open_change}`}>
                  On {section.open_change}
                </Link>
              ) : (
                <span className="meta">Clear</span>
              )}
            </div>
          ))}
        </div>
      </section>

      {open ? (
        <StartChangeDialog
          manual={manual}
          onClose={() => setOpen(false)}
          onCreated={async (id) => {
            await onChanged()
            navigate(`/changes/${id}`)
          }}
        />
      ) : null}
    </>
  )
}
