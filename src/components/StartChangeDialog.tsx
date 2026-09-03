import { useState } from 'react'
import { api } from '../api.ts'
import type { ManualDetail, PackageKind } from '../types.ts'

const TR_ONE_SECTION = 'A temporary revision touches one section.'

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
  const [kind, setKind] = useState<PackageKind>('rev')
  const [sectionIds, setSectionIds] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const manySections = sectionIds.length >= 2
  const trLocked = manySections
  const canCreate = !busy && title.trim() && reason.trim() && sectionIds.length > 0

  function toggle(id: string, held: boolean) {
    if (held) return
    setSectionIds((current) => {
      const next = current.includes(id) ? current.filter((item) => item !== id) : [...current, id]
      if (next.length >= 2) setKind('rev')
      return next
    })
  }

  function pickKind(next: PackageKind) {
    if (next === 'tr' && sectionIds.length >= 2) return
    setKind(next)
  }

  async function submit() {
    if (!sectionIds.length) {
      setError('A change must touch at least one section.')
      return
    }
    if (kind === 'tr' && sectionIds.length !== 1) {
      setError(TR_ONE_SECTION)
      return
    }
    setBusy(true)
    setError(null)
    try {
      const change = await api.startChange({
        manual: manual.id,
        title,
        reason,
        kind,
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
            Package kind
            <div className="kind-picks">
              <label className={`check ${trLocked ? 'disabled' : ''}`}>
                <input
                  type="radio"
                  name="package-kind"
                  checked={kind === 'tr'}
                  disabled={trLocked}
                  onChange={() => pickKind('tr')}
                />
                <span>Temporary revision</span>
              </label>
              <label className="check">
                <input
                  type="radio"
                  name="package-kind"
                  checked={kind === 'rev'}
                  onChange={() => pickKind('rev')}
                />
                <span>Full revision</span>
              </label>
            </div>
            {manySections ? <p className="kind-warn">{TR_ONE_SECTION}</p> : null}
          </div>
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
            <button className="btn primary" type="button" disabled={!canCreate} onClick={() => void submit()}>
              Create change packet
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
