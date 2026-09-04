import type {
  ChangeAction,
  ChangeRecord,
  DeskPayload,
  InstrumentRecord,
  IssueRecord,
  LaunchedStatus,
  ManualDetail,
  ManualRecord,
  ReviewComment,
  SectionFile,
  SectionReview,
  TrRecord,
} from './types.ts'

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  })
  const data = (await response.json()) as T & { error?: string }
  if (!response.ok) throw new Error(data.error ?? `Request failed (${response.status})`)
  return data
}

export const api = {
  desk: () => request<DeskPayload>('/api/desk'),
  launched: (manualId: string) => request<LaunchedStatus>(`/api/launched/${manualId}`),
  manuals: () => request<ManualRecord[]>('/api/manuals'),
  manual: (id: string) => request<ManualDetail>(`/api/manuals/${id}`),
  issuedSection: (manualId: string, sectionId: string) =>
    request<SectionFile>(`/api/manuals/${manualId}/sections/${sectionId}`),
  changes: () => request<ChangeRecord[]>('/api/changes'),
  change: (id: string) => request<ChangeRecord>(`/api/changes/${id}`),
  startChange: (body: {
    manual: string
    title: string
    reason: string
    kind?: 'tr' | 'rev' | 'wip'
    sectionIds: string[]
    supersedes?: string
  }) => request<ChangeRecord>('/api/changes', { method: 'POST', body: JSON.stringify(body) }),
  workingSection: (changeId: string, sectionId: string) =>
    request<SectionFile>(`/api/changes/${changeId}/sections/${sectionId}`),
  reviewSection: (changeId: string, sectionId: string) =>
    request<SectionReview>(`/api/changes/${changeId}/sections/${sectionId}/review`),
  comments: (changeId: string) => request<ReviewComment[]>(`/api/changes/${changeId}/comments`),
  addComment: (
    changeId: string,
    body: { section: string; line: number; side: 'old' | 'new'; body: string },
  ) =>
    request<ReviewComment>(`/api/changes/${changeId}/comments`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  answerComment: (
    changeId: string,
    commentId: string,
    body: { status: 'done' | 'stand' | 'later'; reason?: string },
  ) =>
    request<ReviewComment>(`/api/changes/${changeId}/comments/${commentId}/answer`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  saveWorkingSection: (
    changeId: string,
    sectionId: string,
    markdown: string,
    mark?: { mark: string; note?: string },
  ) =>
    request<SectionFile>(`/api/changes/${changeId}/sections/${sectionId}`, {
      method: 'PUT',
      body: JSON.stringify({ markdown, mark: mark?.mark, note: mark?.note }),
    }),
  transition: (changeId: string, action: ChangeAction) =>
    request<ChangeRecord>(`/api/changes/${changeId}/transition`, {
      method: 'POST',
      body: JSON.stringify({ action }),
    }),
  attachInstrument: (
    changeId: string,
    body: { file: string; type: string; authority: string; dated: string; reference?: string },
  ) =>
    request<ChangeRecord>(`/api/changes/${changeId}/instrument`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  issueFull: (changeId: string, effective: string) =>
    request<IssueRecord>(`/api/changes/${changeId}/issue`, {
      method: 'POST',
      body: JSON.stringify({ effective }),
    }),
  issueTr: (
    changeId: string,
    body: { parent: string; authority: string; file: string; expires?: string },
  ) =>
    request<TrRecord>(`/api/changes/${changeId}/tr`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  withdraw: (changeId: string, why: string) =>
    request<ChangeRecord>(`/api/changes/${changeId}/withdraw`, {
      method: 'POST',
      body: JSON.stringify({ why }),
    }),
  returnToEdit: (changeId: string) =>
    request<ChangeRecord>(`/api/changes/${changeId}/return-to-edit`, { method: 'POST', body: '{}' }),
  issues: () => request<IssueRecord[]>('/api/issues'),
  issue: (id: string) => request<IssueRecord>(`/api/issues/${id}`),
  trs: (manual?: string) =>
    request<TrRecord[]>(manual ? `/api/trs?manual=${encodeURIComponent(manual)}` : '/api/trs'),
  instrument: (_changeId: string): Promise<InstrumentRecord> => {
    throw new Error('Use change.instrument')
  },
}
