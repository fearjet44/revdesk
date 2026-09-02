import type { ChangeAction, ChangeStatus } from './types.ts'

export const STATUS_LABEL: Record<ChangeStatus, string> = {
  draft: 'DRAFT',
  review: 'REVIEW',
  approved: 'APPROVED',
  'ready-to-launch': 'READY',
  edit: 'EDIT',
  launched: 'LAUNCHED',
  withdrawn: 'WITHDRAWN',
}

export const NEXT_ACTION: Partial<Record<ChangeStatus, { action: ChangeAction; label: string }>> = {
  draft: { action: 'submit', label: 'Submit for review' },
  edit: { action: 'submit', label: 'Resubmit for review' },
  review: { action: 'approve', label: 'Approve' },
}

export function formatDate(value: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split('-').map(Number)
    return new Date(year, month - 1, day).toLocaleDateString('en-US', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    })
  }
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('en-US', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}
