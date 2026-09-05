import { execFileSync } from 'node:child_process'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { stringify as stringifyYaml } from 'yaml'
import { RepoError } from './repo.ts'
import {
  guessPaperFonts,
  parsePdfFontNames,
  stringifyTheme,
  themeFromHouseStyle,
} from './theme.ts'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const CATALOG_DIR = path.join(ROOT, 'fixtures', 'ingest', 'catalogs')

export type ControlSurface = 'lep' | 'les' | 'rev-only'
export type PageScheme =
  | 'roman-front'
  | 'letter-cover'
  | 'section-page'
  | 'chapter-page'
  | 'running'
  | 'none'
export type HouseStyle = 'nimbl-word' | 'unknown'
export type ControlClassGuess = 'faa-approved' | 'faa-accepted' | 'third-party' | 'internal'

export type PaginationRegion = {
  name: string
  scheme: PageScheme
  slots?: string[]
}

export type IngestSection = {
  kind: 'front' | 'section' | 'appendix'
  number: string | null
  title: string
  start: string | null
}

export type IngestClassification = {
  control_surface: ControlSurface
  control_class_guess: ControlClassGuess | null
  house_style: HouseStyle
  kind_guess: 'gom' | 'training-program' | 'unknown'
  pagination: {
    control_surface: ControlSurface
    lep_inferred: boolean
    regions: PaginationRegion[]
  }
  revision: { number: number | null; date: string | null; label: string | null }
  sections: IngestSection[]
  lep_slots: string[]
  signals: string[]
  theme_guess: {
    scheme: 'decimal' | 'nimbl'
    font: { body: string; heading: string }
    color: { paper: string; ink: string }
  }
  source: {
    filename: string
    pages: number | null
    creator: string | null
    producer: string | null
  }
}

export type CatalogHeading = {
  num: string
  title: string
  children?: CatalogHeading[]
}

export type CatalogLeaf = {
  kind: 'front' | 'section' | 'appendix'
  number: string | null
  title: string
  start: string
  headings: CatalogHeading[]
}

export type IngestCatalog = {
  id: string
  title: string
  abbrev: string
  kind_guess: string
  control_class: ControlClassGuess
  owner: string
  authority: string
  instrument_required: boolean
  current_issued: string
  next_revision: number
  effective: string
  revision: { number: number; date: string; label: string }
  house_style: HouseStyle
  pagination: {
    control_surface: ControlSurface
    lep_inferred: boolean
    regions: PaginationRegion[]
  }
  lep_slots: string[]
  source: {
    supplier: string
    template: string
    corpus_file?: string
    note: string
  }
  leaves: CatalogLeaf[]
}

export type ScaffoldResult = {
  id: string
  root: string
  sections: number
  files: string[]
}

const VALID_ROMAN = new Set(Array.from({ length: 40 }, (_, i) => toRoman(i + 1)))

const LOREM = [
  'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.',
  'Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.',
  'Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur.',
  'Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.',
  'Sed ut perspiciatis unde omnis iste natus error sit voluptatem accusantium doloremque laudantium.',
  'Nemo enim ipsam voluptatem quia voluptas sit aspernatur aut odit aut fugit, sed quia consequuntur magni dolores.',
  'Neque porro quisquam est, qui dolorem ipsum quia dolor sit amet, consectetur, adipisci velit.',
  'At vero eos et accusamus et iusto odio dignissimos ducimus qui blanditiis praesentium voluptatum deleniti atque.',
]

const PLACEHOLDER_SHA = '0000000000000000000000000000000000000000000000000000000000000000'
const INSTRUMENT_SHA = '1111111111111111111111111111111111111111111111111111111111111111'

export function catalogPath(id: string): string {
  return path.join(CATALOG_DIR, `${id}.json`)
}

export function loadCatalog(id: string): IngestCatalog {
  const file = catalogPath(id)
  if (!existsSync(file)) throw new RepoError(3, `Ingest catalog ${id} not found.`)
  return JSON.parse(readFileSync(file, 'utf8')) as IngestCatalog
}

