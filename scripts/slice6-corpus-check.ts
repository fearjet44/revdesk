import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const cases: Array<[string, string]> = [
  ['gom-lep', 'Premier Air Charter GOM Revision 11.pdf'],
  ['tp', 'far-part-135-training-program.pdf'],
]

let fail = 0
for (const [id, file] of cases) {
  const expected = JSON.parse(
    readFileSync(path.join(root, 'fixtures', 'ingest', 'expected', `${id}.json`), 'utf8'),
  ) as {
    control_surface: string
    house_style: string
    kind_guess: string
    control_class_guess: string
    revision: { number: number }
    pagination_schemes: string[]
    must_include_sections: string[]
    section_count_min: number
    appendix_count_min: number
  }
  const result = spawnSync(
    process.execPath,
    ['--experimental-strip-types', path.join(root, 'cli', 'revdesk.ts'), '--json', 'ingest', 'classify', path.join(root, 'corpus', file)],
    { encoding: 'utf8' },
  )
  if (result.status !== 0) {
    console.log(`FAIL classify ${file} exit ${result.status}`)
    console.log(result.stdout)
    console.log(result.stderr)
    fail += 1
    continue
  }
  const got = JSON.parse(result.stdout) as {
    control_surface: string
    house_style: string
    kind_guess: string
    control_class_guess: string
    revision: { number: number }
    pagination: { regions: Array<{ scheme: string }> }
    sections: Array<{ kind: string; title: string }>
    theme_guess: { scheme: string; font: { body: string; heading: string } }
  }
  const check = (label: string, ok: boolean) => {
    if (ok) console.log(`OK  corpus ${id} ${label}`)
    else {
      console.log(`FAIL corpus ${id} ${label}`)
      fail += 1
    }
  }
  check(`surface=${expected.control_surface}`, got.control_surface === expected.control_surface)
  check(`style=${expected.house_style}`, got.house_style === expected.house_style)
  check(`kind=${expected.kind_guess}`, got.kind_guess === expected.kind_guess)
  check(`class=${expected.control_class_guess}`, got.control_class_guess === expected.control_class_guess)
  check(`rev=${expected.revision.number}`, got.revision?.number === expected.revision.number)
  const schemes = (got.pagination?.regions ?? []).map((row) => row.scheme)
  for (const scheme of expected.pagination_schemes) {
    check(`scheme ${scheme}`, schemes.includes(scheme))
  }
  const titles = (got.sections ?? []).map((row) => row.title)
  for (const title of expected.must_include_sections) {
    check(`section ${title}`, titles.some((row) => row.includes(title)))
  }
  const body = (got.sections ?? []).filter((row) => row.kind === 'section').length
  const apps = (got.sections ?? []).filter((row) => row.kind === 'appendix').length
  check(`section_count>=${expected.section_count_min}`, body >= expected.section_count_min)
  check(`appendix_count>=${expected.appendix_count_min}`, apps >= expected.appendix_count_min)
  check('theme font Verdana', got.theme_guess?.font?.body === 'Verdana')
}

process.exit(fail ? 1 : 0)
