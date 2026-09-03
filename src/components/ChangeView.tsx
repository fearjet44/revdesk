import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api } from '../api.ts'
import { NEXT_ACTION, formatDate } from '../status.ts'
import type {
  ChangeRecord,
  ControlClass,
  InstrumentType,
  LaunchedStatus,
  PackageKind,
} from '../types.ts'
import { StatusLamp } from './StatusLamp.tsx'

const INSTRUMENT_TYPES: InstrumentType[] = [
  'approval-letter',
  'acceptance-letter',
  'third-party-letter',
  'internal-letter',
]

const TR_ONE_SECTION = 'A temporary revision touches one section.'

function defaultInstrumentType(controlClass: ControlClass | undefined): InstrumentType {
  switch (controlClass) {
    case 'faa-approved':
      return 'approval-letter'
    case 'third-party':
      return 'third-party-letter'
    case 'internal':
      return 'internal-letter'
    default:
      return 'acceptance-letter'
  }
}

function stampKind(kind: PackageKind | null): string {
  if (kind === 'tr') return 'TR'
  if (kind === 'rev') return 'REV'
  return '—'
}

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
  const [instrumentType, setInstrumentType] = useState<InstrumentType>('acceptance-letter')
  const [instrumentAuthority, setInstrumentAuthority] = useState('poi')
  const [draftKind, setDraftKind] = useState<PackageKind>('rev')

  async function load() {
    if (!changeId) return
    const next = await api.change(changeId)
    setChange(next)
    const board = await api.launched(next.manual)
    setLaunched(board)
    setInstrumentType(defaultInstrumentType(board.control_class))
    if (next.kind) setDraftKind(next.kind)
    else if (next.touched.length >= 2) setDraftKind('rev')
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
  const isAuthorDesk = change.status === 'draft' || change.status === 'edit'
  const isReviewerDesk =
    change.status === 'review' || change.status === 'approved' || change.status === 'ready-to-launch'
  const isClosed = change.status === 'launched' || change.status === 'withdrawn'
  const isTr = change.kind === 'tr'
  const isRev = change.kind === 'rev'
  const classified = Boolean(change.kind)
  const manySections = change.touched.length >= 2
  const trLocked = manySections
  const hasInstrument = Boolean(change.instrument)
  const launchDocEmpty = isTr ? !trFile.trim() : !hasInstrument && !instrumentPath.trim()
  const canIssue =
    classified &&
    (change.status === 'approved' || change.status === 'ready-to-launch') &&
    (isTr ? Boolean(trFile.trim() && launched?.full) : hasInstrument)

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
          <span className="stamp-kind">{stampKind(change.kind)}</span>
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

      {change.status === 'launched' ? (
        <div className="banner">
          Launched as {change.launch_kind} {change.launch_id}. Withdraw is closed.
        </div>
      ) : isClosed ? null : (
        <div className="banner">Working copies live under control/working/{change.id}.</div>
      )}

      {next || change.status === 'ready-to-launch' || isAuthorDesk ? (
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

          {isAuthorDesk ? (
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
      ) : null}

      {isReviewerDesk ? (
        <section className="panel" style={{ marginBottom: 16 }}>
          <div className="panel-hd">PACKAGE KIND</div>
          <div className="form-grid" style={{ padding: 14 }}>
            <p className="meta">
              Name this packet before launch. One touched section may be a temporary revision; two or
              more must be a full revision.
            </p>
            <div className="field">
              <div className="kind-picks">
                <label className={`check ${trLocked ? 'disabled' : ''}`}>
                  <input
                    type="radio"
                    name="package-kind"
                    checked={draftKind === 'tr'}
                    disabled={trLocked || busy}
                    onChange={() => setDraftKind('tr')}
                  />
                  <span>Temporary revision</span>
                </label>
                <label className="check">
                  <input
                    type="radio"
                    name="package-kind"
                    checked={draftKind === 'rev'}
                    disabled={busy}
                    onChange={() => setDraftKind('rev')}
                  />
                  <span>Full revision</span>
                </label>
              </div>
              {manySections ? <p className="kind-warn">{TR_ONE_SECTION}</p> : null}
              {classified ? (
                <p className="meta">Current: {stampKind(change.kind)}</p>
              ) : (
                <p className="field-error">Classify this packet before launch.</p>
              )}
            </div>
            <div className="actions">
              <button
                className="btn"
                type="button"
                disabled={busy || (draftKind === 'tr' && manySections)}
                onClick={() =>
                  void run(async () => {
                    setChange(await api.classify(change.id, draftKind))
                  })
                }
              >
                {classified ? 'Update classification' : 'Classify packet'}
              </button>
            </div>
          </div>
        </section>
      ) : null}

      {isReviewerDesk && classified ? (
        <section className="panel" style={{ marginBottom: 16 }}>
          <div className="panel-hd">LAUNCH CONTROLS</div>
          <div className="form-grid" style={{ padding: 14 }}>
            {isRev ? (
              <label className="field">
                Effective date
                <input value={effective} onChange={(e) => setEffective(e.target.value)} />
              </label>
            ) : null}

            {isTr ? (
              <>
                <label className={`field ${!trFile.trim() ? 'invalid' : ''}`}>
                  TR letter path
                  <input
                    value={trFile}
                    onChange={(e) => setTrFile(e.target.value)}
                    placeholder="/path/to/cp-letter.txt"
                  />
                  {!trFile.trim() ? <span className="field-error">Launch document required.</span> : null}
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
            ) : hasInstrument ? (
              <p className="meta">
                Instrument {change.instrument!.type} · {change.instrument!.authority} ·{' '}
                {change.instrument!.file}
                <br />
                sha256 {change.instrument!.sha256}
              </p>
            ) : (
              <>
                <label className={`field ${launchDocEmpty ? 'invalid' : ''}`}>
                  Attach instrument — local file path
                  <input
                    value={instrumentPath}
                    onChange={(e) => setInstrumentPath(e.target.value)}
                    placeholder="/path/to/acceptance-letter.pdf"
                  />
                  {launchDocEmpty ? <span className="field-error">Launch document required.</span> : null}
                </label>
                <label className="field">
                  Instrument type
                  <select
                    value={instrumentType}
                    onChange={(e) => setInstrumentType(e.target.value as InstrumentType)}
                  >
                    {INSTRUMENT_TYPES.map((type) => (
                      <option key={type} value={type}>
                        {type}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  Instrument authority
                  <select
                    value={instrumentAuthority}
                    onChange={(e) => setInstrumentAuthority(e.target.value)}
                  >
                    <option value="poi">poi</option>
                    <option value="caa">caa</option>
                    <option value="chief-pilot">chief-pilot</option>
                    <option value="ae">ae</option>
                    <option value="ceo">ceo</option>
                    <option value="do">do</option>
                  </select>
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
                            type: instrumentType,
                            authority: instrumentAuthority,
                            dated: instrumentDated,
                          }),
                        )
                      })
                    }
                  >
                    Attach instrument
                  </button>
                </div>
              </>
            )}

            <div className="actions">
              <button
                className="btn primary"
                type="button"
                disabled={busy || !canIssue}
                onClick={() =>
                  void run(async () => {
                    if (isTr) {
                      await api.issueTr(change.id, {
                        parent: launched!.full!,
                        authority: trAuthority,
                        file: trFile.trim(),
                      })
                    } else {
                      await api.issueFull(change.id, effective)
                    }
                  })
                }
              >
                {isTr ? 'Issue temporary revision' : 'Launch revision'}
              </button>
            </div>
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
                {isClosed ? (
                  <span className="meta">{change.status === 'launched' ? 'Launched' : 'Closed'}</span>
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
