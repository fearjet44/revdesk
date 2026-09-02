import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api } from '../api.ts'
import { NEXT_ACTION, formatDate } from '../status.ts'
import type { ChangeRecord } from '../types.ts'
import { StatusLamp } from './StatusLamp.tsx'

export function ChangeView({ onChanged }: { onChanged: () => Promise<void> }) {
  const { changeId } = useParams()
  const [change, setChange] = useState<ChangeRecord | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function load() {
    if (!changeId) return
    setChange(await api.change(changeId))
  }

  useEffect(() => {
    let cancelled = false
    load()
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Unable to load change.')
      })
    return () => {
      cancelled = true
    }
  }, [changeId])

  async function advance() {
    if (!change) return
    const next = NEXT_ACTION[change.status]
    if (!next) return
    setBusy(true)
    setError(null)
    try {
      const updated = await api.transition(change.id, next.action)
      setChange(updated)
      await onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Transition failed.')
    } finally {
      setBusy(false)
    }
  }

  if (!change) return error ? <div className="banner error">{error}</div> : <div className="empty">Opening the change packet…</div>

  const next = NEXT_ACTION[change.status]

  return (
    <>
      <div className="page-head">
        <div>
          <p className="kicker">{change.id} · {change.manual.toUpperCase()}</p>
          <h1>{change.title}</h1>
          <p className="lede">{change.reason}</p>
        </div>
        <div className="stamp-block">
          <strong>CHANGE PACKET</strong>
          <StatusLamp status={change.status} />
          <br />
          Target {change.target_revision}
          <br />
          Opened {formatDate(change.created)}
          <br />
          {change.author}
        </div>
      </div>

      {error ? <div className="banner error">{error}</div> : null}

      {change.status !== 'issued' ? (
        <div className="banner">
          Working copies live under control/working/{change.id}. Issued sections are not rewritten
          until this packet is issued.
        </div>
      ) : (
        <div className="banner">Issued. Touched sections now carry {change.target_revision}.</div>
      )}

      <div className="actions" style={{ marginBottom: 16 }}>
        {next ? (
          <button className="btn primary" type="button" disabled={busy} onClick={() => void advance()}>
            {next.label}
          </button>
        ) : null}
      </div>

      <div className="grid-2">
        <section className="panel">
          <div className="panel-hd">TOUCHED SECTIONS</div>
          <div className="rows">
            {change.touched.map((section) => (
              <div key={section.id} className="row">
                <span className="mono">{section.id}</span>
                <span>
                  <div className="title">{section.title}</div>
                  <div className="meta">{section.working}</div>
                </span>
                {change.status === 'issued' ? (
                  <span className="meta">Issued</span>
                ) : (
                  <Link className="btn" to={`/changes/${change.id}/sections/${section.id}`}>
                    Edit
                  </Link>
                )}
              </div>
            ))}
          </div>
        </section>
        <section className="panel">
          <div className="panel-hd">PACKET LOG</div>
          <ol className="timeline">
            {change.history.map((event, index) => (
              <li key={`${event.at}-${index}`}>
                <time>{formatDate(event.at)}</time>
                <strong>{event.action}</strong>
                {event.note ? <div className="meta">{event.note}</div> : null}
              </li>
            ))}
          </ol>
        </section>
      </div>
    </>
  )
}
