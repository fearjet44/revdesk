import type {
  ChangeAction,
  ChangeRecord,
  DeskPayload,
  IssueRecord,
  ManualDetail,
  ManualRecord,
  SectionFile,
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
  manuals: () => request<ManualRecord[]>('/api/manuals'),
  manual: (id: string) => request<ManualDetail>(`/api/manuals/${id}`),
  issuedSection: (manualId: string, sectionId: string) =>
    request<SectionFile>(`/api/manuals/${manualId}/sections/${sectionId}`),
  changes: () => request<ChangeRecord[]>('/api/changes'),
  change: (id: string) => request<ChangeRecord>(`/api/changes/${id}`),
  startChange: (body: { manual: string; title: string; reason: string; sectionIds: string[] }) =>
    request<ChangeRecord>('/api/changes', { method: 'POST', body: JSON.stringify(body) }),
  workingSection: (changeId: string, sectionId: string) =>
    request<SectionFile>(`/api/changes/${changeId}/sections/${sectionId}`),
  saveWorkingSection: (changeId: string, sectionId: string, markdown: string) =>
    request<SectionFile>(`/api/changes/${changeId}/sections/${sectionId}`, {
      method: 'PUT',
      body: JSON.stringify({ markdown }),
    }),
  transition: (changeId: string, action: ChangeAction) =>
    request<ChangeRecord>(`/api/changes/${changeId}/transition`, {
      method: 'POST',
      body: JSON.stringify({ action }),
    }),
  issues: () => request<IssueRecord[]>('/api/issues'),
  issue: (id: string) => request<IssueRecord>(`/api/issues/${id}`),
}