export function listCatalogs(): string[] {
  if (!existsSync(CATALOG_DIR)) return []
  return ['gom-lep', 'tp'].filter((id) => existsSync(catalogPath(id)))
}

export function classifyPdf(file: string): IngestClassification {
  const abs = path.resolve(file)
  if (!existsSync(abs)) throw new RepoError(3, `Source ${file} not found.`)
  const text = pdfToText(abs)
  const info = pdfInfo(abs)
  return classifyFromText(
    text,
    {
      filename: path.basename(abs),
      pages: info.pages,
      creator: info.creator,
      producer: info.producer,
    },
    pdfFonts(abs),
  )
}

export function classifyFromText(
  text: string,
  source: IngestClassification['source'],
  pdfNames: string[] = [],
): IngestClassification {
  const signals: string[] = []
  const hasLep = hasHeading(text, 'List of Effective Pages')
  const hasLes = hasHeading(text, 'List of Effective Sections')
  const hasRor = hasHeading(text, 'Record of Revision')
  const hasToc = hasHeading(text, 'Table of Contents')
  const hasNimblHead = /\b1\.1\.0\b/.test(text)
  const hasSectionOne = /section\s+1:/i.test(text)
  const hasRevFooter = /revision\s+\d+\s+\d{2}-[A-Za-z]{3}-\d{4}/i.test(text)
  const pdfMaker = /PDFMaker/i.test(source.creator ?? '') || /PDFMaker/i.test(source.producer ?? '')

  if (hasLep) signals.push('lep-heading')
  if (hasLes) signals.push('les-heading')
  if (hasRor) signals.push('record-of-revision')
  if (hasToc) signals.push('toc')
  if (hasNimblHead) signals.push('n-n-0-heads')
  if (hasSectionOne) signals.push('section-n-titles')
  if (hasRevFooter) signals.push('revision-date-footer')
  if (pdfMaker) signals.push('word-pdfmaker')
  if (pdfNames.length) signals.push('fonts-from-pdf')

  let control_surface: ControlSurface = 'rev-only'
  if (hasLep) control_surface = 'lep'
  else if (hasLes) control_surface = 'les'

  const house_style: HouseStyle =
    hasLep && hasRor && hasNimblHead && hasSectionOne && hasRevFooter ? 'nimbl-word' : 'unknown'
  if (house_style === 'nimbl-word') signals.push('house-style:nimbl-word')

  const kind_guess = guessKind(text)
  const control_class_guess = guessClass(kind_guess, text)
  const revision = extractRevision(text)
  const lep_slots = hasLep ? extractLepSlots(text) : []
  const sections = extractSections(text)
  const regions = buildRegions(lep_slots, control_surface)

  return {
    control_surface,
    control_class_guess,
    house_style,
    kind_guess,
    pagination: {
      control_surface,
      lep_inferred: control_surface === 'lep' && lep_slots.length === 0,
      regions,
    },
    revision,
    sections,
    lep_slots,
    signals,
    theme_guess: guessTheme(house_style, pdfNames),
    source,
  }
}

function guessTheme(
  house_style: HouseStyle,
  pdfNames: string[],
): IngestClassification['theme_guess'] {
  const base = themeFromHouseStyle(house_style)
  const fromPdf = pdfNames.length > 0
  return {
    scheme: base.heading.scheme,
    font: fromPdf ? guessPaperFonts(pdfNames) : { ...base.font },
    color: fromPdf || house_style === 'nimbl-word' ? { paper: '#ffffff', ink: '#1c1a14' } : { ...base.color },
  }
}

