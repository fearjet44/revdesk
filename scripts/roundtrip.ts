import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseSection, serializeSection, withFrontmatter } from '../src/schema/markdown.ts'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')

function walkMd(dir: string): string[] {
  if (!dir) return []
  const out: string[] = []
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, name.name)
    if (name.isDirectory()) out.push(...walkMd(abs))
    else if (name.name.endsWith('.md')) out.push(abs)
  }
  return out
}

const files = [
  ...walkMd(path.join(root, 'data', 'manuals')),
  ...walkMd(path.join(root, 'fixtures', 'tiny-gom', 'manuals')),
].filter((abs) => abs.includes(`${path.sep}sections${path.sep}`))

let failed = 0
for (const abs of files.sort()) {
  const rel = path.relative(root, abs)
  const raw = readFileSync(abs, 'utf8')
  const { meta, doc } = parseSection(raw)
  const again = serializeSection(meta, doc)
  const { doc: doc2 } = parseSection(again)
  const a = JSON.stringify(doc)
  const b = JSON.stringify(doc2)
  if (a !== b) {
    failed += 1
    console.error(`ROUNDTRIP FAIL ${rel}`)
    console.error(again)
  } else {
    console.log(`ok ${rel} (${meta.id})`)
  }
}

const samples: Array<[string, string]> = [
  ['plain', 'Just text.\n'],
  ['bold italic', 'A **bold** and *italic* and ***both*** word.\n'],
  ['underline', 'See <u>defined term</u> here.\n'],
  ['underline bold', 'See <u>**PIC**</u> here.\n'],
  ['section pilcrow', 'Per § 91.3 the PIC (¶ 2) decides.\n'],
]
for (const [label, body] of samples) {
  const raw = withFrontmatter({ id: 'x', title: 't', rev_last_changed: 'R1' }, body)
  const { meta, doc } = parseSection(raw)
  const again = serializeSection(meta, doc)
  const { doc: doc2 } = parseSection(again)
  if (JSON.stringify(doc) !== JSON.stringify(doc2)) {
    failed += 1
    console.error(`ROUNDTRIP FAIL sample ${label}`)
    console.error(again)
  } else {
    console.log(`ok sample ${label}`)
  }
}

if (failed) process.exit(1)
