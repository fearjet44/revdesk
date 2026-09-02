import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseSection, serializeSection } from '../src/schema/markdown.ts'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const files = [
  'data/manuals/gom/sections/000-identification.md',
  'data/manuals/gom/sections/010-administration.md',
  'data/manuals/gom/sections/100-section-a-management.md',
  'data/manuals/gom/sections/110-section-b-weight-and-balance.md',
  'fixtures/tiny-gom/manuals/gom/sections/243-operational-control.md',
]

let failed = 0
for (const rel of files) {
  const raw = readFileSync(path.join(root, rel), 'utf8')
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

if (failed) process.exit(1)
