export type DiffKind = 'equal' | 'del' | 'add'

export type DiffRow = {
  kind: DiffKind
  old_line: number | null
  new_line: number | null
  text: string
}

/** Split the way `git diff` counts lines: a trailing newline does not add a blank row. */
export function splitLines(text: string): string[] {
  if (text === '') return []
  const lines = text.split('\n')
  if (lines[lines.length - 1] === '') lines.pop()
  return lines
}

/** Line-oriented LCS diff. Section files are small; O(n·m) is fine. */
export function lineDiff(oldText: string, newText: string): DiffRow[] {
  const oldLines = splitLines(oldText)
  const newLines = splitLines(newText)
  const n = oldLines.length
  const m = newLines.length
  const dp: number[][] = Array.from({ length: n + 1 }, () => Array<number>(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] =
        oldLines[i] === newLines[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }

  const rows: DiffRow[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (oldLines[i] === newLines[j]) {
      rows.push({ kind: 'equal', old_line: i + 1, new_line: j + 1, text: oldLines[i] })
      i += 1
      j += 1
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      rows.push({ kind: 'del', old_line: i + 1, new_line: null, text: oldLines[i] })
      i += 1
    } else {
      rows.push({ kind: 'add', old_line: null, new_line: j + 1, text: newLines[j] })
      j += 1
    }
  }
  while (i < n) {
    rows.push({ kind: 'del', old_line: i + 1, new_line: null, text: oldLines[i] })
    i += 1
  }
  while (j < m) {
    rows.push({ kind: 'add', old_line: null, new_line: j + 1, text: newLines[j] })
    j += 1
  }
  return rows
}
