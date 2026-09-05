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
  font: {
    body: string
    heading: string
  }
  color: {
    paper: string
    ink: string
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
  font: { body: 'IBM Plex Sans', heading: 'IBM Plex Sans Condensed' },
  color: { paper: '#f3eee2', ink: '#1c1a14' },
  callouts: {
    note: { ink: '#3d7ea6' },
    caution: { ink: '#d4891a' },
    warning: { ink: '#c43c32' },
  },
}

/** Nimbl Word/PDFMaker books in the corpus are Verdana on white, not Times. */
const NIMBL_FONT = { body: 'Verdana', heading: 'Verdana' }
const PRINT_COLOR = { paper: '#ffffff', ink: '#1c1a14' }

const SKIP_FONTS = /^(symbol|zapfdingbats|wingdings|webdings|marlett|mt-extra|barcode|ocr)/i

const FAMILY_ALIASES: Record<string, string> = {
  timesnewromanpsmt: 'Times New Roman',
  timesnewroman: 'Times New Roman',
  times: 'Times New Roman',
  arialmt: 'Arial',
  arial: 'Arial',
  verdana: 'Verdana',
  calibri: 'Calibri',
  cambria: 'Cambria',
  georgia: 'Georgia',
  tahoma: 'Tahoma',
  trebuchetms: 'Trebuchet MS',
  helvetica: 'Helvetica',
  helveticaneue: 'Helvetica',
  palatino: 'Palatino',
  palatinolinotype: 'Palatino',
  garamond: 'Garamond',
  couriernew: 'Courier New',
  courier: 'Courier New',
  ibmplexsans: 'IBM Plex Sans',
  ibmplexsanscondensed: 'IBM Plex Sans Condensed',
}

const OPEN_FALLBACKS: Record<string, string[]> = {
  'Times New Roman': ['Liberation Serif', 'Tinos', 'Times'],
  Arial: ['Liberation Sans', 'Arimo', 'Helvetica'],
  Verdana: ['DejaVu Sans', 'Liberation Sans'],
  Calibri: ['Carlito', 'Liberation Sans'],
  Cambria: ['Caladea', 'Liberation Serif'],
  Georgia: ['Liberation Serif', 'Nimbus Roman'],
  Tahoma: ['DejaVu Sans', 'Liberation Sans'],
  'Trebuchet MS': ['Liberation Sans', 'DejaVu Sans'],
  Helvetica: ['Nimbus Sans', 'Liberation Sans', 'Arial'],
  Palatino: ['TeX Gyre Pagella', 'Liberation Serif'],
  Garamond: ['EB Garamond', 'Liberation Serif'],
  'IBM Plex Sans': ['Segoe UI'],
  'IBM Plex Sans Condensed': ['IBM Plex Sans', 'Segoe UI'],
}

const SERIF = new Set([
  'Times New Roman',
  'Georgia',
  'Cambria',
  'Palatino',
  'Garamond',
  'Liberation Serif',
])

const HEADING_SANS = new Set(['Arial', 'Calibri', 'Helvetica', 'Tahoma', 'Trebuchet MS'])

export function themeFromHouseStyle(style: string): DocTheme {
  const theme = structuredClone(DEFAULT_THEME)
  if (style === 'nimbl-word') {
    theme.heading.scheme = 'nimbl'
    theme.font = { ...NIMBL_FONT }
    theme.color = { ...PRINT_COLOR }
  }
  return theme
}

export function parseTheme(raw: string): DocTheme {
  const data = (parseYaml(raw) ?? {}) as Record<string, unknown>
  const heading = asMap(data.heading)
  const steps = asMap(data.steps)
  const font = asMap(data.font)
  const color = asMap(data.color)
  const callouts = asMap(data.callouts)
  const markers = Array.isArray(steps.markers)
    ? steps.markers.map((item) => String(item)).filter(Boolean)
    : DEFAULT_THEME.steps.markers
  const scheme = heading.scheme === 'nimbl' ? 'nimbl' : 'decimal'
  const body = fontName(font.body, DEFAULT_THEME.font.body)
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
    font: {
      body,
      heading: fontName(font.heading, body),
    },
    color: {
      paper: inkOf(color.paper, DEFAULT_THEME.color.paper),
      ink: inkOf(color.ink, DEFAULT_THEME.color.ink),
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
      font: theme.font,
      color: theme.color,
      callouts: theme.callouts,
    },
    { lineWidth: 88 },
  )
}

