// T2.2: run the .docx import over the operator's local corpus and print counts only.
// Never prints titles, file names, or text: the corpus is real operator material.
// Corpus directory: REVDESK_CORPUS, else <repo>/corpus. Skips cleanly when there is none.
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse as parseYaml } from 'yaml'
import { applyIngest } from '../server/ingest.ts'
import { RepoError } from '../server/repo.ts'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const CORPUS = path.resolve(process.env.REVDESK_CORPUS || path.join(ROOT, 'corpus'))

function books(dir: string): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.docx') && !entry.name.startsWith('~$'))
    .map((entry) => path.join(entry.parentPath, entry.name))
    // The practice fixture's working folder holds scripts with real strings; it is not a book.
    .filter((file) => !file.split(path.sep).includes('foobar-gom-practice'))
    .sort()
}

const files = books(CORPUS)
if (!files.length) {
  console.log('SKIP no .docx books in the corpus (gitignored; set REVDESK_CORPUS)')
  process.exit(0)
}

const pct = (n: number) => `${(Math.floor(n * 1000) / 10).toFixed(1)}%`
const rows: string[][] = [
  ['book', 'leaves', 'managed', 'coverage', 'below gate', 'worst leaf', 'dropped lines (times)', 'repeated kept', 'flattened cells', 'figures', 'placeholders', 'gate',
    'LEP copied', 'held', 'rev guessed', 'unpaginated', 'start unknown', 'dup slots'],
]
let n = 0
for (const file of files) {
  n += 1
  const tag = `#${n} ${createHash('sha256').update(readFileSync(file)).digest('hex').slice(0, 8)}`
  const lib = mkdtempSync(path.join(tmpdir(), 'revdesk-corpus-'))
  try {
    const result = await applyIngest({ file, accept_gaps: true }, lib)
    const report = result.report
    if (!report) throw new Error('no report')
    const scored = report.leaves.filter((leaf) => leaf.coverage !== null)
    const below = scored.filter((leaf) => (leaf.coverage ?? 1) < report.gate.leaf).length
    const worst = scored.reduce((min, leaf) => Math.min(min, leaf.coverage ?? 1), 1)
    // T4.3: the page ledger. Slots are counted, never printed.
    const ledger = parseYaml(readFileSync(path.join(lib, 'manuals', result.id, 'ledger.yaml'), 'utf8')) as {
      leaves: Array<{ pages: Array<{ slot: string }> }>
    }
    const slots = ledger.leaves.flatMap((leaf) => leaf.pages.map((page) => page.slot))
    rows.push([
      tag,
      String(report.leaves.length + report.managed.length),
      String(report.managed.length),
      pct(report.coverage.overall),
      String(below),
      pct(worst),
      `${report.dropped_lines.length} (${report.dropped_lines.reduce((sum, row) => sum + row.count, 0)})`,
      String(report.repeated_lines.length),
      String(report.flattened_cells.count),
      String(report.figures.written),
      String(report.figures.placeholders.length),
      report.passed ? 'pass' : 'below',
      String(report.lep.copied),
      String(report.lep.held.length),
      String(report.lep.revision_guessed.length),
      String(report.pages.unpaginated.length),
      String(report.pages.start_unknown.length),
      String(slots.length - new Set(slots).size),
    ])
  } catch (error) {
    // Messages can name leaves, which come from titles: print the exit code only.
    const code = error instanceof RepoError ? error.status : 5
    rows.push([tag, '—', '—', '—', '—', '—', '—', '—', '—', '—', '—', `error exit ${code}`, '—', '—', '—', '—', '—', '—'])
  } finally {
    rmSync(lib, { recursive: true, force: true })
  }
}

const widths = rows[0].map((_, c) => Math.max(...rows.map((row) => row[c].length)))
for (const row of rows) console.log(row.map((cell, c) => cell.padEnd(widths[c])).join('  '))
