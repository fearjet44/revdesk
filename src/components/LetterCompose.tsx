import type { CorrespondenceKind, CorrespondenceRecord } from '../types.ts'

export type ComposeDraft = {
  to: string
  from: string
  dated: string
  subject: string
  authority: string
  body: string
}

const MEMO_AUTHORITIES = ['chief-pilot', 'ae', 'ceo', 'do']
const REQUEST_AUTHORITIES = ['poi', 'caa', 'chief-pilot', 'ae', 'ceo', 'do']

export function LetterCompose({
  kind,
  draft,
  stored,
  busy,
  onChange,
  onStore,
}: {
  kind: CorrespondenceKind
  draft: ComposeDraft
  stored: CorrespondenceRecord | null
  busy: boolean
  onChange: (next: ComposeDraft) => void
  onStore: () => void
}) {
  const authorities = kind === 'memo' ? MEMO_AUTHORITIES : REQUEST_AUTHORITIES
  const canStore = Boolean(
    draft.to.trim() &&
      draft.from.trim() &&
      draft.subject.trim() &&
      draft.authority.trim() &&
      draft.body.trim() &&
      /^\d{4}-\d{2}-\d{2}$/.test(draft.dated.trim()),
  )
  const set = (patch: Partial<ComposeDraft>) => onChange({ ...draft, ...patch })

  return (
    <div className="compose">
      <p className="compose-role">
        {kind === 'memo'
          ? 'This memo is the launch instrument.'
          : 'This request is not the launch instrument. Attach the inbound reply to launch.'}
      </p>
      {stored ? (
        <p className="meta">
          Stored {stored.kind} · {stored.subject} · {stored.file}
          <br />
          sha256 {stored.sha256}
        </p>
      ) : null}
      <label className="field">
        To
        <input value={draft.to} onChange={(event) => set({ to: event.target.value })} />
      </label>
      <label className="field">
        From
        <input value={draft.from} onChange={(event) => set({ from: event.target.value })} />
      </label>
      <label className="field">
        Subject
        <input value={draft.subject} onChange={(event) => set({ subject: event.target.value })} />
      </label>
      <label className="field">
        Dated
        <input value={draft.dated} onChange={(event) => set({ dated: event.target.value })} />
      </label>
      <label className="field">
        Authority
        <select value={draft.authority} onChange={(event) => set({ authority: event.target.value })}>
          {authorities.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
      </label>
      <label className="field compose-body">
        Letter
        <textarea
          className="letter-body"
          value={draft.body}
          onChange={(event) => set({ body: event.target.value })}
          placeholder="Markdown body. Letterhead is later."
        />
      </label>
      <div className="actions">
        <button className="btn" type="button" disabled={busy || !canStore} onClick={onStore}>
          {kind === 'memo' ? 'Store memo' : 'Store request'}
        </button>
      </div>
    </div>
  )
}
