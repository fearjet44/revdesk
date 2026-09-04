import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { api } from '../api.ts'
import type { ChangeRecord } from '../types.ts'
import { ReviewSection } from './ReviewSection.tsx'
import { SectionEditor } from './SectionEditor.tsx'

const REVIEWER = new Set(['review', 'approved', 'ready-to-launch'])

export function SectionDesk({ onChanged }: { onChanged: () => Promise<void> }) {
  const { changeId } = useParams()
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
  if (REVIEWER.has(change.status)) return <ReviewSection onChanged={onChanged} />
  return <SectionEditor onChanged={onChanged} />
}
