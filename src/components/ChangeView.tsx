import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api } from '../api.ts'
import { NEXT_ACTION, formatDate } from '../status.ts'
import type { ChangeRecord, LaunchedStatus } from '../types.ts'
import { StatusLamp } from './StatusLamp.tsx'

export function ChangeView({ onChanged }: { onChanged: () => Promise<void> }) {
  const { changeId } = useParams()
  const [change, setChange] = useState<ChangeRecord | null>(null)
  const [launched, setLaunched] = useState<LaunchedStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [effective, setEffective] = useState(() => new Date().toISOString().slice(0, 10))
  const [trFile, setTrFile] = useState('')
  const [trAuthority, setTrAuthority] = useState('chief-pilot')
  const [instrumentPath, setInstrumentPath] = useState('')
  const [instrumentDated, setInstrumentDated] = useState(() => new Date().toISOString().slice(0, 10))

  async function load() {
    if (!changeId) return
    const next = await api.change(changeId)
    setChange(next)
    setLaunched(await api.launched(next.manual))
  }

  useEffect(() => {
    let cancelled = false
    load().catch((err: unknown) => {
      if (!cancelled) setError(err instanceof Error ? err.message : 'Unable to load change.')
    })
    return () => {
      cancelled = true
    }
  }, [changeId])

  async function run(fn: () => Promise<void>) {
    setBusy(true)
    setError(null)
    try {
      await fn()
      await load()
      await onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed.')
    } finally {
      setBusy(false)
    }
  }

  if (!change) {
    return error ? <div className="banner error">{error}</div> : <div className="empty">Opening the change packet…</div>
  }

  const next = NEXT_ACTION[change.status]
  const isLaunched = change.status === 'launched'
  const hasInstrument = Boolean(change.instrument)
  const canLaunchFull =
    !isLaunched &&
    change.status !== 'withdrawn' &&
    hasInstrument &&
    (change.status === 'ready-to-launch' || change.status === 'approved')
  const canTr =
    !isLaunched &&
    change.status !== 'withdrawn' &&
    (change.status === 'approved' || change.status === 'ready-to-launch') &&
    Boolean(launched?.full)
  const showWithdraw = !isLaunched && change.status !== 'withdrawn'

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
          {launched?.full ? (
            <>
              Board {launched.full}
              {launched.active_trs.length ? ` + ${launched.active_trs.join(', ')}` : ''}
              <br />
              Next full {launched.next_full}
            </>
          ) : (
            <>Never launched · next full {launched?.next_full ?? '—'}</>
          )}
          <br />
          Opened {formatDate(change.created)}
          <br />
          {change.author}
        </div>
      </div>

      {error ? <div className="banner error">{error}</div> : null}

      {isLaunched ? (
        <div className="banner">
          Launched as {change.launch_kind} {change.launch_id}. Withdraw is closed.
        </div>
      ) : (
        <div className="banner">
          Working copies live under control/working/{change.id}. A full revision needs a stored
          instrument. Without one, issue a temporary revision against the last launched full rev.
        </div>
      )}

      <div className="actions" style={{ marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
        {next ? (
          <button
            className="btn"
            type="button"
            disabled={busy}
            onClick={() => void run(async () => { setChange(await api.transition(change.id, next.action)) })}
          >
            {next.label}
          </button>
        ) : null}

        {change.status === 'ready-to-launch' ? (
          <button
            className="btn"
            type="button"
            disabled={busy}
            onClick={() => void run(async () => { setChange(await api.returnToEdit(change.id)) })}
          >
            Return to edit
          </button>
        ) : null}

        {canLaunchFull ? (
          <button
            className="btn primary"
            type="button"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await api.issueFull(change.id, effective)
              })
            }
          >
            Launch full revision
          </button>
        ) : null}

        {!hasInstrument && canTr ? (
          <button
            className="btn primary"
            type="button"
            disabled={busy || !trFile.trim() || !launched?.full}
            onClick={() =>
              void run(async () => {
                await api.issueTr(change.id, {
                  parent: launched!.full!,
                  authority: trAuthority,
                  file: trFile.trim(),
                })
              })
            }
          >
            Issue temporary revision
          </button>
        ) : null}

        {!hasInstrument && !isLaunched && change.status !== 'withdrawn' ? (
          <button className="btn" type="button" disabled title="Attach an instrument first">
            Launch full revision (needs instrument)
          </button>
        ) : null}

        {showWithdraw ? (
          <button
            className="btn ghost"
            type="button"
            disabled={busy}
            onClick={() => {
              const why = window.prompt('Withdraw reason?')
              if (!why) return
              void run(async () => {
                setChange(await api.withdraw(change.id, why))
              })
            }}
          >
            Withdraw
          </button>
        ) : null}
      </div>

      {!isLaunched && change.status !== 'withdrawn' ? (
        <section className="panel" style={{ marginBottom: 16 }}>
          <div className="panel-hd">LAUNCH CONTROLS</div>
          <div className="form-grid" style={{ padding: 14 }}>
            <label className="field">
              Effective date (full launch)
              <input value={effective} onChange={(e) => setEffective(e.target.value)} />
            </label>
            {!hasInstrument ? (
              <>
                <label className="field">
                  Attach instrument — local file path
                  <input
                    value={instrumentPath}
                    onChange={(e) => setInstrumentPath(e.target.value)}
                    placeholder="/path/to/acceptance-letter.pdf"
                  />
                </label>
                <label className="field">
                  Instrument dated
                  <input value={instrumentDated} onChange={(e) => setInstrumentDated(e.target.value)} />
                </label>
                <div className="actions">
                  <button
                    className="btn"
                    type="button"
                    disabled={busy || !instrumentPath.trim()}
                    onClick={() =>
                      void run(async () => {
                        setChange(
                          await api.attachInstrument(change.id, {
                            file: instrumentPath.trim(),
                            type: 'acceptance-letter',
                            authority: 'poi',
                            dated: instrumentDated,
                          }),
                        )
                      })
                    }
                  >
                    Attach instrument
                  </button>
                </div>
                <label className="field">
                  TR letter path
                  <input
                    value={trFile}
                    onChange={(e) => setTrFile(e.target.value)}
                    placeholder="/path/to/cp-letter.txt"
                  />
                </label>
                <label className="field">
                  TR authority
                  <select value={trAuthority} onChange={(e) => setTrAuthority(e.target.value)}>
                    <option value="chief-pilot">chief-pilot</option>
                    <option value="ae">ae</option>
                    <option value="ceo">ceo</option>
                    <option value="do">do</option>
                  </select>
                </label>
              </>
            ) : (
              <p className="meta">
                Instrument {change.instrument!.type} · {change.instrument!.authority} ·{' '}
                {change.instrument!.file}
                <br />
                sha256 {change.instrument!.sha256}
              </p>
            )}
          </div>
        </section>
      ) : null}

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
                {isLaunched ? (
                  <span className="meta">Launched</span>
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