export function scaffoldCatalog(id: string, dataRoot: string): ScaffoldResult {
  const catalog = loadCatalog(id)
  const files: string[] = []
  const manualDir = path.join(dataRoot, 'manuals', catalog.id)
  const sectionDir = path.join(manualDir, 'sections')
  mkdirSync(sectionDir, { recursive: true })

  writeFileSync(path.join(manualDir, 'manual.yaml'), dumpManualYaml(catalog))
  files.push(`manuals/${catalog.id}/manual.yaml`)
  const themePath = path.join(manualDir, 'theme.yaml')
  if (!existsSync(themePath)) {
    writeFileSync(themePath, stringifyTheme(themeFromHouseStyle(catalog.house_style)))
    files.push(`manuals/${catalog.id}/theme.yaml`)
  }

  const prefix = idPrefix(catalog.id)
  const revLabel = `R${catalog.revision.number}`
  catalog.leaves.forEach((leaf, index) => {
    const filename = leafFilename(index, leaf)
    const body = loremBody(leaf, catalog, index)
    const title = leafTitle(leaf)
    const markdown = [
      '---',
      `id: ${leafId(prefix, leaf)}`,
      `title: ${yamlPlain(title)}`,
      `rev_last_changed: ${revLabel}`,
      '---',
      '',
      body.replace(/\s*$/, '\n'),
    ].join('\n')
    writeFileSync(path.join(sectionDir, filename), markdown)
    files.push(`manuals/${catalog.id}/sections/${filename}`)
  })

  writeBaseline(dataRoot, catalog, files)
  return { id: catalog.id, root: dataRoot, sections: catalog.leaves.length, files }
}

export function formatClassification(report: IngestClassification): string {
  const lines = [
    `${report.source.filename}  ${report.control_surface}  ${report.house_style}`,
    `class ${report.control_class_guess ?? '—'}  kind ${report.kind_guess}`,
    `revision ${report.revision.label ?? '—'}  pages ${report.source.pages ?? '—'}`,
    `lep_slots ${report.lep_slots.length}  inferred ${report.pagination.lep_inferred}`,
    `regions ${report.pagination.regions.map((r) => r.scheme).join(', ') || '—'}`,
    `signals ${report.signals.join(', ') || '—'}`,
    `theme ${report.theme_guess.scheme}  ${report.theme_guess.font.body} / ${report.theme_guess.font.heading}  ${report.theme_guess.color.paper}`,
    '',
    'SECTIONS',
  ]
  for (const section of report.sections) {
    const num = (section.number ?? '—').padEnd(6)
    const start = (section.start ?? '—').padEnd(8)
    lines.push(`  ${section.kind.padEnd(8)}  ${num}  ${start}  ${section.title}`)
  }
  return lines.join('\n')
}

function guessKind(text: string): IngestClassification['kind_guess'] {
  const head = text.slice(0, 4000)
  if (/training program/i.test(head) || /training program/i.test(text.slice(0, 12000))) {
    if (/general operations manual|\bGOM\b/.test(head) && !/training program/i.test(head)) {
      return 'gom'
    }
    if (/training program/i.test(head)) return 'training-program'
  }
  if (/general operations manual|\bGOM\b/i.test(head)) return 'gom'
  if (/training program/i.test(text)) return 'training-program'
  return 'unknown'
}

function guessClass(
  kind: IngestClassification['kind_guess'],
  text: string,
): ControlClassGuess | null {
  if (/faa[\s-]*approved/i.test(text.slice(0, 8000)) && kind === 'training-program') return 'faa-approved'
  if (kind === 'training-program') return 'faa-approved'
  if (kind === 'gom') return 'faa-accepted'
  if (/faa[\s-]*accepted/i.test(text.slice(0, 8000))) return 'faa-accepted'
  return null
}

function extractRevision(text: string): IngestClassification['revision'] {
  const counts = new Map<number, number>()
  const dateFor = new Map<number, string>()
  const re = /Revision\s+(\d+)\s+(\d{2}-[A-Za-z]{3}-\d{4})/g
  for (const match of text.matchAll(re)) {
    const n = Number(match[1])
    counts.set(n, (counts.get(n) ?? 0) + 1)
    if (!dateFor.has(n)) dateFor.set(n, match[2])
  }
  if (counts.size === 0) {
    const ror = text.match(/Revision\s+(\d+)\s+(\d{2}-[A-Za-z]{3}-\d{4})/)
    if (!ror) return { number: null, date: null, label: null }
  }
  let best = 0
  let bestN = 0
  for (const [n, c] of counts) {
    if (c > best || (c === best && n > bestN)) {
      best = c
      bestN = n
    }
  }
  if (!bestN) return { number: null, date: null, label: null }
  const date = dateFor.get(bestN) ?? null
  return { number: bestN, date, label: `Revision ${bestN}` }
}

