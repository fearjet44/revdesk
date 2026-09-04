export const WRITE_MARKS = [
  { code: 'RF', label: 'Regulator finding', needsNote: true },
  { code: 'AEF', label: 'Accountable Executive finding', needsNote: true },
  { code: 'RAP', label: 'Remedial action plan', needsNote: true },
  { code: 'IA', label: 'Internal audit / SMS finding', needsNote: true },
  { code: 'PC', label: 'Policy change', needsNote: false },
  { code: 'OS', label: 'OpSpecs / LOA / authorization', needsNote: false },
  { code: 'EQ', label: 'Equipment, AFM, MEL, or config', needsNote: false },
  { code: 'GS', label: 'Grammar / spelling / punctuation', needsNote: false },
  { code: 'CL', label: 'Clarify; no policy change', needsNote: false },
  { code: 'M', label: 'Moved', needsNote: false },
  { code: 'NLN', label: 'No longer needed', needsNote: false },
  { code: 'XR', label: 'Cross-reference', needsNote: false },
  { code: 'CF', label: 'Crew or user feedback', needsNote: false },
  { code: 'SB', label: 'Manufacturer / service bulletin', needsNote: false },
  { code: 'SE', label: 'Same edit', needsNote: false, afterFirst: true },
] as const

export type WriteMarkCode = (typeof WRITE_MARKS)[number]['code']
export type WriteMark = (typeof WRITE_MARKS)[number]

const BY_CODE = new Map(WRITE_MARKS.map((row) => [row.code, row]))

export function writeMarkAfterFirst(row: WriteMark): boolean {
  return 'afterFirst' in row && row.afterFirst === true
}

export function parseWriteMark(
  code: string,
  note?: string,
  priorMark?: string | null,
): { mark: WriteMarkCode; note: string | undefined } {
  const row = BY_CODE.get(code.trim().toUpperCase() as WriteMarkCode)
  if (!row) {
    throw new Error(
      `Unknown write mark ${code}. Use ${WRITE_MARKS.map((item) => item.code).join('|')}.`,
    )
  }
  if (writeMarkAfterFirst(row) && !priorMark) {
    throw new Error(`${row.code} is only allowed after the first write on this leaf.`)
  }
  const trimmed = (note ?? '').trim()
  if (row.needsNote && !trimmed) {
    throw new Error(`${row.code} requires a note (finding, letter, or RAP id).`)
  }
  return { mark: row.code, note: trimmed || undefined }
}

export function formatWriteMark(mark: string, note?: string | null): string {
  return note?.trim() ? `${mark} — ${note.trim()}` : mark
}

export function snapshotMarkLine(changeId: string, sectionId: string, mark: string, note?: string | null): string {
  const extra = note?.trim() ? ` ${note.trim()}` : ''
  return `${changeId} ${sectionId} ${mark}${extra}`
}
