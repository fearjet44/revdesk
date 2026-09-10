import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { parse as parseYaml } from 'yaml'
import { RepoError } from './repo.ts'

/** Desk config. The Config screen edits this file. Not tag grammar (`git.yaml`). */
export type DeskConfig = {
  remote: string
}

export type LibraryInfo = {
  remote: string
  bound: boolean
  solo: boolean
  library_root: string
  config_path: string
  cloned: boolean
}

const EMPTY: DeskConfig = { remote: '' }

export function userConfigPath(): string {
  const xdg = process.env.XDG_CONFIG_HOME?.trim() || path.join(os.homedir(), '.config')
  return path.join(xdg, 'revdesk', 'config.yaml')
}

export function sampleConfigPath(appRoot: string): string {
  return path.join(appRoot, 'data', '.revdesk', 'config.yaml')
}

export function loadDeskConfig(appRoot?: string): DeskConfig {
  const user = userConfigPath()
  if (existsSync(user)) return parseConfigFile(user)
  if (appRoot) {
    const sample = sampleConfigPath(appRoot)
    if (existsSync(sample)) return parseConfigFile(sample)
  }
  return { ...EMPTY }
}

export function saveDeskConfig(cfg: DeskConfig): string {
  const file = userConfigPath()
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, dumpConfig(cfg))
  return file
}

export function dumpConfig(cfg: DeskConfig): string {
  const remote = cfg.remote.trim()
  return [
    '# Revdesk desk config. The Config screen edits this file.',
    '# Empty remote = this checkout’s data/ library (solo, no account).',
    '# Paste a manuals-library URL to bind a remote (dummy, then company).',
    '',
    `remote: ${yamlScalar(remote)}`,
    '',
  ].join('\n')
}

export function defaultClonePath(remote: string): string {
  const xdg = process.env.XDG_DATA_HOME?.trim() || path.join(os.homedir(), '.local', 'share')
  return path.join(xdg, 'revdesk', 'libraries', slugRemote(remote))
}

export function resolveLibraryRoot(appRoot: string): string {
  if (process.env.REVDESK_DATA?.trim()) return path.resolve(process.env.REVDESK_DATA)
  const cfg = loadDeskConfig(appRoot)
  if (!cfg.remote) return path.join(appRoot, 'data')
  return ensureClone(cfg.remote)
}

export function libraryInfo(appRoot: string): LibraryInfo {
  const cfg = loadDeskConfig(appRoot)
  const user = userConfigPath()
  const config_path = existsSync(user) ? user : sampleConfigPath(appRoot)
  if (process.env.REVDESK_DATA?.trim()) {
    const library_root = path.resolve(process.env.REVDESK_DATA)
    return {
      remote: cfg.remote,
      bound: Boolean(cfg.remote),
      solo: false,
      library_root,
      config_path,
      cloned: existsSync(path.join(library_root, '.git')),
    }
  }
  if (!cfg.remote) {
    return {
      remote: '',
      bound: false,
      solo: true,
      library_root: path.join(appRoot, 'data'),
      config_path,
      cloned: false,
    }
  }
  const dest = defaultClonePath(cfg.remote)
  return {
    remote: cfg.remote,
    bound: true,
    solo: false,
    library_root: dest,
    config_path,
    cloned: existsSync(path.join(dest, '.git')),
  }
}

export function bindRemote(remote: string): LibraryInfo {
  const url = remote.trim()
  const file = saveDeskConfig({ remote: url })
  if (!url) {
    return {
      remote: '',
      bound: false,
      solo: true,
      library_root: '',
      config_path: file,
      cloned: false,
    }
  }
  const library_root = ensureClone(url)
  return {
    remote: url,
    bound: true,
    solo: false,
    library_root,
    config_path: file,
    cloned: true,
  }
}

export function ensureClone(remote: string): string {
  const dest = defaultClonePath(remote)
  if (existsSync(path.join(dest, '.git'))) return dest
  if (existsSync(dest)) {
    throw new RepoError(5, `Library path ${dest} exists and is not a manuals checkout.`)
  }
  mkdirSync(path.dirname(dest), { recursive: true })
  const result = spawnSync('git', ['clone', remote, dest], {
    encoding: 'utf8',
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  })
  if (result.status !== 0) {
    const text = (result.stderr || result.stdout).trim() || 'git clone failed'
    throw new RepoError(5, `Could not open the manuals library: ${text}`)
  }
  return dest
}

function parseConfigFile(file: string): DeskConfig {
  const raw = parseYaml(readFileSync(file, 'utf8')) as Record<string, unknown> | null
  if (!raw || typeof raw !== 'object') return { ...EMPTY }
  if (typeof raw.remote === 'string') return { remote: raw.remote.trim() }
  if (raw.remote && typeof raw.remote === 'object') {
    const url = (raw.remote as Record<string, unknown>).url
    return { remote: typeof url === 'string' ? url.trim() : '' }
  }
  return { ...EMPTY }
}

function slugRemote(remote: string): string {
  const cleaned = remote.trim().replace(/\.git$/i, '')
  const hosted = cleaned.match(/(?:github\.com|gitlab\.com)[:/]([^/]+)\/([^/]+)$/i)
  if (hosted) return `${hosted[1]}-${hosted[2]}`
  return cleaned
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'library'
}

function yamlScalar(value: string): string {
  if (!value) return '""'
  if (/^https?:\/\//.test(value) || /^git@/.test(value)) return value
  if (/[:#{}[\],&*?!'"]|^\s|\s$/.test(value)) return JSON.stringify(value)
  return value
}
