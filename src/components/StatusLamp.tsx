import type { ChangeStatus } from '../types.ts'
import { STATUS_LABEL } from '../status.ts'

export function StatusLamp({ status }: { status: ChangeStatus }) {
  return (
    <span className={`lamp ${status}`}>
      <i />
      {STATUS_LABEL[status]}
    </span>
  )
}
