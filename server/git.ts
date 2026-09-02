import { existsSync, readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { parse as parseYaml } from 'yaml'

/** Porcelain paths that may be snapshotted on launch. Trailing slash = prefix. */
const ALLOWED_PREFIXES = ['manuals/', 'control/', 'artifacts/', '.revdesk/'] as const

export class GitAdapterError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export type GitConfig = {
  enabled: boolean
  change_branch: string
  full_tag: string
  tr_tag: string
  annotated: boolean
  update_ref_on_full_issue: string
  push_on_launch: boolean
  author_name: string
  author_email: string
  issue_id: string
}

export type GitStatusInfo = {
  enabled: boolean
  root: string | null
  data_root: string
  dirty: string[]
  disallowed: string[]
  config_path: string | null
}

export type GitSnapshotResult = {
  source_commit: string | null
  git_skipped: boolean
}

const DEFAULTS: GitConfig = {
  enabled: true,
  change_branch: 'change/{change_id}',
  full_tag: 'issued/{abbrev}/{revision}',
  tr_tag: 'issued/{abbrev}/{parent_revision}-TR/{seq}',
  annotated: true,
  update_ref_on_full_issue: '',
  push_on_launch: false,
  author_name: 'Revdesk',
  author_email: 'revdesk@local',
  issue_id: '{abbrev}-{revision}',
}

export function gitConfigPath(dataRoot: string): string {
  return path.join(dataRoot, '.revdesk', 'git.yaml')
}

export function loadGitConfig(dataRoot: string): GitConfig {
  const file = gitConfigPath(dataRoot)
  if (!existsSync(file)) return { ...DEFAULTS }
  const raw = parseYaml(readFileSync(file, 'utf8')) as Record<string, unknown> | null
  if (!raw || typeof raw !== 'object') return { ...DEFAULTS }
  return {
    enabled: raw.enabled !== false,
    change_branch: str(raw.change_branch, DEFAULTS.change_branch),
    full_tag: str(raw.full_tag, DEFAULTS.full_tag),
    tr_tag: raw.tr_tag == null ? DEFAULTS.tr_tag : String(raw.tr_tag),
    annotated: raw.annotated !== false,
    update_ref_on_full_issue: raw.update_ref_on_full_issue == null
      ? DEFAULTS.update_ref_on_full_issue
      : String(raw.update_ref_on_full_issue),
    push_on_launch: raw.push_on_launch === true,
    author_name: str(raw.author_name, DEFAULTS.author_name),
    author_email: str(raw.author_email, DEFAULTS.author_email),
    issue_id: str(raw.issue_id, DEFAULTS.issue_id),
  }
}

export function findGitRoot(start: string): string | null {
  let dir = path.resolve(start)
  for (;;) {
    if (existsSync(path.join(dir, '.git'))) return dir
    const parent = path.dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

export function formatTemplate(template: string, tokens: Record<string, string>): string {
  return template.replace(/\{([a-z_]+)\}/gi, (_, key: string) => tokens[key] ?? '')
}

export function fullTagName(cfg: GitConfig, tokens: { abbrev: string; revision: string }): string {
  return formatTemplate(cfg.full_tag, tokens)
}

export function trTagName(
  cfg: GitConfig,
  tokens: { abbrev: string; parent_revision: string; seq: string },
): string | null {
  if (!cfg.tr_tag.trim()) return null
  return formatTemplate(cfg.tr_tag, tokens)
}

export function changeBranchName(cfg: GitConfig, changeId: string): string {
  return formatTemplate(cfg.change_branch, { change_id: changeId })
}

export function gitStatus(dataRoot: string): GitStatusInfo {
  const cfg = loadGitConfig(dataRoot)
  const configFile = gitConfigPath(dataRoot)
  const root = findGitRoot(dataRoot)
  if (!root) {
    return {
      enabled: cfg.enabled,
      root: null,
      data_root: dataRoot,
      dirty: [],
      disallowed: [],
      config_path: existsSync(configFile) ? configFile : null,
    }
  }
  const dirty = porcelainPaths(root, cfg)
  const disallowed = dirty.filter((gitRel) => !isAllowedGitPath(gitRel, root, dataRoot))
  return {
    enabled: cfg.enabled,
    root,
    data_root: dataRoot,
    dirty: dirty.map((gitRel) => displayPath(gitRel, root, dataRoot)),
    disallowed: disallowed.map((gitRel) => displayPath(gitRel, root, dataRoot)),
    config_path: existsSync(configFile) ? configFile : null,
  }
}

/**
 * Refuse launch if dirty paths sit outside manuals/ control/ artifacts/ .revdesk/,
 * or if the intended tag already exists. No-op when git is disabled or missing.
 */
export function preflightLaunch(dataRoot: string, tag: string | null): void {
  const cfg = loadGitConfig(dataRoot)
  if (!cfg.enabled) return
  const root = findGitRoot(dataRoot)
  if (!root) return

  const dirty = porcelainPaths(root, cfg)
  const disallowed = dirty.filter((gitRel) => !isAllowedGitPath(gitRel, root, dataRoot))
  if (disallowed.length) {
    const listed = disallowed.map((p) => `  ${displayPath(p, root, dataRoot)}`).join('\n')
    throw new GitAdapterError(
      2,
      `Uncommitted files outside manuals/, control/, artifacts/, .revdesk/:\n${listed}`,
    )
  }

  if (tag && refExists(root, cfg, `refs/tags/${tag}`)) {
    throw new GitAdapterError(
      2,
      `Git tag ${tag} already exists; will not move or replace it.`,
    )
  }
}

export function startChangeBranch(
  dataRoot: string,
  changeId: string,
  startRef?: string | null,
): void {
  const cfg = loadGitConfig(dataRoot)
  if (!cfg.enabled) return
  const root = findGitRoot(dataRoot)
  if (!root) return

  const branch = changeBranchName(cfg, changeId)
  let start =
    startRef && refExists(root, cfg, startRef) ? startRef : 'HEAD'
  // If HEAD already contains the last issued commit (e.g. a follow-up
  // source_commit record), branch from HEAD so we do not rewind.
  if (start !== 'HEAD') {
    const ancestor = spawnGit(root, cfg, ['merge-base', '--is-ancestor', start, 'HEAD'])
    if (ancestor.status === 0) start = 'HEAD'
  }

  if (refExists(root, cfg, `refs/heads/${branch}`)) {
    runGit(root, cfg, ['switch', '--', branch])
    return
  }

  const head = revParse(root, cfg, 'HEAD')
  const startSha = revParse(root, cfg, start)
  if (head && startSha && head === startSha) {
    runGit(root, cfg, ['switch', '-c', branch])
    return
  }
  runGit(root, cfg, ['switch', '-c', branch, start])
}

/**
 * After Slice 2 YAML is on disk: commit allowed dirty paths, annotated tag,
 * then persist source_commit and commit that update. Never `-f` a tag.
 */
export function snapshotLaunch(
  dataRoot: string,
  opts: {
    tag: string | null
    message: string
    persistSourceCommit: (sha: string | null, skipped: boolean) => void
  },
): GitSnapshotResult {
  const cfg = loadGitConfig(dataRoot)
  if (!cfg.enabled) {
    opts.persistSourceCommit(null, true)
    return { source_commit: null, git_skipped: true }
  }
  const root = findGitRoot(dataRoot)
  if (!root) {
    console.error(
      'warning: git is enabled but no repository was found; launch recorded without a tag',
    )
    opts.persistSourceCommit(null, true)
    return { source_commit: null, git_skipped: true }
  }

  // Re-check immediately before commit so a race cannot -f the tag.
  if (opts.tag && refExists(root, cfg, `refs/tags/${opts.tag}`)) {
    throw new GitAdapterError(
      2,
      `Git tag ${opts.tag} already exists; will not move or replace it.`,
    )
  }

  const dirty = porcelainPaths(root, cfg)
  const disallowed = dirty.filter((gitRel) => !isAllowedGitPath(gitRel, root, dataRoot))
  if (disallowed.length) {
    const listed = disallowed.map((p) => `  ${displayPath(p, root, dataRoot)}`).join('\n')
    throw new GitAdapterError(
      2,
      `Uncommitted files outside manuals/, control/, artifacts/, .revdesk/:\n${listed}`,
    )
  }

  const toAdd = dirty.filter((gitRel) => isAllowedGitPath(gitRel, root, dataRoot))
  if (toAdd.length) {
    runGit(root, cfg, ['add', '--', ...toAdd])
    commit(root, cfg, opts.message)
  }

  const sha = revParse(root, cfg, 'HEAD')
  if (!sha) {
    throw new GitAdapterError(5, 'git rev-parse HEAD failed after launch snapshot.')
  }

  if (opts.tag) {
    createAnnotatedTag(root, cfg, opts.tag, opts.message)
  }

  maybeUpdateRef(root, cfg, sha)
  maybePush(root, cfg, opts.tag)

  opts.persistSourceCommit(sha, false)

  const after = porcelainPaths(root, cfg).filter((gitRel) =>
    isAllowedGitPath(gitRel, root, dataRoot),
  )
  if (after.length) {
    runGit(root, cfg, ['add', '--', ...after])
    commit(root, cfg, `${opts.message} (source_commit)`)
  }

  return { source_commit: sha, git_skipped: false }
}

export function tagOk(
  dataRoot: string,
  gitTag: string | null | undefined,
  sourceCommit: string | null | undefined,
): boolean {
  if (!gitTag || !sourceCommit) return false
  const cfg = loadGitConfig(dataRoot)
  const root = findGitRoot(dataRoot)
  if (!root) return false
  if (!refExists(root, cfg, `refs/tags/${gitTag}`)) return false
  const pointed = revParse(root, cfg, `${gitTag}^{commit}`)
  return Boolean(pointed) && pointed === sourceCommit
}

export function resolveTagCommit(dataRoot: string, gitTag: string): string | null {
  const cfg = loadGitConfig(dataRoot)
  const root = findGitRoot(dataRoot)
  if (!root) return null
  if (!refExists(root, cfg, `refs/tags/${gitTag}`)) return null
  return revParse(root, cfg, `${gitTag}^{commit}`)
}

function createAnnotatedTag(root: string, cfg: GitConfig, tag: string, message: string): void {
  if (!cfg.annotated) {
    throw new GitAdapterError(2, 'git.yaml annotated: false is not supported; launch tags must be annotated.')
  }
  // No -f. Existing tags are a hard stop.
  const result = spawnGit(root, cfg, ['tag', '-a', tag, '-m', message])
  if (result.status === 0) return
  const text = `${result.stderr}\n${result.stdout}`
  if (/cannot create|exists; cannot create/i.test(text)) {
    throw new GitAdapterError(
      2,
      `Cannot create git tag ${tag}: it nests under an existing tag (Git refs cannot be both a file and a directory). Change tr_tag / full_tag in .revdesk/git.yaml.`,
    )
  }
  if (/already exists/i.test(text)) {
    throw new GitAdapterError(2, `Git tag ${tag} already exists; will not move or replace it.`)
  }
  throw new GitAdapterError(2, gitFail('tag', result))
}

function maybeUpdateRef(root: string, cfg: GitConfig, sha: string): void {
  const name = cfg.update_ref_on_full_issue.trim()
  if (!name) return
  if (name === 'main' || name === 'master') {
    console.error(`warning: refusing to move ${name}; update_ref_on_full_issue is ignored`)
    return
  }
  runGit(root, cfg, ['update-ref', `refs/heads/${name}`, sha])
}

function maybePush(root: string, cfg: GitConfig, tag: string | null): void {
  if (!cfg.push_on_launch) return
  const args = ['push', 'origin']
  if (tag) args.push(`refs/tags/${tag}`)
  else args.push('HEAD')
  // Never --force.
  const result = spawnGit(root, cfg, args)
  if (result.status !== 0) {
    console.error(`warning: git push failed: ${(result.stderr || result.stdout).trim()}`)
  }
}

function commit(root: string, cfg: GitConfig, message: string): void {
  const result = spawnGit(root, cfg, ['commit', '-m', message])
  if (result.status === 0) return
  const text = `${result.stdout}\n${result.stderr}`
  if (/nothing to commit/i.test(text)) return
  throw new GitAdapterError(5, gitFail('commit', result))
}

function porcelainPaths(root: string, cfg: GitConfig): string[] {
  const result = spawnGit(root, cfg, ['status', '--porcelain=v1', '-uall'])
  if (result.status !== 0) {
    throw new GitAdapterError(5, gitFail('status', result))
  }
  return parsePorcelain(result.stdout)
}

function parsePorcelain(stdout: string): string[] {
  const paths: string[] = []
  for (const line of stdout.split('\n')) {
    if (line.length < 4) continue
    const xy = line.slice(0, 2)
    const body = line.slice(3)
    if (xy.includes('R') || xy.includes('C')) {
      const parts = body.split(' -> ')
      paths.push(unquote(parts[0] ?? ''), unquote(parts[1] ?? ''))
    } else {
      paths.push(unquote(body))
    }
  }
  return [...new Set(paths.filter(Boolean))]
}

function unquote(value: string): string {
  const trimmed = value.trim()
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1).replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\"/g, '"')
  }
  return trimmed
}

function isAllowedGitPath(gitRel: string, gitRoot: string, dataRoot: string): boolean {
  const dataRel = toDataRel(gitRel, gitRoot, dataRoot)
  if (dataRel == null) return false
  if (dataRel === '' || dataRel === '.') return false
  const normalized = dataRel.replace(/\\/g, '/').replace(/^\.\//, '')
  return ALLOWED_PREFIXES.some(
    (prefix) => normalized === prefix.slice(0, -1) || normalized.startsWith(prefix),
  )
}

function toDataRel(gitRel: string, gitRoot: string, dataRoot: string): string | null {
  const abs = path.resolve(gitRoot, gitRel)
  const dataAbs = path.resolve(dataRoot)
  const rel = path.relative(dataAbs, abs)
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null
  return rel.split(path.sep).join('/')
}

function displayPath(gitRel: string, gitRoot: string, dataRoot: string): string {
  return toDataRel(gitRel, gitRoot, dataRoot) ?? gitRel
}

function refExists(root: string, cfg: GitConfig, ref: string): boolean {
  const result = spawnGit(root, cfg, ['show-ref', '--verify', '--quiet', ref])
  if (result.status === 0) return true
  // Tags / HEAD-ish names: try rev-parse
  if (!ref.startsWith('refs/')) {
    const parsed = spawnGit(root, cfg, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`])
    return parsed.status === 0 && Boolean(parsed.stdout.trim())
  }
  return false
}

function revParse(root: string, cfg: GitConfig, rev: string): string | null {
  const result = spawnGit(root, cfg, ['rev-parse', '--verify', `${rev}`])
  if (result.status !== 0) return null
  const sha = result.stdout.trim()
  return sha || null
}

function runGit(root: string, cfg: GitConfig, args: string[]): void {
  const result = spawnGit(root, cfg, args)
  if (result.status !== 0) {
    throw new GitAdapterError(2, gitFail(args[0] ?? 'git', result))
  }
}

function spawnGit(
  root: string,
  cfg: GitConfig,
  args: string[],
): { status: number; stdout: string; stderr: string } {
  const result = spawnSync(
    'git',
    ['-c', `user.name=${cfg.author_name}`, '-c', `user.email=${cfg.author_email}`, ...args],
    {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: '0',
        GIT_AUTHOR_NAME: cfg.author_name,
        GIT_AUTHOR_EMAIL: cfg.author_email,
        GIT_COMMITTER_NAME: cfg.author_name,
        GIT_COMMITTER_EMAIL: cfg.author_email,
      },
    },
  )
  if (result.error) {
    throw new GitAdapterError(5, `git failed to start: ${result.error.message}`)
  }
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  }
}

function gitFail(verb: string, result: { stdout: string; stderr: string }): string {
  const text = (result.stderr || result.stdout).trim() || `git ${verb} failed`
  return text
}

function str(value: unknown, fallback: string): string {
  if (value == null || value === '') return fallback
  return String(value)
}