function extractLepSlots(text: string): string[] {
  const start = text.search(/list of effective pages/i)
  if (start === -1) return []
  let blob = text.slice(start, start + 30000)
  const stop = blob.slice(400).search(/\n\s*(table of contents|source of training)/i)
  if (stop >= 0) blob = blob.slice(0, stop + 400)
  const re =
    /\b([ivx]{1,8}|\d{1,2}-\d{1,2}|[A-Z]-\d{1,2})\s+Revision\s+\d+\s+\d{2}-[A-Za-z]{3}-\d{4}\b/gi
  const slots: string[] = []
  const seen = new Set<string>()
  for (const match of blob.matchAll(re)) {
    const raw = match[1]
    const slot = normalizeSlot(raw)
    if (!slot || seen.has(slot)) continue
    seen.add(slot)
    slots.push(slot)
  }
  return slots
}

function extractSections(text: string): IngestSection[] {
  const tocAt = text.search(/table of contents/i)
  if (tocAt === -1) return extractSectionsLoose(text)
  let blob = text.slice(tocAt)
  const body = blob.search(/\f[^\f]{0,200}Section\s+1:\s+(?!.*\.{3})/)
  if (body > 200) blob = blob.slice(0, body)
  const lines = joinWrapped(blob.split(/\r?\n/).map((line) => line.replace(/[ \t]+/g, ' ').trim()))
  const sections: IngestSection[] = []
  const seen = new Set<string>()
  for (const line of lines) {
    const front = line.match(
      /^(Record of Revision|List of Effective Pages|Table of Contents|Source of Training Document|Contract Training Partner.{0,80}?)\s*\.{2,}\s*([ivx]+)\s*$/i,
    )
    if (front) {
      const title = front[1].replace(/\.{2,}.*$/, '').trim()
      const key = `front:${title}`
      if (seen.has(key)) continue
      seen.add(key)
      sections.push({ kind: 'front', number: null, title, start: front[2].toLowerCase() })
      continue
    }
    const section = line.match(/^Section\s+(\d+):\s+(.+?)\s*\.{2,}\s*(\d+-\d+)\s*$/i)
    if (section) {
      const key = `section:${section[1]}`
      if (seen.has(key)) continue
      seen.add(key)
      sections.push({
        kind: 'section',
        number: section[1],
        title: section[2].trim(),
        start: section[3],
      })
      continue
    }
    const appendix = line.match(/^Appendix\s+([A-Z]):\s+(.+?)\s*\.{2,}\s*([A-Z]-\d+)\s*$/i)
    if (appendix) {
      const key = `appendix:${appendix[1]}`
      if (seen.has(key)) continue
      seen.add(key)
      sections.push({
        kind: 'appendix',
        number: appendix[1],
        title: appendix[2].trim(),
        start: appendix[3],
      })
    }
  }
  return sections.length ? sections : extractSectionsLoose(text)
}

function extractSectionsLoose(text: string): IngestSection[] {
  const sections: IngestSection[] = []
  const seen = new Set<string>()
  for (const match of text.matchAll(/Section\s+(\d+):\s+([^\n]+)/gi)) {
    const number = match[1]
    if (seen.has(number)) continue
    seen.add(number)
    const title = match[2].replace(/\.{2,}.*$/, '').replace(/\s+\d+-\d+\s*$/, '').trim()
    if (!title) continue
    sections.push({ kind: 'section', number, title, start: `${number}-1` })
  }
  for (const match of text.matchAll(/Appendix\s+([A-Z]):\s+([^\n]+)/gi)) {
    const number = match[1]
    const key = `A:${number}`
    if (seen.has(key)) continue
    seen.add(key)
    const title = match[2].replace(/\.{2,}.*$/, '').replace(/\s+[A-Z]-\d+\s*$/, '').trim()
    if (!title) continue
    sections.push({ kind: 'appendix', number, title, start: `${number}-1` })
  }
  return sections
}

