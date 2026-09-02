import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { api } from '../api.ts'
import { formatDate } from '../status.ts'
import type { IssueRecord } from '../types.ts'

export function IssueView() {
  const { issueId } = useParams()
  const [issue, setIssue] = useState<IssueRecord | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!issueId) return
    api
      .issue(issueId)
      .then(setIssue)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Unable to load issue.'))
  }, [issueId])

  if (error) return <div className="banner error">{error}</div>
  if (!issue) return <div className="empty">Pulling the issue record…</div>

  return (
    <>
      <div className="page-head">
        <div>
          <p className="kicker">LAUNCHED FULL REVISION</p>
          <h1>{issue.id}</h1>
          <p className="lede">{issue.summary}</p>
        </div>
        <div className="stamp-block">
          <strong>{issue.state.toUpperCase()}</strong>
          R{issue.revision} · {issue.control_class}
          <br />
          Effective {formatDate(issue.effective)}
          <br />
          From {issue.change}
        </div>
      </div>

      <section className="panel" style={{ marginBottom: 16 }}>
        <div className="panel-hd">INSTRUMENT</div>
        <div style={{ padding: 14 }}>
          <div className="meta">
            {issue.instrument.type} · {issue.instrument.authority} · dated{' '}
            {formatDate(issue.instrument.dated)}
          </div>
          <div className="hash">{issue.instrument.sha256}</div>
          <p className="meta">{issue.instrument.file}</p>
        </div>
      </section>

      <section className="panel" style={{ marginBottom: 16 }}>
        <div className="panel-hd">MANUAL ARTIFACT</div>
        <div style={{ padding: 14 }}>
          <div className="meta">{issue.manual_artifact.file}</div>
          <div className="hash">{issue.manual_artifact.sha256}</div>
          <p className="meta">git_tag {issue.git_tag} (stub this slice)</p>
          {issue.incorporated_trs.length ? (
            <p className="meta">Incorporated TRs: {issue.incorporated_trs.join(', ')}</p>
          ) : null}
        </div>
      </section>

      <section className="panel">
        <div className="panel-hd">SECTIONS ON THIS ISSUE</div>
        <div className="rows">
          {issue.sections.map((section) => (
            <div key={section.id} className="row">
              <span className="mono">{section.id}</span>
              <span className="title">{section.title}</span>
              <span className="mono">{section.rev_last_changed}</span>
              <span />
            </div>
          ))}
        </div>
      </section>
    </>
  )
}
