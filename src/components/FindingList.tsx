import type { CrewFinding } from '../types.ts'

export function FindingList({
  findings,
  note,
}: {
  findings: CrewFinding[]
  note?: string
}) {
  if (!findings.length) return null
  return (
    <section className="panel comment-return">
      <div className="panel-hd">
        CREW FINDINGS · {findings.length}
        {note ? ` · ${note}` : ''}
      </div>
      <div className="comment-list">
        {findings.map((finding) => (
          <div key={finding.id} className="comment-card">
            <div className="comment-card-body">
              <div className="diff-thread-hd">
                <strong>{finding.author}</strong>
                <span className="meta">
                  {finding.status} · {finding.id}
                </span>
              </div>
              <p>{finding.body}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
