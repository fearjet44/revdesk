export type ChangeStatus = 'draft' | 'in_review' | 'approved' | 'issued'
export type ChangeAction = 'submit' | 'approve' | 'issue'

export type Frontmatter = {
  id: string
  title: string
  rev_last_changed: string
}

export type ManualRecord = {
  id: string
  title: string
  abbrev: string
  control: string
  owner: string
  current_issued: string
  effective: string
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

export type TouchedSection = {
  id: string
  title: string
  source: string
  working: string
}

export type ChangeEvent = {
  at: string
  action: string
  note?: string
}

export type ChangeRecord = {
  id: string
  manual: string
  status: ChangeStatus
  title: string
  reason: string
  created: string
  author: string
  target_revision: string
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
  manual: string
  revision: string
  issued: string
  effective: string
  sha256: string
  summary: string
  change?: string
  sections: IssueSection[]
}

export type DeskPayload = {
  manuals: ManualRecord[]
  changes: ChangeRecord[]
  issues: IssueRecord[]
}

export type SectionFile = {
  path: string
  meta: Frontmatter
  markdown: string
  body: string
}
