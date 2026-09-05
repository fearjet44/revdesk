import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
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
  if (!issue) return <div className="empty">Pulling the issued book…</div>

  return (
    <>
      <div className="page-head">
        <div>
          <p className="kicker">ISSUED · {issue.control_class}</p>
          <h1>{issue.id}</h1>
          <p className="lede">
            {issue.summary} Open a leaf for the read-only paper. Leave a crew finding there. PDF is
            reference only.
          </p>
        </div>
        <div className="actions">
          <Link className="btn primary" to={`/issues/${issue.id}/pdf`} target="_blank" rel="noreferrer">
            PDF
          </Link>
        </div>
      </div>

      <div className="stamp-block" style={{ marginBottom: 16 }}>
        <strong>LAUNCHED</strong>
        R{issue.revision} · effective {formatDate(issue.effective)}
        <br />
        {issue.instrument.type} · {issue.instrument.authority}
        <br />
        <span className="meta">{issue.instrument.file}</span>
      </div>

      <section className="panel">
        <div className="panel-hd">
          <span>SECTIONS</span>
          <span>{issue.sections.length}</span>
        </div>
        <div className="rows">
          {issue.sections.map((section) => (
            <div key={section.id} className="row">
              <span className="mono">{section.id}</span>
              <Link className="section-link" to={`/issues/${issue.id}/sections/${section.id}`}>
                <span className="title">{section.title}</span>
              </Link>
              <span className="mono">{section.rev_last_changed}</span>
              <Link className="btn" to={`/issues/${issue.id}/sections/${section.id}`}>
                Open
              </Link>
            </div>
          ))}
        </div>
      </section>
    </>
  )
}
