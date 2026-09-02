import { Link } from 'react-router-dom'
import type { DeskPayload } from '../types.ts'
import { StatusLamp } from './StatusLamp.tsx'
import { formatDate } from '../status.ts'

export function DeskHome({ desk }: { desk: DeskPayload | null }) {
  if (!desk) return <div className="empty">Reading the control library…</div>

  const issued = desk.manuals[0]

  return (
    <>
      <div className="page-head">
        <div>
          <p className="kicker">Control desk</p>
          <h1>Issued books on the board</h1>
          <p className="lede">
            Open a change to amend a section. Review, approve, then issue. The issued revision is
            what the library shows as current. Working copies stay off the line until issue.
          </p>
        </div>
        {issued ? (
          <div className="stamp-block">
            <strong>CURRENT BOARD</strong>
            {issued.abbrev} {issued.current_issued}
            <br />
            Effective {formatDate(issued.effective)}
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
                    {manual.control} · {manual.owner}
                  </div>
                </span>
                <span className="mono">{manual.current_issued}</span>
                <span className="meta">Eff {formatDate(manual.effective)}</span>
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
                  <div className="meta">{change.touched.length} section(s)</div>
                </span>
                <StatusLamp status={change.status} />
                <span className="meta">{change.target_revision}</span>
              </Link>
            ))}
          </div>
        </section>
      </div>
    </>
  )
}
