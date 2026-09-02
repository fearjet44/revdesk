import { Link } from 'react-router-dom'
import type { DeskPayload } from '../types.ts'
import { StatusLamp } from './StatusLamp.tsx'
import { formatDate } from '../status.ts'

export function DeskHome({ desk }: { desk: DeskPayload | null }) {
  if (!desk) return <div className="empty">Reading the control library…</div>

  const issued = desk.manuals[0]
  const activeTrs = (desk.trs ?? []).filter((tr) => tr.state === 'launched')

  return (
    <>
      <div className="page-head">
        <div>
          <p className="kicker">Control desk</p>
          <h1>Launched books on the board</h1>
          <p className="lede">
            Open a change, review, attach an instrument, then launch. Without a letter, issue a
            temporary revision against the last launched full rev. A Git tag is not a launch.
          </p>
        </div>
        {issued ? (
          <div className="stamp-block">
            <strong>CURRENT BOARD</strong>
            {issued.current_issued ?? '(never launched)'}
            <br />
            Next full {issued.next_revision}
            <br />
            {activeTrs.length
              ? `Active TRs ${activeTrs.map((t) => t.id).join(', ')}`
              : 'No active TRs'}
            <br />
            Owner {issued.owner}
          </div>
        ) : null}
      </div>

      <div className="grid-2">
        <section className="panel">
          <div className="panel-hd">MANUALS</div>
          <div className="rows">
            {desk.manuals.map((manual) => (
              <Link key={manual.id} className="row" to={`/manuals/${manual.id}`}>
                <span className="mono">{manual.abbrev}</span>
                <span>
                  <div className="title">{manual.title}</div>
                  <div className="meta">
                    {manual.control_class} · {manual.owner}
                  </div>
                </span>
                <span className="mono">{manual.current_issued ?? '—'}</span>
                <span className="meta">
                  {manual.effective ? `Eff ${formatDate(manual.effective)}` : 'Not launched'}
                </span>
              </Link>
            ))}
          </div>
        </section>
        <section className="panel">
          <div className="panel-hd">CHANGE BAY</div>
          <div className="rows">
            {desk.changes.length === 0 ? <div className="empty">No changes on file.</div> : null}
            {desk.changes.map((change) => (
              <Link key={change.id} className="row" to={`/changes/${change.id}`}>
                <span className="mono">{change.id}</span>
                <span>
                  <div className="title">{change.title}</div>
                  <div className="meta">
                    {change.touched.length} section(s)
                    {change.launch_id ? ` · ${change.launch_id}` : ''}
                  </div>
                </span>
                <StatusLamp status={change.status} />
                <span className="meta">{change.target_revision ?? `next ${issued?.next_revision ?? '—'}`}</span>
              </Link>
            ))}
          </div>
        </section>
      </div>
    </>
  )
}
