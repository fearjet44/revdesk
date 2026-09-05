import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api } from '../api.ts'
import type { ManualDetail } from '../types.ts'
import { formatDate } from '../status.ts'

export function ManualView({ onChanged }: { onChanged: () => Promise<void> }) {
  const { manualId } = useParams()
  const navigate = useNavigate()
  const [manual, setManual] = useState<ManualDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

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

  async function openPage(sectionId: string, sectionTitle: string) {
    if (!manual) return
    setBusyId(sectionId)
    setError(null)
    try {
      const change = await api.startChange({
        manual: manual.id,
        title: sectionTitle,
        reason: 'Working copy',
        sectionIds: [sectionId],
      })
      await onChanged()
      navigate(`/changes/${change.id}/sections/${sectionId}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not open the page.')
      setBusyId(null)
    }
  }

  if (error && !manual) return <div className="banner error">{error}</div>
  if (!manual) return <div className="empty">Pulling the book…</div>

  return (
    <>
      <div className="page-head">
        <div>
          <p className="kicker">{manual.abbrev} · {manual.control_class}</p>
          <h1>{manual.title}</h1>
          <p className="lede">
            Current {manual.current_issued ?? '(never launched)'}, next full {manual.next_revision}
            {manual.effective ? `, effective ${formatDate(manual.effective)}` : ''}. Owner:{' '}
            {manual.owner}. Open dirties one working copy into Print with the editor. Crew PDF and
            findings live under Issued.
          </p>
        </div>
      </div>

      {error ? <div className="banner error">{error}</div> : null}

      <section className="panel">
        <div className="panel-hd">
          <span>SECTIONS</span>
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
                <button
                  className="btn primary"
                  type="button"
                  disabled={busyId !== null}
                  onClick={() => void openPage(section.id, section.title)}
                >
                  {busyId === section.id ? 'Opening…' : 'Open'}
                </button>
              )}
            </div>
          ))}
        </div>
      </section>
    </>
  )
}
