export const UNIT: string
export const DESK_PORT: number

export type DeskPaths = {
  home: string
  primary: string
  worktrees: string
  dropinDir: string
  dropin: string
  unit: string
  port: number
}

export type DeskArgs = {
  cmd?: string
  sub?: string
  pr?: string
  branch?: string
  tree?: string
  error?: string
}

export type DeskResult = {
  exitCode: number
  json: Record<string, unknown>
}

export function defaultPaths(env?: NodeJS.ProcessEnv, home?: string): DeskPaths
export function parseDeskArgs(sub?: string, rest?: string[]): DeskArgs
export function dropinContents(workingDirectory: string): string
export function parseDropinWorkingDirectory(text: string): string | null
export function parseWorktreeList(porcelain: string): Array<{
  path?: string
  head?: string
  branch?: string
  detached?: boolean
}>
export function slugBranch(branch: string): string
export function expandPath(p: string, home: string): string
export function resolveGitCommonDir(tree: string, raw: string): string
export function runDesk(args: DeskArgs, io?: Record<string, unknown>): Promise<DeskResult>
