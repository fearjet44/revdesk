import type { DocTheme } from '../server/theme.ts'

export type ControlClass = 'faa-approved' | 'faa-accepted' | 'third-party' | 'internal'

export type ChangeStatus =
  | 'draft'
  | 'review'
  | 'approved'
  | 'approval-requested'
  | 'ready-to-launch'
  | 'edit'
  | 'launched'
  | 'withdrawn'

export type ChangeAction = 'submit' | 'approve' | 'open-letter'
export type TouchAction = 'amend' | 'add' | 'delete'
/** tr/rev are named at review/launch. wip = dirty pages, unclassified. */
export type PackageKind = 'tr' | 'rev' | 'wip'

export type InstrumentType =
  | 'approval-letter'
  | 'acceptance-letter'
  | 'third-party-letter'
  | 'internal-letter'

export type ManagedKind = 'ror' | 'lep' | 'les' | 'toc'

export type ControlSurface = 'lep' | 'les' | 'rev-only'

export type PaginationRegion = {
  name: string
  scheme: string
  slots?: string[]
}

export type ManualPagination = {
  control_surface: ControlSurface
  lep_inferred?: boolean
  regions?: PaginationRegion[]
}

export type Frontmatter = {
  id: string
  title: string
  rev_last_changed: string
  managed?: ManagedKind | null
  lep_start?: string | null
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
  pagination?: ManualPagination | null
  lep_slots?: string[]
}

export type SectionSummary = {
  id: string
  title: string
  rev_last_changed: string
  path: string
  filename: string
  open_change: string | null
  managed: ManagedKind | null
  lep_start: string | null
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
  mark?: string
  mark_note?: string
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

export type CorrespondenceKind = 'memo' | 'request'

export type CorrespondenceRecord = {
  kind: CorrespondenceKind
  to: string
  from: string
  dated: string
  subject: string
  authority: string
  change: string
  file: string
  sha256: string
  /** Hydrated from the stored Markdown on read; not written to change YAML. */
  body?: string
}

export type ChangeRecord = {
  id: string
  manual: string
  status: ChangeStatus
  /** Named at review/launch. Missing or `wip` on disk → unclassified. */
  kind: PackageKind
  title: string
  reason: string
  reason_meta?: ChangeReasonMeta
  created: string
  author: string
  target_revision: string | null
  supersedes?: string | null
  instrument?: InstrumentRecord | null
  correspondence?: CorrespondenceRecord | null
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
  source_commit: string | null
  git_skipped?: boolean
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
  git_tag: string
  source_commit: string | null
  git_skipped?: boolean
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
  tag: string | null
  source_commit: string | null
  tag_ok: boolean
}

export type DeskPayload = {
  manuals: ManualRecord[]
  changes: ChangeRecord[]
  issues: IssueRecord[]
  trs: TrRecord[]
}

export type LibraryInfo = {
  remote: string
  bound: boolean
  solo: boolean
  library_root: string
  cloned: boolean
}

export type IngestSectionPreview = {
  kind: string
  number: string | null
  title: string
  start: string | null
}

export type IngestPreview = {
  control_surface: string
  control_class_guess: string | null
  house_style: string
  kind_guess: string
  revision: { number: number | null; date: string | null; label: string | null }
  sections: IngestSectionPreview[]
  source: { filename: string; pages: number | null }
}

export type IngestApplyResult = {
  id: string
  title: string
  abbrev: string
  catalog: string | null
  matched_gold: boolean
  sections: number
}

export type SectionFile = {
  path: string
  meta: Frontmatter
  markdown: string
  body: string
}

export type IssuedSectionFile = SectionFile & {
  theme: DocTheme
  manual: ManualDetail
  section: SectionSummary
}

export type CrewFinding = {
  id: string
  issue: string
  manual: string
  section: string
  author: string
  at: string
  body: string
  status: 'open' | 'done' | 'stand' | 'later'
}

export type CrewSectionFile = IssuedSectionFile & {
  issue: IssueRecord
  findings: CrewFinding[]
  can_find: boolean
}

export type DiffKind = 'equal' | 'del' | 'add'

export type DiffRow = {
  kind: DiffKind
  old_line: number | null
  new_line: number | null
  text: string
}

export type QueryStatus = 'open' | 'done' | 'stand' | 'later'
export type QueryFrom = 'reviewer' | 'gap' | 'author'

export type ReviewComment = {
  id: string
  change: string
  section: string
  path: string
  line: number
  side: 'old' | 'new'
  body: string
  author: string
  at: string
  from: QueryFrom
  cite: string | null
  suggest: string | null
  status: QueryStatus
  reason: string | null
  basis: string | null
}

export type SectionReview = {
  change: ChangeRecord
  section: TouchedSection
  source: string
  working: string
  rows: DiffRow[]
  comments: ReviewComment[]
  commit: string | null
  branch: string | null
  notes_ref: string
  can_comment: boolean
  can_answer: boolean
  theme: DocTheme
}
