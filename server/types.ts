export type ControlClass = 'faa-approved' | 'faa-accepted' | 'third-party' | 'internal'

export type ChangeStatus =
  | 'draft'
  | 'review'
  | 'approved'
  | 'ready-to-launch'
  | 'edit'
  | 'launched'
  | 'withdrawn'

/** Lifecycle verbs (not including launch / TR / withdraw / return-to-edit). */
export type ChangeAction = 'submit' | 'approve'

export type TouchAction = 'amend' | 'add' | 'delete'

export type PackageKind = 'tr' | 'rev'

export type InstrumentType =
  | 'approval-letter'
  | 'acceptance-letter'
  | 'third-party-letter'
  | 'internal-letter'

export type InstrumentAuthority =
  | 'poi'
  | 'caa'
  | 'chief-pilot'
  | 'ae'
  | 'ceo'
  | 'do'
  | string

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
  /** @deprecated prefer control_class; kept for UI display */
  control: string
  owner: string
  authority: string
  instrument_required: boolean
  /** Full issue id e.g. GOM-R13, or null if never launched */
  current_issued: string | null
  /** Next full revision number to assign at launch (not minted on change start) */
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
  /**
   * Set by the reviewer after submit (Slice 5).
   * Null until classified. Legacy packets with no kind on disk stay null while open.
   */
  kind: PackageKind | null
  title: string
  reason: string
  reason_meta?: ChangeReasonMeta
  created: string
  author: string
  /** Informational only — never assigned at start; set on full launch */
  target_revision: string | null
  supersedes?: string | null
  instrument?: InstrumentRecord | null
  launch_kind?: 'full' | 'temporary' | null
  launch_id?: string | null
  touched: TouchedSection[]
  history: ChangeEvent[]
}

export type ManualArtifact = {
  file: string
  sha256: string
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
  manual_artifact: ManualArtifact
  /** Actual git ref, e.g. issued/GOM/14 — not the YAML issue id. */
  git_tag: string
  source_commit: string | null
  git_skipped?: boolean
  incorporated_trs: string[]
  launched_at: string
  summary: string
  sections: IssueSection[]
}

export type IssueSection = {
  id: string
  title: string
  rev_last_changed: string
}

export type TrState = 'launched' | 'incorporated'

export type TrRecord = {
  id: string
  kind: 'temporary-revision'
  state: TrState
  manual: string
  parent: string
  seq: number
  change: string
  authority: string
  instrument: InstrumentRecord
  expires: string | null
  incorporated_by: string | null
  /** Actual git ref, e.g. issued/GOM/13-TR/1; empty if tr_tag is disabled. */
  git_tag: string
  source_commit: string | null
  git_skipped?: boolean
  launched_at: string
  summary: string
  sections: IssueSection[]
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

export type ChangePreview = {
  change: ChangeRecord
  manual: ManualRecord
  sections: Array<{
    id: string
    title: string
    action: TouchAction
    source: string
    working: string
    unchanged: boolean
    source_rev: string
    working_rev: string
  }>
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
  /** False if the record names a tag that is missing or points at a different commit. */
  tag_ok: boolean
}
