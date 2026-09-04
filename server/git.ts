import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { parse as parseYaml } from 'yaml'

/** Git notes namespace for reviewer comments. Inspect with `git notes --ref=revdesk/review show <commit>`. */
export const REVIEW_NOTES_REF = 'revdesk/review'

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
  /** Walk up from REVDESK_DATA to find .git. False = only data root (sample library). */
  discover_parent: boolean
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

export type ReviewFile = {
  gitPath: string
  content: string
}

export type ReviewCommentRecord = {
  id: string
  change: string
  section: string
  path: string
  line: number
  side: 'old' | 'new'
  body: string
  author: string
  at: string
  from?: 'reviewer' | 'gap' | 'author'
  cite?: string | null
  suggest?: string | null
  status?: 'open' | 'done' | 'stand' | 'later'
  reason?: string | null
  basis?: string | null
}

export type ReviewNotes = {
  change: string
  commit: string
  comments: ReviewCommentRecord[]
}

export type ReviewSnapshot = {
  commit: string
  branch: string
  git_root: string
  reused: boolean
}

const DEFAULTS: GitConfig = {
  enabled: true,
  discover_parent: true,
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
    discover_parent: raw.discover_parent !== false,
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

export function findGitRoot(start: string, walkParents = true): string | null {
  let dir = path.resolve(start)
  for (;;) {
    if (existsSync(path.join(dir, '.git'))) return dir
    if (!walkParents) return null
    const parent = path.dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

/**
 * Git root we are willing to tag/branch. Walking up from `data/` in this
 * development checkout finds revdesk's own .git — that is the application,
 * not the operator manuals library, so we skip it.
 */
function resolveManualsGitRoot(dataRoot: string): string | null {
  const cfg = loadGitConfig(dataRoot)
  const root = findGitRoot(dataRoot, cfg.discover_parent)
  if (!root) return null
  if (isRevdeskApplicationRepo(root, dataRoot)) return null
  return root
}

function isRevdeskApplicationRepo(gitRoot: string, dataRoot: string): boolean {
  const dataAbs = path.resolve(dataRoot)
  const prefix = dataAbs.endsWith(path.sep) ? dataAbs : `${dataAbs}${path.sep}`
  const markers = ['src/App.tsx', 'cli/revdesk.ts', 'server/repo.ts']
  for (const rel of markers) {
    const abs = path.resolve(gitRoot, rel)
    if (!existsSync(abs)) continue
    if (abs === dataAbs || abs.startsWith(prefix)) continue
    return true
  }
  return false
}

function warnIfSkippedApplicationRepo(dataRoot: string): void {
  const root = findGitRoot(dataRoot)
  if (root && isRevdeskApplicationRepo(root, dataRoot)) {
    console.error(
      `warning: git is enabled but ${root} is the Revdesk application checkout, not a manuals library; skipping git`,
    )
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
  const root = resolveManualsGitRoot(dataRoot)
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
  const root = resolveManualsGitRoot(dataRoot)
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
  const root = resolveManualsGitRoot(dataRoot)
  if (!root) {
    warnIfSkippedApplicationRepo(dataRoot)
    return
  }

  const branch = changeBranchName(cfg, changeId)
  let start =
    startRef && refExists(root, cfg, startRef) ? startRef : 'HEAD'
  if (start !== 'HEAD') {
    const ancestor = spawnGit(root, cfg, ['merge-base', '--is-ancestor', start, 'HEAD'])
    if (ancestor.status === 0) start = 'HEAD'
  }

  // Point a change/* ref at the start commit. Never `git switch` — Revdesk
  // uses a single working tree (REVDESK_DATA), so moving HEAD would hijack
  // the operator's checkout (and this application's, if mis-detected).
  if (refExists(root, cfg, `refs/heads/${branch}`)) return
  runGit(root, cfg, ['branch', '--', branch, start])
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
  const root = resolveManualsGitRoot(dataRoot)
  if (!root) {
    warnIfSkippedApplicationRepo(dataRoot)
    if (!findGitRoot(dataRoot)) {
      console.error(
        'warning: git is enabled but no repository was found; launch recorded without a tag',
      )
    }
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
  const root = resolveManualsGitRoot(dataRoot)
  if (!root) return false
  if (!refExists(root, cfg, `refs/tags/${gitTag}`)) return false
  const pointed = revParse(root, cfg, `${gitTag}^{commit}`)
  return Boolean(pointed) && pointed === sourceCommit
}

export function resolveTagCommit(dataRoot: string, gitTag: string): string | null {
  const cfg = loadGitConfig(dataRoot)
  const root = resolveManualsGitRoot(dataRoot)
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
  extra?: { env?: Record<string, string | undefined>; input?: string },
): { status: number; stdout: string; stderr: string } {
  const result = spawnSync(
    'git',
    ['-c', `user.name=${cfg.author_name}`, '-c', `user.email=${cfg.author_email}`, ...args],
    {
      cwd: root,
      encoding: 'utf8',
      input: extra?.input,
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: '0',
        GIT_AUTHOR_NAME: cfg.author_name,
        GIT_AUTHOR_EMAIL: cfg.author_email,
        GIT_COMMITTER_NAME: cfg.author_name,
        GIT_COMMITTER_EMAIL: cfg.author_email,
        ...extra?.env,
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

/**
 * Git root used for review snapshots and notes. Unlike launch tags, this
 * *may* be the Revdesk application checkout — the reviewer asked Git to leak.
 * Still uses a detached index so HEAD and the operator's index stay put.
 */
export function resolveReviewGitRoot(dataRoot: string): string | null {
  const cfg = loadGitConfig(dataRoot)
  if (!cfg.enabled) return null
  // Walk even when git.yaml discover_parent is false. Launch tags still skip
  // the application checkout; review notes are the leak the reviewer asked for.
  return findGitRoot(dataRoot, true)
}

export function toGitPath(dataRoot: string, absOrDataRel: string): string {
  const root = resolveReviewGitRoot(dataRoot)
  if (!root) {
    throw new GitAdapterError(5, 'No git repository; review comments are stored as git notes.')
  }
  const abs = path.isAbsolute(absOrDataRel) ? absOrDataRel : path.join(dataRoot, absOrDataRel)
  const rel = path.relative(root, abs).split(path.sep).join('/')
  if (!rel || rel === '.' || rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new GitAdapterError(5, `Path ${abs} is outside the git repository ${root}.`)
  }
  return rel
}

export function changeBranchTip(dataRoot: string, changeId: string): string | null {
  const cfg = loadGitConfig(dataRoot)
  const root = resolveReviewGitRoot(dataRoot)
  if (!root) return null
  const branch = changeBranchName(cfg, changeId)
  if (!refExists(root, cfg, `refs/heads/${branch}`)) return null
  return revParse(root, cfg, `refs/heads/${branch}`)
}

/**
 * Commit working section contents at their *issued* paths on `change/{id}`
 * without checking the branch out. Parent is the existing change branch, else HEAD.
 */
export function snapshotReview(
  dataRoot: string,
  changeId: string,
  files: ReviewFile[],
  message: string,
): ReviewSnapshot {
  const cfg = loadGitConfig(dataRoot)
  if (!cfg.enabled) {
    throw new GitAdapterError(5, 'Git is disabled; review comments are stored as git notes.')
  }
  const root = resolveReviewGitRoot(dataRoot)
  if (!root) {
    throw new GitAdapterError(5, 'No git repository; review comments are stored as git notes.')
  }

  const branch = changeBranchName(cfg, changeId)
  const branchRef = `refs/heads/${branch}`
  const parent =
    (refExists(root, cfg, branchRef) ? revParse(root, cfg, branchRef) : null) ??
    revParse(root, cfg, 'HEAD')
  if (!parent) {
    throw new GitAdapterError(5, 'git rev-parse HEAD failed; cannot snapshot a review commit.')
  }

  const dir = mkdtempSync(path.join(tmpdir(), 'revdesk-review-'))
  const indexFile = path.join(dir, 'index')
  const env = { GIT_INDEX_FILE: indexFile }
  try {
    runGitEnv(root, cfg, ['read-tree', parent], env)
    for (const file of files) {
      const hashed = spawnGit(root, cfg, ['hash-object', '-w', '--stdin'], { input: file.content })
      if (hashed.status !== 0) throw new GitAdapterError(5, gitFail('hash-object', hashed))
      const blob = hashed.stdout.trim()
      if (!blob) throw new GitAdapterError(5, 'git hash-object returned an empty sha.')
      runGitEnv(
        root,
        cfg,
        ['update-index', '--add', '--cacheinfo', `100644,${blob},${file.gitPath}`],
        env,
      )
    }
    const treeResult = spawnGit(root, cfg, ['write-tree'], { env })
    if (treeResult.status !== 0) throw new GitAdapterError(5, gitFail('write-tree', treeResult))
    const tree = treeResult.stdout.trim()
    const parentTree = revParse(root, cfg, `${parent}^{tree}`)
    if (parentTree && tree === parentTree) {
      return { commit: parent, branch, git_root: root, reused: true }
    }
    const commitResult = spawnGit(root, cfg, ['commit-tree', tree, '-p', parent, '-m', message], {
      env,
    })
    if (commitResult.status !== 0) throw new GitAdapterError(5, gitFail('commit-tree', commitResult))
    const commit = commitResult.stdout.trim()
    if (!commit) throw new GitAdapterError(5, 'git commit-tree returned an empty sha.')
    runGit(root, cfg, ['update-ref', branchRef, commit])
    copyReviewNotes(root, cfg, parent, commit)
    return { commit, branch, git_root: root, reused: false }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

export function readReviewNotes(dataRoot: string, changeId: string): ReviewNotes | null {
  const cfg = loadGitConfig(dataRoot)
  const root = resolveReviewGitRoot(dataRoot)
  if (!root) return null
  const commit = changeBranchTip(dataRoot, changeId)
  if (!commit) return null
  return parseNotes(showNotes(root, cfg, commit), changeId, commit)
}

export function writeReviewNotes(
  dataRoot: string,
  changeId: string,
  commit: string,
  comments: ReviewCommentRecord[],
): ReviewNotes {
  const cfg = loadGitConfig(dataRoot)
  const root = resolveReviewGitRoot(dataRoot)
  if (!root) {
    throw new GitAdapterError(5, 'No git repository; review comments are stored as git notes.')
  }
  const payload: ReviewNotes = { change: changeId, commit, comments }
  const json = `${JSON.stringify(payload, null, 2)}\n`
  writeNotesFile(root, cfg, commit, json)
  return payload
}

function copyReviewNotes(root: string, cfg: GitConfig, from: string, to: string): void {
  if (from === to) return
  const shown = showNotes(root, cfg, from)
  if (!shown) return
  try {
    writeNotesFile(root, cfg, to, shown.endsWith('\n') ? shown : `${shown}\n`)
  } catch {
    console.error(`warning: could not copy review notes from ${from.slice(0, 7)} to ${to.slice(0, 7)}`)
  }
}

function writeNotesFile(root: string, cfg: GitConfig, commit: string, contents: string): void {
  const dir = mkdtempSync(path.join(tmpdir(), 'revdesk-notes-'))
  const file = path.join(dir, 'notes.json')
  try {
    writeFileSync(file, contents)
    const result = spawnGit(root, cfg, ['notes', `--ref=${REVIEW_NOTES_REF}`, 'add', '-f', '-F', file, commit])
    if (result.status !== 0) throw new GitAdapterError(5, gitFail('notes', result))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

function showNotes(root: string, cfg: GitConfig, commit: string): string | null {
  const result = spawnGit(root, cfg, ['notes', `--ref=${REVIEW_NOTES_REF}`, 'show', commit])
  if (result.status !== 0) return null
  const text = result.stdout.trim()
  return text || null
}

function parseNotes(raw: string | null, changeId: string, commit: string): ReviewNotes | null {
  if (!raw) return { change: changeId, commit, comments: [] }
  try {
    const parsed = JSON.parse(raw) as Partial<ReviewNotes>
    const comments = Array.isArray(parsed.comments) ? parsed.comments.filter(isComment) : []
    return { change: changeId, commit, comments }
  } catch {
    throw new GitAdapterError(5, `Review notes on ${commit} are not valid JSON.`)
  }
}

function isComment(row: unknown): row is ReviewCommentRecord {
  if (!row || typeof row !== 'object') return false
  const c = row as Record<string, unknown>
  return (
    typeof c.id === 'string' &&
    typeof c.change === 'string' &&
    typeof c.section === 'string' &&
    typeof c.path === 'string' &&
    typeof c.line === 'number' &&
    (c.side === 'old' || c.side === 'new') &&
    typeof c.body === 'string' &&
    typeof c.author === 'string' &&
    typeof c.at === 'string'
  )
}

function runGitEnv(
  root: string,
  cfg: GitConfig,
  args: string[],
  env: Record<string, string | undefined>,
): void {
  const result = spawnGit(root, cfg, args, { env })
  if (result.status !== 0) {
    throw new GitAdapterError(2, gitFail(args[0] ?? 'git', result))
  }
}