function buildRegions(slots: string[], surface: ControlSurface): PaginationRegion[] {
  if (surface === 'rev-only') return [{ name: 'book', scheme: 'none' }]
  if (surface === 'les') return [{ name: 'body', scheme: 'none' }]
  const roman = slots.filter((s) => VALID_ROMAN.has(s))
  const chapter = slots.filter((s) => /^\d+-\d+$/.test(s))
  const letter = slots.filter((s) => /^[A-Z]-\d+$/.test(s))
  const regions: PaginationRegion[] = [{ name: 'cover', scheme: 'letter-cover' }]
  if (roman.length) regions.push({ name: 'front-matter', scheme: 'roman-front', slots: roman })
  if (chapter.length) regions.push({ name: 'body', scheme: 'chapter-page' })
  if (letter.length) regions.push({ name: 'appendix', scheme: 'section-page' })
  if (regions.length === 1 && slots.length) regions.push({ name: 'body', scheme: 'running' })
  return regions
}

function normalizeSlot(raw: string): string | null {
  const token = raw.toLowerCase()
  if (VALID_ROMAN.has(token)) return token
  if (/^\d{1,2}-\d{1,2}$/.test(raw)) {
    const [a, b] = raw.split('-').map(Number)
    if (a >= 1 && a <= 40 && b >= 1 && b <= 80) return raw
    return null
  }
  if (/^[A-Z]-\d{1,2}$/.test(raw)) return raw
  return null
}

function joinWrapped(lines: string[]): string[] {
  const out: string[] = []
  const tocEntry = /^(Section|Appendix|\d+\.\d|Record of|List of|Table of|Source of|Contract )/i
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]
    if (!line) continue
    if (!line.includes('...') && i + 1 < lines.length && lines[i + 1].includes('...')) {
      const next = lines[i + 1]
      if (!tocEntry.test(next)) {
        out.push(`${line} ${next}`)
        i += 1
        continue
      }
    }
    out.push(line)
  }
  return out
}

