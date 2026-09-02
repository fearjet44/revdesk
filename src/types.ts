export type ControlClass = 'faa-approved' | 'faa-accepted' | 'third-party' | 'internal'

export type ChangeStatus =
  | 'draft'
  | 'review'
  | 'approved'
  | 'ready-to-launch'
  | 'edit'
  | 'launched'
  | 'withdrawn'

export type ChangeAction = 'submit' | 'approve'
export type TouchAction = 'amend' | 'add' | 'delete'

export type InstrumentType =
  | 'approval-letter'
  | 'acceptance-letter'
  | 'third-party-letter'
  | 'internal-letter'

export type Frontmatter = {
  id: string
  title: string
  rev_last_changed: string
}

export type ManualRecord = {
  id: string
  title: string
  abbrev: string
  control_class: ControlClass
  control: string
  owner: string
  authority: string
  instrument_required: boolean
  current_issued: string | null
  next_revision: number
  effective: string | null
}

export type SectionSummary = {
  id: string
  title: string
  rev_last_changed: string
  path: string
  filename: string
  open_change: string | null
}

export type ManualDetail = ManualRecord & {
  sections: SectionSummary[]
}

export type ChangeReasonMeta = {
  type: string
  ref?: string
}

export type TouchedSection = {
  id: string
  title: string
  source: string
  working: string
  action: TouchAction
}

export type ChangeEvent = {
  at: string
  action: string
  note?: string
}

export type InstrumentRecord = {
  type: InstrumentType
  authority: string
  file: string
  sha256: string
  dated: string
  reference?: string
}

export type ChangeRecord = {
  id: string
  manual: string
  status: ChangeStatus
  title: string
  reason: string
  reason_meta?: ChangeReasonMeta
  created: string
  author: string
  target_revision: string | null
  supersedes?: string | null
  instrument?: InstrumentRecord | null
  launch_kind?: 'full' | 'temporary' | null
  launch_id?: string | null
  touched: TouchedSection[]
  history: ChangeEvent[]
}

export type IssueSection = {
  id: string
  title: string
  rev_last_changed: string
}

export type IssueRecord = {
  id: string
  kind: 'full'
  state: 'launched'
  manual: string
  revision: number
  control_class: ControlClass
  supersedes: string | null
  change: string
  effective: string
  instrument: InstrumentRecord
  manual_artifact: { file: string; sha256: string }
  git_tag: string
  incorporated_trs: string[]
  launched_at: string
  summary: string
  sections: IssueSection[]
}

export type TrRecord = {
  id: string
  kind: 'temporary-revision'
  state: 'launched' | 'incorporated'
  manual: string
  parent: string
  seq: number
  change: string
  authority: string
  instrument: InstrumentRecord
  expires: string | null
  incorporated_by: string | null
  launched_at: string
  summary: string
  sections: IssueSection[]
}

export type LaunchedStatus = {
  manual: string
  abbrev: string
  full: string | null
  full_state: 'launched' | 'none'
  active_trs: string[]
  next_full: number
  next_full_launched: false
  control_class: ControlClass
}

export type DeskPayload = {
  manuals: ManualRecord[]
  changes: ChangeRecord[]
  issues: IssueRecord[]
  trs: TrRecord[]
}

export type SectionFile = {
  path: string
  meta: Frontmatter
  markdown: string
  body: string
}
