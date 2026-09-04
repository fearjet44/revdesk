import { useEffect, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { api } from '../api.ts'
import type { ChangeRecord } from '../types.ts'
import { ReviewSection } from './ReviewSection.tsx'
import { SectionEditor } from './SectionEditor.tsx'
import type { SectionView } from './ViewToggle.tsx'

const REVIEWER = new Set(['review', 'approved', 'ready-to-launch'])

export function SectionDesk({ onChanged }: { onChanged: () => Promise<void> }) {
  const { changeId } = useParams()
  const [params, setParams] = useSearchParams()
  const [change, setChange] = useState<ChangeRecord | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!changeId) return
    let cancelled = false
    api
      .change(changeId)
      .then((next) => {
        if (!cancelled) setChange(next)
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Unable to open the section.')
      })
    return () => {
      cancelled = true
    }
  }, [changeId])

  if (error && !change) return <div className="banner error">{error}</div>
  if (!change) return <div className="empty">Opening the working copy…</div>

  const reviewer = REVIEWER.has(change.status)
  const requested = params.get('view')
  const view: SectionView =
    requested === 'print' || requested === 'review' ? requested : reviewer ? 'review' : 'print'

  function setView(next: SectionView) {
    const nextParams = new URLSearchParams(params)
    nextParams.set('view', next)
    setParams(nextParams, { replace: true })
  }

  if (view === 'review') {
    return <ReviewSection onChanged={onChanged} view={view} onView={setView} />
  }
  return <SectionEditor onChanged={onChanged} readOnly={reviewer} view={view} onView={setView} />
}
