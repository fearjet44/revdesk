import { stringify as stringifyYaml, parse as parseYaml } from 'yaml'

export type HeadingScheme = 'decimal' | 'nimbl'

export type DocTheme = {
  heading: {
    levels: number
    scheme: HeadingScheme
    persist: 'stable'
    restart: 'leaf'
    leaf_prefix: boolean
  }
  steps: {
    levels: number
    markers: string[]
  }
  callouts: {
    note: { ink: string }
    caution: { ink: string }
    warning: { ink: string }
  }
}

export type HeadingHit = { level: number; text: string }

const DEFAULT_MARKERS = ['1.', 'a.', '(1)', '(a)', '(i)']

export const DEFAULT_THEME: DocTheme = {
  heading: {
    levels: 5,
    scheme: 'decimal',
    persist: 'stable',
    restart: 'leaf',
    leaf_prefix: true,
  },
  steps: { levels: 5, markers: [...DEFAULT_MARKERS] },
  callouts: {
    note: { ink: '#3d7ea6' },
    caution: { ink: '#d4891a' },
    warning: { ink: '#c43c32' },
  },
}

export function themeFromHouseStyle(style: string): DocTheme {
  if (style === 'nimbl-word') {
    return {
      ...DEFAULT_THEME,
      heading: { ...DEFAULT_THEME.heading, scheme: 'nimbl' },
      steps: { ...DEFAULT_THEME.steps, markers: [...DEFAULT_THEME.steps.markers] },
      callouts: {
        note: { ...DEFAULT_THEME.callouts.note },
        caution: { ...DEFAULT_THEME.callouts.caution },
        warning: { ...DEFAULT_THEME.callouts.warning },
      },
    }
  }
  return structuredClone(DEFAULT_THEME)
}

export function parseTheme(raw: string): DocTheme {
  const data = (parseYaml(raw) ?? {}) as Record<string, unknown>
  const heading = asMap(data.heading)
  const steps = asMap(data.steps)
  const callouts = asMap(data.callouts)
  const markers = Array.isArray(steps.markers)
    ? steps.markers.map((item) => String(item)).filter(Boolean)
    : DEFAULT_THEME.steps.markers
  const scheme = heading.scheme === 'nimbl' ? 'nimbl' : 'decimal'
  return {
    heading: {
      levels: clampInt(heading.levels, 1, 5, 5),
      scheme,
      persist: 'stable',
      restart: 'leaf',
      leaf_prefix: heading.leaf_prefix !== false,
    },
    steps: {
      levels: clampInt(steps.levels, 1, 5, 5),
      markers: markers.length ? markers.slice(0, 5) : [...DEFAULT_MARKERS],
    },
    callouts: {
      note: { ink: inkOf(asMap(callouts.note).ink, DEFAULT_THEME.callouts.note.ink) },
      caution: { ink: inkOf(asMap(callouts.caution).ink, DEFAULT_THEME.callouts.caution.ink) },
      warning: { ink: inkOf(asMap(callouts.warning).ink, DEFAULT_THEME.callouts.warning.ink) },
    },
  }
}

export function stringifyTheme(theme: DocTheme): string {
  return stringifyYaml(
    {
      heading: theme.heading,
      steps: theme.steps,
      callouts: theme.callouts,
    },
    { lineWidth: 88 },
  )
}

export function leafNumberFromTitle(title: string, id?: string): string | null {
  const named = title.match(/^(?:Section|Appendix)\s+([A-Z]|\d+)\b/i)
  if (named) return named[1]
  if (id) {
    const tail = id.match(/-([A-Za-z]|\d+)$/)
    if (tail) return tail[1]
  }
  return null
}

export function parseHeadingParts(text: string, scheme: HeadingScheme): string[] | null {
  const trimmed = text.trim()
  const section = trimmed.match(/^Section\s+([A-Z]|\d+)\b/i)
  if (section) return [section[1]]
  const token = trimmed.match(/^([A-Z]|\d+(?:\.\d+)*)(?=\s|$)/)?.[1]
  if (!token) return null
  const parts = token.split('.')
  if (scheme === 'nimbl' && parts.length >= 2 && parts[parts.length - 1] === '0') {
    parts.pop()
  }
  return parts
}

export function formatHeadingStamp(theme: DocTheme, level: number, parts: string[]): string {
  if (theme.heading.scheme === 'nimbl' && level === 2) return `${parts.join('.')}.0`
  return parts.join('.')
}

export function headingAlreadyNumbered(text: string, scheme: HeadingScheme): boolean {
  return parseHeadingParts(text, scheme) != null
}

export function nextHeadingStamp(
  theme: DocTheme,
  before: HeadingHit[],
  level: number,
  leafNumber: string | null,
): string {
  const prefix = theme.heading.leaf_prefix && leafNumber ? [leafNumber] : []
  const parsed = before.map((hit) => ({
    level: hit.level,
    parts: parseHeadingParts(hit.text, theme.heading.scheme),
  }))
  const stack: Array<string[] | undefined> = []
  if (prefix.length) stack[1] = prefix
  for (const hit of parsed) {
    if (!hit.parts) continue
    stack[hit.level] = hit.parts
    stack.length = hit.level + 1
  }
  const parent = stack[level - 1] ?? prefix
  const wantLen = parent.length + 1
  let max = 0
  for (const hit of parsed) {
    if (!hit.parts || hit.parts.length !== wantLen) continue
    if (!startsWith(hit.parts, parent)) continue
    const last = Number(hit.parts[hit.parts.length - 1])
    if (Number.isFinite(last) && last > max) max = last
  }
  const parts = [...parent, String(max + 1)]
  return formatHeadingStamp(theme, level, parts)
}

export function paperCalloutStyle(theme: DocTheme): Record<string, string> {
  return {
    '--note': theme.callouts.note.ink,
    '--caution': theme.callouts.caution.ink,
    '--alert': theme.callouts.warning.ink,
  }
}

export function stepMarkerCss(markers: string[]): string {
  const chain = ['.paper-wrap .ProseMirror ol']
  const rules: string[] = []
  for (let i = 0; i < Math.min(markers.length, 5); i += 1) {
    if (i > 0) chain.push('ol')
    rules.push(`${chain.join(' ')} > li::before { content: ${cssContent(markers[i])}; }`)
  }
  return rules.join('\n')
}

function cssContent(marker: string): string {
  const wrapped = /^\((.+)\)$/.exec(marker.trim())
  const core = wrapped ? wrapped[1] : marker.trim().replace(/\.$/, '')
  const counter =
    core === 'a' ? 'counter(step, lower-alpha)' :
    core === 'A' ? 'counter(step, upper-alpha)' :
    core === 'i' ? 'counter(step, lower-roman)' :
    core === 'I' ? 'counter(step, upper-roman)' :
    'counter(step)'
  if (wrapped) return `"(" ${counter} ")"`
  if (marker.trim().endsWith('.')) return `${counter} "."`
  return counter
}

function asMap(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = Number(value)
  if (!Number.isInteger(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

function inkOf(value: unknown, fallback: string): string {
  const text = String(value ?? '').trim()
  return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(text) ? text : fallback
}

function startsWith(parts: string[], prefix: string[]): boolean {
  return prefix.every((item, index) => parts[index] === item)
}