function hasHeading(text: string, title: string): boolean {
  const re = new RegExp(`(^|\\n)\\s*${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i')
  return re.test(text)
}

function pdfToText(file: string): string {
  try {
    return execFileSync('pdftotext', ['-layout', file, '-'], {
      encoding: 'utf8',
      maxBuffer: 20 * 1024 * 1024,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes('ENOENT')) throw new RepoError(5, 'pdftotext is required for ingest classify.')
    throw new RepoError(5, `pdftotext failed: ${msg}`)
  }
}

function pdfFonts(file: string): string[] {
  try {
    const raw = execFileSync('pdffonts', [file], {
      encoding: 'utf8',
      maxBuffer: 2 * 1024 * 1024,
    })
    return parsePdfFontNames(raw)
  } catch {
    return []
  }
}

function pdfInfo(file: string): { pages: number | null; creator: string | null; producer: string | null } {
  try {
    const raw = execFileSync('pdfinfo', [file], { encoding: 'utf8' })
    const pages = Number(raw.match(/^Pages:\s+(\d+)/m)?.[1] ?? '') || null
    const creator = raw.match(/^Creator:\s+(.+)$/m)?.[1]?.trim() ?? null
    const producer = raw.match(/^Producer:\s+(.+)$/m)?.[1]?.trim() ?? null
    return { pages, creator, producer }
  } catch {
    return { pages: null, creator: null, producer: null }
  }
}

function dumpManualYaml(catalog: IngestCatalog): string {
  return stringifyYaml(
    {
      id: catalog.id,
      title: catalog.title,
      abbrev: catalog.abbrev,
      control_class: catalog.control_class,
      owner: catalog.owner,
      authority: catalog.authority,
      instrument_required: catalog.instrument_required,
      current_issued: catalog.current_issued,
      next_revision: catalog.next_revision,
      effective: catalog.effective,
      pagination: catalog.pagination,
      lep_slots: catalog.lep_slots,
    },
    { lineWidth: 100 },
  )
}

function writeBaseline(dataRoot: string, catalog: IngestCatalog, files: string[]): void {
  const instrumentsDir = path.join(dataRoot, 'control', 'instruments')
  const issuesDir = path.join(dataRoot, 'control', 'issues')
  const artifactsDir = path.join(dataRoot, 'artifacts')
  mkdirSync(instrumentsDir, { recursive: true })
  mkdirSync(issuesDir, { recursive: true })
  mkdirSync(artifactsDir, { recursive: true })

  const instrumentRel = `control/instruments/${catalog.current_issued}-baseline.txt`
  const artifactRel = `artifacts/${catalog.current_issued}.pdf`
  writeFileSync(
    path.join(dataRoot, instrumentRel),
    `Sample baseline instrument for ${catalog.current_issued}. Lorem ipsum dolor sit amet.\n`,
  )
  files.push(instrumentRel)

  const placeholder = path.join(ROOT, 'data', 'artifacts', 'GOM-R13.pdf')
  const artifactAbs = path.join(dataRoot, artifactRel)
  if (existsSync(placeholder) && !existsSync(artifactAbs)) copyFileSync(placeholder, artifactAbs)
  else if (!existsSync(artifactAbs)) writeFileSync(artifactAbs, '')
  files.push(artifactRel)

  const prefix = idPrefix(catalog.id)
  const issue = {
    id: catalog.current_issued,
    kind: 'full',
    state: 'launched',
    manual: catalog.id,
    revision: catalog.revision.number,
    control_class: catalog.control_class,
    supersedes: null,
    change: 'CHG-BASELINE',
    effective: catalog.effective,
    instrument: {
      type: catalog.control_class === 'faa-approved' ? 'approval-letter' : 'acceptance-letter',
      authority: catalog.authority,
      file: instrumentRel,
      sha256: INSTRUMENT_SHA,
      dated: catalog.effective,
      reference: `Sample baseline for ${catalog.abbrev}`,
    },
    manual_artifact: { file: artifactRel, sha256: PLACEHOLDER_SHA },
    git_tag: `issued/${catalog.abbrev}/${catalog.revision.number}`,
    source_commit: null,
    git_skipped: true,
    incorporated_trs: [],
    launched_at: `${catalog.effective}T00:00:00.000Z`,
    summary: `Baseline launched revision for the sample ${catalog.abbrev}.`,
    sections: catalog.leaves.map((leaf) => ({
      id: leafId(prefix, leaf),
      title: leafTitle(leaf),
      rev_last_changed: `R${catalog.revision.number}`,
    })),
  }
  writeFileSync(path.join(issuesDir, `${catalog.current_issued}.yaml`), stringifyYaml(issue, { lineWidth: 100 }))
  files.push(`control/issues/${catalog.current_issued}.yaml`)
}

function loremBody(leaf: CatalogLeaf, catalog: IngestCatalog, index: number): string {
  const title = leafTitle(leaf)
  const lines: string[] = [`# ${headingLabel(leaf, title)}`, '', lorem(index), '']
  if (leaf.kind === 'front' && /record of revision/i.test(leaf.title)) {
    lines.push('## Recorded revisions', '')
    lines.push('| Revision | Effective | Summary |')
    lines.push('| --- | --- | --- |')
    lines.push(`| R${catalog.revision.number} | ${catalog.effective} | Lorem ipsum baseline for this sample library. |`)
    lines.push('')
    lines.push(lorem(index + 1))
    return lines.join('\n')
  }
  if (leaf.kind === 'front' && /list of effective pages/i.test(leaf.title)) {
    lines.push('The page ledger for this sample lives on `manual.yaml` (`pagination` + `lep_slots`).')
    lines.push('')
    lines.push('| Slot | Revision | Date |')
    lines.push('| --- | --- | --- |')
    for (const slot of catalog.lep_slots.slice(0, 8)) {
      lines.push(`| ${slot} | R${catalog.revision.number} | ${catalog.effective} |`)
    }
    lines.push('')
    lines.push(lorem(index + 2))
    return lines.join('\n')
  }
  if (leaf.kind === 'front' && /table of contents/i.test(leaf.title)) {
    lines.push('## Leaves', '')
    for (const item of catalog.leaves) {
      if (item.kind === 'front') continue
      lines.push(`- ${headingLabel(item, leafTitle(item))} — ${item.start}`)
    }
    lines.push('')
    return lines.join('\n')
  }

  const headings = leaf.headings ?? []
  headings.forEach((heading, hIndex) => {
    lines.push(`## ${heading.num} ${heading.title}`, '', lorem(index + hIndex + 3), '')
    if (hIndex === 1) {
      lines.push('1. Curabitur sodales ligula in libero. Sed dignissim lacinia nunc.')
      lines.push('2. Curabitur tortor. Pellentesque nibh. Aenean quam.')
      lines.push('3. In scelerisque sem at dolor. Maecenas mattis.')
      lines.push('')
    }
    if (hIndex === 2) {
      lines.push('| Item | Method | Allowance |')
      lines.push('| --- | --- | --- |')
      lines.push('| Alpha | Lorem ipsum | Nulla |')
      lines.push('| Beta | Dolor sit | Magna |')
      lines.push('| Gamma | Amet elit | Nisi |')
      lines.push('')
    }
    if (hIndex === 3) {
      lines.push(':::note')
      lines.push(lorem(index + 9))
      lines.push(':::')
      lines.push('')
    }
    if (hIndex === 4) {
      lines.push(':::caution')
      lines.push(lorem(index + 10))
      lines.push(':::')
      lines.push('')
    }
    for (const child of heading.children ?? []) {
      lines.push(`### ${child.num} ${child.title}`, '', lorem(index + hIndex + 11), '')
    }
  })

  if (headings.length === 0) {
    lines.push(lorem(index + 4), '')
    if (index % 4 === 0) {
      lines.push(':::warning')
      lines.push(lorem(index + 5))
      lines.push(':::')
      lines.push('')
    }
  }
  return lines.join('\n')
}

function lorem(n: number): string {
  return LOREM[Math.abs(n) % LOREM.length]
}

function leafTitle(leaf: CatalogLeaf): string {
  if (leaf.kind === 'section') return `Section ${leaf.number} — ${leaf.title}`
  if (leaf.kind === 'appendix') return `Appendix ${leaf.number} — ${leaf.title}`
  return leaf.title
}

function headingLabel(leaf: CatalogLeaf, title: string): string {
  if (leaf.kind === 'section') return `Section ${leaf.number}: ${leaf.title}`
  if (leaf.kind === 'appendix') return `Appendix ${leaf.number}: ${leaf.title}`
  return title
}

function leafId(prefix: string, leaf: CatalogLeaf): string {
  if (leaf.kind === 'section') return `${prefix}-${leaf.number}`
  if (leaf.kind === 'appendix') return `${prefix}-${String(leaf.number).toLowerCase()}`
  const map: Record<string, string> = {
    'Record of Revision': 'ror',
    'List of Effective Pages': 'lep',
    'Table of Contents': 'toc',
    'Source of Training Document': 'source',
    'Contract Training Partner – Training Center Information': 'ctp',
  }
  return `${prefix}-${map[leaf.title] ?? slug(leaf.title).slice(0, 24)}`
}

function leafFilename(index: number, leaf: CatalogLeaf): string {
  const n = String(index * 10).padStart(3, '0')
  if (leaf.kind === 'section') return `${n}-section-${String(leaf.number).padStart(2, '0')}-${slug(leaf.title)}.md`
  if (leaf.kind === 'appendix') return `${n}-appendix-${String(leaf.number).toLowerCase()}-${slug(leaf.title)}.md`
  return `${n}-${slug(leaf.title)}.md`
}

function idPrefix(manualId: string): string {
  if (manualId === 'gom-lep') return 'gomlep'
  return manualId
}

function slug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
}

function yamlPlain(value: string): string {
  if (/[:#{}[\],&*?]|^\s|\s$/.test(value)) return JSON.stringify(value)
  return value
}

function toRoman(n: number): string {
  const map: Array<[number, string]> = [
    [40, 'xl'],
    [10, 'x'],
    [9, 'ix'],
    [5, 'v'],
    [4, 'iv'],
    [1, 'i'],
  ]
  let out = ''
  let rest = n
  for (const [value, glyph] of map) {
    while (rest >= value) {
      out += glyph
      rest -= value
    }
  }
  return out
}
