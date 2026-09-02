import { useState } from 'react'
import { api } from '../api.ts'
import type { ManualDetail } from '../types.ts'

export function StartChangeDialog({
  manual,
  onClose,
  onCreated,
}: {
  manual: ManualDetail
  onClose: () => void
  onCreated: (id: string) => Promise<void>
}) {
  const [title, setTitle] = useState('')
  const [reason, setReason] = useState('')
  const [sectionIds, setSectionIds] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  function toggle(id: string, held: boolean) {
    if (held) return
    setSectionIds((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    )
  }

  async function submit() {
    setBusy(true)
    setError(null)
    try {
      const change = await api.startChange({
        manual: manual.id,
        title,
        reason,
        sectionIds,
      })
      await onCreated(change.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not open the change.')
      setBusy(false)
    }
  }

  return (
    <div className="modal-back" role="presentation" onClick={onClose}>
      <div className="modal" role="dialog" aria-labelledby="start-change-title" onClick={(event) => event.stopPropagation()}>
        <div className="panel-hd">
          <span id="start-change-title">OPEN CHANGE · {manual.abbrev}</span>
          <button className="btn ghost" type="button" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="form-grid">
          {error ? <div className="banner error">{error}</div> : null}
          <label className="field">
            Title
            <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Short subject" />
          </label>
          <label className="field">
            Reason for issue
            <textarea
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Why this amendment is being made"
            />
          </label>
          <div className="field">
            Sections to copy into the working folder
            <div className="checks">
              {manual.sections.map((section) => {
                const held = Boolean(section.open_change)
                return (
                  <label key={section.id} className="check">
                    <input
                      type="checkbox"
                      checked={sectionIds.includes(section.id)}
                      disabled={held}
                      onChange={() => toggle(section.id, held)}
                    />
                    <span>
                      {section.title}
                      <div className="meta">{section.id} · last {section.rev_last_changed}</div>
                    </span>
                    {held ? <span className="held">{section.open_change}</span> : null}
                  </label>
                )
              })}
            </div>
          </div>
          <div className="actions">
            <button className="btn primary" type="button" disabled={busy} onClick={() => void submit()}>
              Create change packet
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
