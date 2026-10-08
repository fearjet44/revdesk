import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

export type ToolName = 'chrome' | 'qpdf' | 'pdftotext' | 'pdfinfo' | 'pdffonts' | 'git'

export type ToolStatus = {
  name: ToolName
  path: string | null
  version: string | null
  needed_for: string
  install: string | null
  override: { env: string; path: string } | null
}

export type DoctorReport = { ok: boolean; platform: NodeJS.Platform; tools: ToolStatus[] }

const TOOLS: ToolName[] = ['chrome', 'qpdf', 'pdftotext', 'pdfinfo', 'pdffonts', 'git']

const NEEDED_FOR: Record<ToolName, string> = {
  chrome: 'PDF render',
  qpdf: 'PDF watermark and page stamps',
  pdftotext: 'PDF render and ingest',
  pdfinfo: 'PDF render and ingest',
  pdffonts: 'PDF render and ingest',
  git: 'history, launch, and bound library',
}

const VERSION_ARGS: Record<ToolName, string[]> = {
  chrome: ['--version'],
  qpdf: ['--version'],
  pdftotext: ['-v'],
  pdfinfo: ['-v'],
  pdffonts: ['-v'],
  git: ['--version'],
}

const BREW: Record<ToolName, string> = {
  chrome: 'Download Chrome from google.com/chrome',
  qpdf: 'brew install qpdf',
  pdftotext: 'brew install poppler',
  pdfinfo: 'brew install poppler',
  pdffonts: 'brew install poppler',
  git: 'brew install git',
}

const WINGET: Record<ToolName, string | null> = {
  chrome: null,
  qpdf: 'winget install QPDF.QPDF',
  pdftotext: 'winget install oschwartz10612.Poppler',
  pdfinfo: 'winget install oschwartz10612.Poppler',
  pdffonts: 'winget install oschwartz10612.Poppler',
  git: 'winget install Git.Git',
}

const APT: Record<ToolName, string> = {
  chrome: 'sudo apt install chromium',
  qpdf: 'sudo apt install qpdf',
  pdftotext: 'sudo apt install poppler-utils',
  pdfinfo: 'sudo apt install poppler-utils',
  pdffonts: 'sudo apt install poppler-utils',
  git: 'sudo apt install git',
}

/** The one line that installs `name` on `platform`. Null when the OS ships it (Edge on Windows). */
export function installHint(name: ToolName, platform: NodeJS.Platform): string | null {
  if (platform === 'darwin') return BREW[name]
  if (platform === 'win32') return WINGET[name]
  return APT[name]
}

const MAC_CHROME = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
]

const WIN_CHROME: Array<[string, string]> = [
  ['ProgramFiles', 'Google\\Chrome\\Application\\chrome.exe'],
  ['ProgramFiles(x86)', 'Google\\Chrome\\Application\\chrome.exe'],
  ['LOCALAPPDATA', 'Google\\Chrome\\Application\\chrome.exe'],
  ['ProgramFiles(x86)', 'Microsoft\\Edge\\Application\\msedge.exe'],
  ['ProgramFiles', 'Microsoft\\Edge\\Application\\msedge.exe'],
]

const WIN_GIT: Array<[string, string]> = [['ProgramFiles', 'Git\\cmd\\git.exe']]

const CHROME_NAMES = ['chromium', 'chromium-browser', 'google-chrome', 'google-chrome-stable', 'msedge']

const isWindows = () => process.platform === 'win32'

/** Absolute path when found, else the bare command name (so the caller's ENOENT message still fires). */
export function toolPath(name: ToolName): string {
  const override = envOverride(name)
  if (override) return override.path
  return resolvedPath(name) ?? (name === 'chrome' ? 'chromium' : name)
}

function resolvedPath(name: ToolName): string | null {
  return knownLocation(name) ?? searchPath(name)
}

/** An override is the user's explicit choice: it wins even when the file is missing. */
function envOverride(name: ToolName): { env: string; path: string } | null {
  const env = (key: string) => process.env[key]?.trim() || null
  const named = (key: string) => {
    const value = env(key)
    return value ? { env: key, path: value } : null
  }
  if (name === 'chrome') return named('REVDESK_CHROME')
  if (name === 'qpdf') return named('REVDESK_QPDF')
  if (name === 'git') return named('REVDESK_GIT')
  const dir = env('REVDESK_POPPLER_DIR')
  return dir ? { env: 'REVDESK_POPPLER_DIR', path: path.join(dir, name + (isWindows() ? '.exe' : '')) } : null
}

function knownLocation(name: ToolName): string | null {
  if (name === 'chrome' && process.platform === 'darwin') return MAC_CHROME.find((p) => existsSync(p)) ?? null
  if (!isWindows()) return null
  const candidates = name === 'chrome' ? WIN_CHROME : name === 'git' ? WIN_GIT : []
  for (const [envKey, rel] of candidates) {
    const base = process.env[envKey]
    if (!base) continue
    const full = path.win32.join(base, rel)
    if (existsSync(full)) return full
  }
  return null
}

function searchPath(name: ToolName): string | null {
  const dirs = (process.env.PATH ?? '').split(path.delimiter).filter(Boolean)
  const exts = isWindows() ? (process.env.PATHEXT || '.EXE;.CMD;.BAT').split(';').filter(Boolean) : ['']
  const names = name === 'chrome' ? CHROME_NAMES : [name]
  for (const bare of names) {
    for (const dir of dirs) {
      for (const ext of exts) {
        const full = path.join(dir, bare + ext)
        if (existsSync(full)) return full
      }
    }
  }
  return null
}

function probeVersion(name: ToolName, file: string): string | null {
  if (name === 'chrome' && isWindows()) return null
  const result = spawnSync(file, VERSION_ARGS[name], { encoding: 'utf8', timeout: 5_000, windowsHide: true })
  if (result.error) return null
  const first = (text: string | undefined) =>
    (text ?? '')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean) ?? null
  return first(result.stdout) ?? first(result.stderr)
}

export function doctor(): DoctorReport {
  const tools = TOOLS.map((name): ToolStatus => {
    const override = envOverride(name)
    const found = override ? (existsSync(override.path) ? override.path : null) : resolvedPath(name)
    return {
      name,
      path: found,
      version: found ? probeVersion(name, found) : null,
      needed_for: NEEDED_FOR[name],
      install: installHint(name, process.platform),
      override,
    }
  })
  return { ok: tools.every((tool) => tool.path !== null), platform: process.platform, tools }
}

/** utf8, BOM stripped, CRLF/CR → LF. Use for every Markdown/YAML file under the library. */
export function readLibraryText(file: string): string {
  return readFileSync(file, 'utf8').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')
}
