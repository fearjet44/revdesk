// Drops files on the desk with synthetic DragEvents and checks where a figure lands and that nothing opens.
// A synthetic event does not reproduce a real Finder drag; the operator still checks that by hand.
// Not part of test:md. Playwright is not a repo dependency: install playwright-core somewhere else and
// point PLAYWRIGHT_CORE at its index.mjs.
//   REVDESK_DATA=<scratch>/data npx vite --port 5199 --strictPort
//   PLAYWRIGHT_CORE=/tmp/pw/node_modules/playwright-core/index.mjs \
//     node --experimental-strip-types scripts/figures-ui-check.ts http://127.0.0.1:5199 CHG-2026-001 gom-a
// Run it only against a scratch library: each drop uploads a figure to the manual (nothing is written to the section).
const [base = 'http://127.0.0.1:5199', changeId = 'CHG-2026-001', sectionId = 'gom-a'] = process.argv.slice(2)

const PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
const ONLY_IMAGES = 'Only images can be added as figures: PNG, JPEG, GIF, SVG, WebP.'

let failed = 0
function check(label: string, ok: boolean, detail?: string) {
  if (ok) console.log(`ok ${label}`)
  else {
    failed += 1
    console.error(`FAIL ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

const { chromium } = await import(process.env.PLAYWRIGHT_CORE ?? 'playwright-core')
const browser = await chromium.launch({ channel: 'chrome' })
const context = await browser.newContext({ viewport: { width: 1400, height: 2200 } })
const page = await context.newPage()
let navigations = 0
let popups = 0
page.on('framenavigated', () => (navigations += 1))
context.on('page', () => (popups += 1))

type Result = { prevented: boolean; effect: string }

const url = (view: string) => `${base}/changes/${changeId}/sections/${sectionId}?view=${view}`

async function open(view = 'print') {
  await page.goto(url(view))
  await page.waitForSelector(view === 'print' ? '.ProseMirror[contenteditable="true"] p' : '.page-head')
  navigations = 0
}

/** Fire one synthetic drag event. `target` is a CSS selector (centre of the nth match) or absolute x/y resolved by elementFromPoint. */
async function fire(type: string, where: { selector: string; nth?: number } | { x: number; y: number }, kind: 'png' | 'pdf' | 'text'): Promise<Result> {
  return page.evaluate(
    ({ type, where, kind, b64 }) => {
      let el: Element | null
      let x: number
      let y: number
      if ('selector' in where) {
        el = document.querySelectorAll(where.selector)[where.nth ?? 0]
        const box = el.getBoundingClientRect()
        x = box.left + box.width / 2
        y = box.top + box.height / 2
      } else {
        x = where.x
        y = where.y
        el = document.elementFromPoint(x, y)
      }
      const dt = new DataTransfer()
      if (kind === 'png') dt.items.add(new File([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], 'dot.png', { type: 'image/png' }))
      if (kind === 'pdf') dt.items.add(new File(['%PDF-1.4'], 'manual.pdf', { type: 'application/pdf' }))
      if (kind === 'text') dt.setData('text/plain', 'moving words')
      dt.dropEffect = 'copy'
      const event = new DragEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, dataTransfer: dt })
      el!.dispatchEvent(event)
      return { prevented: event.defaultPrevented, effect: dt.dropEffect }
    },
    { type, where, kind, b64: PNG_B64 },
  )
}

const blocks = () =>
  page.evaluate(() =>
    Array.from(document.querySelector('.ProseMirror')!.children).map((child) =>
      child.matches('figure') ? 'FIGURE' : `${child.tagName}:${(child.textContent ?? '').slice(0, 24)}`,
    ),
  )
const figureCount = () => page.locator('.ProseMirror figure img').count()

async function dropAndWait(where: Parameters<typeof fire>[1]) {
  const before = await figureCount()
  await fire('dragover', where, 'png')
  const result = await fire('drop', where, 'png')
  for (let i = 0; i < 40 && (await figureCount()) === before; i += 1) await page.waitForTimeout(100)
  return { result, added: (await figureCount()) - before, after: await blocks() }
}

async function geometry() {
  return page.evaluate(() => {
    const pm = document.querySelector('.ProseMirror')!.getBoundingClientRect()
    const paper = document.querySelector('.paper-wrap')!.getBoundingClientRect()
    const paras = Array.from(document.querySelectorAll('.ProseMirror > p')).map((p) => p.getBoundingClientRect())
    return { pm: { left: pm.left, right: pm.right, top: pm.top, bottom: pm.bottom }, paper: { left: paper.left, right: paper.right, bottom: paper.bottom }, paras: paras.map((r) => ({ top: r.top, bottom: r.bottom })) }
  })
}

// Gutter beside a paragraph
await open()
{
  const names = await blocks()
  const geo = await geometry()
  const index = names.findIndex((name, i) => i > 0 && name.startsWith('P:') && name.length > 6)
  const p = geo.paras[names.slice(0, index).filter((n) => n.startsWith('P:')).length]
  const y = (p.top + p.bottom) / 2
  const x = (geo.paper.left + geo.pm.left) / 2
  const hit = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.className, { x, y })
  const { added, after, result } = await dropAndWait({ x, y })
  check('gutter drop: target is outside the text', !String(hit).includes('ProseMirror'), String(hit))
  check('gutter drop inserts one figure', added === 1, `added ${added}`)
  check('gutter drop lands at that paragraph', after[index] === 'FIGURE' && after[index + 1] === names[index], `${names.join(' | ')} => ${after.join(' | ')}`)
  check('gutter drop prevented the browser default', result.prevented)
}

// Margin below the text
await open()
{
  const names = await blocks()
  const geo = await geometry()
  const x = geo.pm.right + (geo.paper.right - geo.pm.right) / 2
  const y = Math.min(geo.pm.bottom + 12, geo.paper.bottom - 4)
  const { added, after } = await dropAndWait({ x, y })
  check('bottom margin drop inserts one figure', added === 1, `added ${added}`)
  check('bottom margin drop lands at the end', after.slice(0, names.length).join() === names.join() && after.indexOf('FIGURE') === names.length, `${names.join(' | ')} => ${after.join(' | ')}`)
}

// Title field
await open()
{
  const names = await blocks()
  const title = await page.inputValue('input.title-field')
  const { added, after } = await dropAndWait({ selector: 'input.title-field' })
  check('title drop inserts one figure', added === 1, `added ${added}`)
  check('title drop lands at the top of the body', after.indexOf('FIGURE') === 0, `${names.join(' | ')} => ${after.join(' | ')}`)
  check('title unchanged', (await page.inputValue('input.title-field')) === title)
}

// Text
await open()
{
  const names = await blocks()
  const index = names.findIndex((name) => name.startsWith('P:') && name.length > 6)
  const { added, after } = await dropAndWait({ selector: '.ProseMirror > *', nth: index })
  check('text drop inserts one figure', added === 1, `added ${added}`)
  check('text drop lands in that block', after.indexOf('FIGURE') >= index - 0 && after.indexOf('FIGURE') <= index + 1, `${names.join(' | ')} => ${after.join(' | ')}`)
}

// PDF on the paper and on the text
await open()
{
  const before = await figureCount()
  const geo = await geometry()
  const where = { x: (geo.paper.left + geo.pm.left) / 2, y: geo.pm.top + 20 }
  const result = await fire('drop', where, 'pdf')
  await page.waitForTimeout(300)
  check('PDF on the paper: banner shows the message', (await page.locator('.banner.error').innerText().catch(() => '')) === ONLY_IMAGES)
  check('PDF on the paper: nothing inserted', (await figureCount()) === before)
  check('PDF on the paper: default prevented', result.prevented)
  await open()
  await fire('drop', { selector: '.ProseMirror p' }, 'pdf')
  await page.waitForTimeout(300)
  check('PDF on the text: banner shows the message', (await page.locator('.banner.error').innerText().catch(() => '')) === ONLY_IMAGES)
  check('PDF on the text: nothing inserted', (await figureCount()) === before)
}

// Drop highlight
await open()
{
  const hasClass = () => page.evaluate(() => document.querySelector('.paper-wrap')!.classList.contains('is-file-over'))
  await fire('dragenter', { selector: '.paper-wrap' }, 'png')
  await fire('dragenter', { selector: '.title-field' }, 'png')
  await fire('dragleave', { selector: '.paper-wrap' }, 'png')
  check('highlight stays when the pointer moves onto a child', await hasClass())
  await fire('dragleave', { selector: '.title-field' }, 'png')
  check('highlight clears on leaving the paper', !(await hasClass()))
  await fire('dragenter', { selector: '.paper-wrap' }, 'png')
  await fire('drop', { selector: '.paper-wrap' }, 'pdf')
  check('highlight clears on drop', !(await hasClass()))
}

// Guard on the PRINT view
await open()
for (const selector of ['.toolbar', '.rail', '.mast', '.page-head', '.write-dock']) {
  const over = await fire('dragover', { selector }, 'png')
  check(`PRINT dragover on ${selector}: prevented, dropEffect none`, over.prevented && over.effect === 'none', JSON.stringify(over))
  const drop = await fire('drop', { selector }, 'png')
  check(`PRINT drop on ${selector}: prevented`, drop.prevented)
}
check('no navigation and no new window after PRINT drops', navigations === 0 && popups === 0, `${navigations} navigations, ${popups} windows`)

// Drags with no Files are left alone
for (const selector of ['.toolbar', '.rail', '.paper-wrap']) {
  const over = await fire('dragover', { selector }, 'text')
  const drop = await fire('drop', { selector }, 'text')
  check(`text-only drag on ${selector} is left alone`, !over.prevented && !drop.prevented, JSON.stringify({ over, drop }))
}

// REVIEW view
await open('review')
for (const selector of ['.mast', '.rail', '.page-head', 'body']) {
  const over = await fire('dragover', { selector }, 'png')
  check(`REVIEW dragover on ${selector}: prevented, dropEffect none`, over.prevented && over.effect === 'none', JSON.stringify(over))
  const drop = await fire('drop', { selector }, 'png')
  check(`REVIEW drop on ${selector}: prevented`, drop.prevented)
}
check('no navigation and no new window after REVIEW drops', navigations === 0 && popups === 0, `${navigations} navigations, ${popups} windows`)

// Figure button
await open()
{
  const before = await figureCount()
  await page.setInputFiles('input[data-figure-insert]', { name: 'two.png', mimeType: 'image/png', buffer: Buffer.from(PNG_B64, 'base64') })
  for (let i = 0; i < 40 && (await figureCount()) === before; i += 1) await page.waitForTimeout(100)
  check('Figure button still inserts', (await figureCount()) === before + 1)
}

await browser.close()
process.exit(failed ? 1 : 0)