export function parsePdfFontNames(raw: string): string[] {
  const names: string[] = []
  let started = false
  for (const line of raw.split('\n')) {
    if (/^-{10,}/.test(line)) {
      started = true
      continue
    }
    if (!started) continue
    const name = line.trim().split(/\s+/)[0]
    if (name) names.push(name)
  }
  return names
}

export function canonicalFontName(raw: string): string | null {
  let name = raw.trim().replace(/^[A-Z]{6}\+/, '')
  if (!name || SKIP_FONTS.test(name)) return null
  let key = name.replace(/[-_]/g, '')
  const style = /(bolditalic|boldoblique|italic|oblique|bold|regular|medium|light|black|condensed)$/i
  const cut = /(psmt|ps|mt)$/i
  for (let i = 0; i < 4; i += 1) {
    const next = key.replace(style, '').replace(cut, '')
    if (next === key) break
    key = next
  }
  key = key.toLowerCase()
  if (!key || SKIP_FONTS.test(key)) return null
  if (FAMILY_ALIASES[key]) return FAMILY_ALIASES[key]
  const spaced = name
    .replace(/[-_](BoldItalic|BoldOblique|Italic|Oblique|Bold|Regular|Medium|Light|Black|Condensed)$/i, '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return spaced || null
}

export function guessPaperFonts(pdfNames: string[]): { body: string; heading: string } {
  const votes = new Map<string, number>()
  for (const raw of pdfNames) {
    const family = canonicalFontName(raw)
    if (!family || family === 'Courier New') continue
    votes.set(family, (votes.get(family) ?? 0) + 1)
  }
  const ranked = [...votes.entries()].sort((a, b) => b[1] - a[1])
  if (!ranked.length) return { ...DEFAULT_THEME.font }
  const body = ranked[0][0]
  if (SERIF.has(body)) {
    const sans = ranked.find(([name]) => HEADING_SANS.has(name))
    if (sans) return { body, heading: sans[0] }
  }
  return { body, heading: body }
}

export function fontStack(name: string): string {
  const extras = OPEN_FALLBACKS[name] ?? []
  const generic = SERIF.has(name) ? 'serif' : 'sans-serif'
  const seen = new Set<string>()
  const parts: string[] = []
  for (const face of [name, ...extras]) {
    if (seen.has(face)) continue
    seen.add(face)
    parts.push(cssQuote(face))
  }
  parts.push(generic)
  return parts.join(', ')
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
  void scheme
  return token.split('.')
}

export function formatHeadingStamp(theme: DocTheme, level: number, parts: string[]): string {
  if (theme.heading.scheme === 'nimbl' && level === 1 && parts.length === 1) {
    return `Section ${parts[0]}`
  }
  return parts.join('.')
}

export function headingAlreadyNumbered(text: string, scheme: HeadingScheme): boolean {
  return parseHeadingParts(text, scheme) != null
}

/** Leading stamp (`5.7.0 Title`, `Section 5: Title`). */
export function splitHeadingText(
  text: string,
  scheme: HeadingScheme,
): { stamp: string | null; title: string } {
  const trimmed = text.trim()
  if (!trimmed) return { stamp: null, title: '' }
  const section = trimmed.match(/^Section\s+([A-Z]|\d+):?\s*(.*)$/i)
  if (section) {
    return { stamp: formatHeadingStamp({ heading: { scheme } } as DocTheme, 1, [section[1]]), title: section[2].trim() }
  }
  const match = trimmed.match(/^(\d+(?:\.\d+)*)(?:\s+|$)(.*)$/)
  if (!match) return { stamp: null, title: text }
  if (parseHeadingParts(match[1], scheme) == null) return { stamp: null, title: text }
  return { stamp: match[1], title: match[2].trim() }
}

export function replaceHeadingStamp(text: string, scheme: HeadingScheme, stamp: string): string {
  const { title } = splitHeadingText(text, scheme)
  return title ? `${stamp} ${title}` : `${stamp} `
}

/**
 * Nimbl: H1 `5`, H2 `5.7.0` / `5.7.1` / `5.7.2`, H3 `5.7.1.1`, H4 `5.7.1.1.1`.
 * Decimal: H1 `5`, H2 `5.8`, H3 `5.7.2`, H4 `5.7.1.1`.
 */
export function headingStampLength(
  theme: DocTheme,
  level: number,
  leafNumber: string | null,
): number {
  if (theme.heading.scheme === 'nimbl') {
    if (level <= 1) return 1
    return level + 1
  }
  const prefix = theme.heading.leaf_prefix && leafNumber ? 1 : 0
  return prefix + Math.max(0, level - 1)
}

/** Deeper on an H3+ line: `5.7.2` → H4 → `5.7.2.1`. Not the previous H3’s child. */
export function reshapeHeadingStamp(
  theme: DocTheme,
  text: string,
  level: number,
  leafNumber: string | null,
): string | null {
  const parts = parseHeadingParts(text, theme.heading.scheme)
  if (!parts?.length) return null
  const want = headingStampLength(theme, level, leafNumber)
  if (want < 1) return null
  const next = parts.slice(0, want)
  while (next.length < want) next.push('1')
  return formatHeadingStamp(theme, level, next)
}

export function nextHeadingStamp(
  theme: DocTheme,
  before: HeadingHit[],
  level: number,
  leafNumber: string | null,
): string {
  const prefix = theme.heading.leaf_prefix && leafNumber ? [leafNumber] : []
  const parsed = before
    .map((hit) => parseHeadingParts(hit.text, theme.heading.scheme))
    .filter((parts): parts is string[] => Boolean(parts?.length))
  const want = headingStampLength(theme, level, leafNumber)
  if (want <= 1) return formatHeadingStamp(theme, level, prefix.length ? prefix : ['1'])
  const parentLen = want - 1
  let parent = prefix.slice()
  if (parsed.length) parent = parsed[parsed.length - 1].slice(0, parentLen)
  while (parent.length < parentLen) parent.push('1')
  const first = theme.heading.scheme === 'nimbl' && want === 3 ? 0 : 1
  let max = first - 1
  for (const parts of parsed) {
    if (parts.length !== want) continue
    if (!startsWith(parts, parent)) continue
    const last = Number(parts[parts.length - 1])
    if (Number.isFinite(last) && last > max) max = last
  }
  return formatHeadingStamp(theme, level, [...parent, String(max + 1)])
}

export function paperCalloutStyle(theme: DocTheme): Record<string, string> {
  return {
    '--note': theme.callouts.note.ink,
    '--caution': theme.callouts.caution.ink,
    '--alert': theme.callouts.warning.ink,
    '--paper': theme.color.paper,
    '--paper-ink': theme.color.ink,
    '--paper-rule': ruleFor(theme.color.paper),
    '--paper-stripe': stripeFor(theme.color.paper),
    '--paper-edge': edgeFor(theme.color.paper),
    '--paper-body': fontStack(theme.font.body),
    '--paper-heading': fontStack(theme.font.heading),
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

function fontName(value: unknown, fallback: string): string {
  const text = String(value ?? '').replace(/[\n\r]/g, ' ').trim()
  if (!text || text.length > 80) return fallback
  return text
}

function cssQuote(name: string): string {
  if (/^[a-zA-Z][-a-zA-Z0-9]*$/.test(name)) return name
  return `"${name.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

function stripeFor(paper: string): string {
  if (paper.toLowerCase() === DEFAULT_THEME.color.paper) return '#efe8d7'
  return mixHex(paper, '#000000', 0.08)
}

function ruleFor(paper: string): string {
  if (paper.toLowerCase() === DEFAULT_THEME.color.paper) return '#d7d0bf'
  return mixHex(paper, '#000000', 0.14)
}

function edgeFor(paper: string): string {
  if (paper.toLowerCase() === DEFAULT_THEME.color.paper) return '#b9b19e'
  return mixHex(paper, '#000000', 0.22)
}

function mixHex(a: string, b: string, t: number): string {
  const pa = hexRgb(a)
  const pb = hexRgb(b)
  if (!pa || !pb) return a
  const ch = (i: number) => Math.round(pa[i] + (pb[i] - pa[i]) * t)
  return `#${[ch(0), ch(1), ch(2)].map((n) => n.toString(16).padStart(2, '0')).join('')}`
}

function hexRgb(hex: string): [number, number, number] | null {
  const text = hex.replace('#', '')
  const full = text.length === 3 ? text.split('').map((c) => c + c).join('') : text
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return null
  const n = Number.parseInt(full, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function startsWith(parts: string[], prefix: string[]): boolean {
  return prefix.every((item, index) => parts[index] === item)
}
