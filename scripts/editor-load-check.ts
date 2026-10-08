// Opens a working section that holds a figure and checks the editor is built once, with its manual.
// Not part of test:md. Playwright is not a repo dependency: install playwright-core somewhere else and
// point PLAYWRIGHT_CORE at its index.mjs.
//   REVDESK_DATA=<scratch>/data npx vite --port 5199 --strictPort
//   PLAYWRIGHT_CORE=/tmp/pw/node_modules/playwright-core/index.mjs \
//     node --experimental-strip-types scripts/editor-load-check.ts http://127.0.0.1:5199 CHG-2026-001 gom-a
// Run it only against a scratch library: it adds a figure to the section's working copy.
const [base = 'http://127.0.0.1:5199', changeId = 'CHG-2026-001', sectionId = 'gom-a'] = process.argv.slice(2)

const PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

let failed = 0
function check(label: string, ok: boolean, detail?: string) {
  if (ok) console.log(`ok ${label}`)
  else {
    failed += 1
    console.error(`FAIL ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, headers: { 'Content-Type': 'application/json' } })
  const data = (await response.json()) as T & { error?: string }
  if (!response.ok) throw new Error(`${url}: ${data.error ?? response.status}`)
  return data
}

const change = await json<{ manual: string }>(`${base}/api/changes/${changeId}`)
const manualId = change.manual
const up = await json<{ src: string }>(`${base}/api/manuals/${manualId}/figures`, {
  method: 'POST',
  body: JSON.stringify({ filename: 'dot.png', content: PNG_B64 }),
})
const file = await json<{ markdown: string }>(`${base}/api/changes/${changeId}/sections/${sectionId}`)
if (!file.markdown.includes(up.src)) {
  await json(`${base}/api/changes/${changeId}/sections/${sectionId}`, {
    method: 'PUT',
    body: JSON.stringify({
      markdown: `${file.markdown.trimEnd()}\n\n![Check figure](${up.src})\n`,
      mark: 'OS',
    }),
  })
}

const { chromium } = await import(process.env.PLAYWRIGHT_CORE ?? 'playwright-core')
const browser = await chromium.launch({ channel: 'chrome' })
const page = await browser.newPage()
const imageRequests: string[] = []
let workingFetches = 0
page.on('request', (request: { url(): string; method(): string }) => {
  const url = new URL(request.url())
  if (/\/figures\//.test(url.pathname)) imageRequests.push(url.pathname)
  if (request.method() === 'GET' && url.pathname === `/api/changes/${changeId}/sections/${sectionId}`) workingFetches += 1
})

await page.goto(`${base}/changes/${changeId}/sections/${sectionId}`)
await page.waitForSelector('.ProseMirror[contenteditable="true"] figure img')
await page.click('.ProseMirror p')
await page.keyboard.type('zzqq')
await page.waitForTimeout(1500)

const figureRequests = imageRequests.filter((item) => item.startsWith('/api/manuals/'))
check('first figure request has the manual id', figureRequests[0]?.startsWith(`/api/manuals/${manualId}/figures/`), figureRequests[0])
check('no request with an empty manual id', !imageRequests.some((item) => item.startsWith('/api/manuals//')), imageRequests.join(', '))
// The dev server runs React StrictMode, which runs each load effect twice, so one load shows as 2 here.
check('working copy fetched once per load', workingFetches >= 1 && workingFetches <= 2, String(workingFetches))
check('no "Figure missing" box', (await page.locator('.figure-missing:visible').count()) === 0)
check('typed text kept', (await page.locator('.ProseMirror').innerText()).includes('zzqq'))
const before = await page.locator('.ProseMirror figure img').count()
await page.setInputFiles('input[data-figure-insert]', {
  name: 'two.png',
  mimeType: 'image/png',
  buffer: Buffer.from(PNG_B64, 'base64'),
})
await page.waitForTimeout(1000)
check('Figure button still inserts', (await page.locator('.ProseMirror figure img').count()) === before + 1)
await browser.close()
process.exit(failed ? 1 : 0)
