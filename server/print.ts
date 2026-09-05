import { execFile } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { parseSection, type JSONContent } from '../src/schema/markdown.ts'
import { paperCalloutStyle, stepMarkerCss, type DocTheme } from './theme.ts'
import { RepoError } from './repo.ts'
import type { ManualRecord, SectionFile } from './types.ts'

const execFileAsync = promisify(execFile)

export type PdfKind = 'reference' | 'regulator'

export type IssuedBook = {
  manual: ManualRecord
  theme: DocTheme
  files: SectionFile[]
}

export type RenderedPdf = {
  bytes: Buffer
  filename: string
  watermark: string | null
}

/** Header stamp on every downloaded / viewed PDF except the regulator copy. */
export function referenceWatermark(at: Date): string {
  const y = at.getUTCFullYear()
  const mo = String(at.getUTCMonth() + 1).padStart(2, '0')
  const d = String(at.getUTCDate()).padStart(2, '0')
  const hh = String(at.getUTCHours()).padStart(2, '0')
  const mm = String(at.getUTCMinutes()).padStart(2, '0')
  return `Reference Only - This is not a controlled copy - Downloaded: ${y}-${mo}-${d} ${hh}:${mm} UTC`
}

export function pdfFilename(manual: ManualRecord, kind: PdfKind): string {
  const rev = manual.current_issued ?? `${manual.abbrev}-draft`
  return kind === 'regulator' ? `${rev}.pdf` : `${rev}-reference.pdf`
}

export function buildManualHtml(
  book: IssuedBook,
  opts: { kind: PdfKind; downloadedAt?: Date },
): { html: string; watermark: string | null } {
  const at = opts.downloadedAt ?? new Date()
  const watermark = opts.kind === 'reference' ? referenceWatermark(at) : null
  const vars = paperCalloutStyle(book.theme)
  const varBlock = Object.entries(vars)
    .map(([key, value]) => `  ${key}: ${value};`)
    .join('\n')
  const sections = book.files
    .map((file) => {
      const parsed = parseSection(file.markdown)
      return `<article class="leaf">
  <h1 class="leaf-title">${escapeHtml(parsed.meta.title)}</h1>
  <p class="leaf-meta">${escapeHtml(parsed.meta.id)} · rev last changed ${escapeHtml(parsed.meta.rev_last_changed)}</p>
  ${renderNode(parsed.doc)}
</article>`
    })
    .join('\n')
  const issued = book.manual.current_issued ?? '(never launched)'
  const stampMeta = watermark
    ? `<meta name="revdesk-watermark" content="${escapeHtml(watermark)}">`
    : ''
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escapeHtml(book.manual.abbrev)} ${escapeHtml(issued)}</title>
${stampMeta}
<style>
:root {
${varBlock}
}
@page {
  size: letter;
  margin: ${opts.kind === 'reference' ? '0.95in 0.7in 0.7in 0.7in' : '0.7in'};
}
html, body {
  margin: 0;
  background: var(--paper);
  color: var(--paper-ink);
  font-family: var(--paper-body);
  font-size: 11pt;
  line-height: 1.45;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}
.cover {
  margin-bottom: 28pt;
}
.cover .kicker {
  margin: 0 0 8pt;
  font-family: ui-monospace, "IBM Plex Mono", monospace;
  font-size: 9pt;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: #5c574c;
}
.cover h1 {
  margin: 0 0 8pt;
  font-family: var(--paper-heading);
  font-size: 22pt;
  font-weight: 600;
}
.cover .lede {
  margin: 0;
  color: #5c574c;
  font-size: 10pt;
}
.leaf {
  break-before: page;
}
.leaf:first-of-type { break-before: auto; }
.leaf-title {
  margin: 0 0 6pt;
  padding-bottom: 6pt;
  border-bottom: 0.6pt solid var(--paper-rule);
  font-family: var(--paper-heading);
  font-size: 16pt;
  font-weight: 600;
}
.leaf-meta {
  margin: 0 0 14pt;
  font-family: ui-monospace, "IBM Plex Mono", monospace;
  font-size: 8.5pt;
  color: #5c574c;
}
.ProseMirror h1,
.ProseMirror h2,
.ProseMirror h3,
.ProseMirror h4,
.ProseMirror h5 {
  font-family: var(--paper-heading);
  letter-spacing: 0.02em;
  margin: 1.1em 0 0.4em;
  break-after: avoid;
}
.ProseMirror h1 { font-size: 16pt; }
.ProseMirror h2 { font-size: 13pt; }
.ProseMirror h3 { font-size: 11.5pt; }
.ProseMirror h4 { font-size: 11pt; }
.ProseMirror h5 { font-size: 10pt; }
.ProseMirror p { margin: 0 0 0.8em; }
.ProseMirror u { text-decoration: underline; text-underline-offset: 2px; }
.ProseMirror ol {
  list-style: none;
  margin: 0 0 1em;
  padding-left: 1.85em;
  counter-reset: step;
}
.ProseMirror ol ol { margin: 0.15em 0 0.35em; }
.ProseMirror li { position: relative; margin: 0.25em 0; counter-increment: step; }
.ProseMirror li > p { margin: 0 0 0.35em; }
.ProseMirror li > p:last-child { margin-bottom: 0; }
.ProseMirror ol > li::before {
  content: counter(step) ".";
  position: absolute;
  left: -1.85em;
  width: 1.7em;
  text-align: right;
  white-space: nowrap;
}
.ProseMirror table {
  border-collapse: collapse;
  width: 100%;
  margin: 0 0 1em;
  font-size: 10pt;
}
.ProseMirror th, .ProseMirror td {
  border: 0.6pt solid #b7ae9a;
  padding: 5pt 7pt;
  vertical-align: top;
}
.ProseMirror th { font-weight: 600; }
.callout {
  border: 0.6pt solid #b7ae9a;
  border-left-width: 5pt;
  padding: 8pt 10pt 2pt;
  margin: 0 0 1em;
}
.callout::before {
  content: attr(data-callout);
  display: block;
  font-family: ui-monospace, "IBM Plex Mono", monospace;
  font-size: 8pt;
  letter-spacing: 0.14em;
  font-weight: 700;
  margin-bottom: 5pt;
  text-transform: uppercase;
}
.callout-note { border-left-color: var(--note); }
.callout-caution { border-left-color: var(--caution); }
.callout-warning { border-left-color: var(--alert); }
${stepMarkerCss(book.theme.steps.markers)}
</style>
</head>
<body class="${opts.kind}">
<header class="cover">
  <p class="kicker">${escapeHtml(book.manual.abbrev)} · ${escapeHtml(book.manual.control_class)} · ${escapeHtml(issued)}</p>
  <h1>${escapeHtml(book.manual.title)}</h1>
  <p class="lede">${opts.kind === 'reference'
    ? 'Reference PDF. This is not a controlled copy. The issued electronic manual in Revdesk is the controlled copy.'
    : 'Of-record PDF for regulator signature. Not for crew distribution.'}</p>
</header>
${sections}
</body>
</html>`
  return { html, watermark }
}

export async function htmlToPdf(html: string): Promise<Buffer> {
  const dir = mkdtempSync(path.join(tmpdir(), 'revdesk-pdf-'))
  const htmlPath = path.join(dir, 'manual.html')
  const pdfPath = path.join(dir, 'manual.pdf')
  writeFileSync(htmlPath, html)
  try {
    try {
      await execFileAsync(
        'chromium',
        [
          '--headless=new',
          '--disable-gpu',
          '--no-first-run',
          '--no-pdf-header-footer',
          `--print-to-pdf=${pdfPath}`,
          htmlPath,
        ],
        { timeout: 60_000, maxBuffer: 4 * 1024 * 1024 },
      )
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      if (!existsSync(pdfPath)) {
        if (msg.includes('ENOENT')) {
          throw new RepoError(5, 'chromium is required to render the manual PDF.')
        }
        throw new RepoError(5, `PDF render failed: ${msg}`)
      }
    }
    return readFileSync(pdfPath)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

export async function renderIssuedPdf(
  book: IssuedBook,
  opts: { kind: PdfKind; downloadedAt?: Date },
): Promise<RenderedPdf> {
  const { html, watermark } = buildManualHtml(book, opts)
  let bytes = await htmlToPdf(html)
  if (watermark) bytes = await overlayWatermark(bytes, watermark)
  return { bytes, filename: pdfFilename(book.manual, opts.kind), watermark }
}

function stampHtml(watermark: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<style>
@page { size: letter; margin: 0.32in 0.55in 0.5in 0.55in; }
body { margin: 0; }
.banner {
  text-align: center;
  color: #5c241f;
  font-family: ui-monospace, "IBM Plex Mono", monospace;
  font-size: 8.5pt;
  letter-spacing: 0.02em;
  border-bottom: 0.6pt solid #8a8373;
  padding: 2pt 8pt 6pt;
}
</style>
</head>
<body><div class="banner">${escapeHtml(watermark)}</div></body>
</html>`
}

async function overlayWatermark(body: Buffer, watermark: string): Promise<Buffer> {
  const dir = mkdtempSync(path.join(tmpdir(), 'revdesk-wm-'))
  const bodyPath = path.join(dir, 'body.pdf')
  const stampPath = path.join(dir, 'stamp.pdf')
  const outPath = path.join(dir, 'out.pdf')
  writeFileSync(bodyPath, body)
  writeFileSync(stampPath, await htmlToPdf(stampHtml(watermark)))
  try {
    try {
      await execFileAsync('qpdf', ['--overlay', stampPath, '--repeat=1', '--', bodyPath, outPath], {
        timeout: 20_000,
      })
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      if (msg.includes('ENOENT')) throw new RepoError(5, 'qpdf is required to stamp the reference PDF.')
      throw new RepoError(5, `PDF watermark failed: ${msg}`)
    }
    return readFileSync(outPath)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function renderNode(node: JSONContent): string {
  switch (node.type) {
    case 'doc':
      return `<div class="ProseMirror">${renderNodes(node.content)}</div>`
    case 'heading': {
      const level = Math.min(Math.max(Number(node.attrs?.level ?? 1), 1), 5)
      return `<h${level}>${renderInline(node.content)}</h${level}>`
    }
    case 'paragraph':
      return `<p>${renderInline(node.content)}</p>`
    case 'orderedList':
      return `<ol>${renderNodes(node.content)}</ol>`
    case 'bulletList':
      return `<ul>${renderNodes(node.content)}</ul>`
    case 'listItem':
      return `<li>${renderNodes(node.content)}</li>`
    case 'note':
    case 'caution':
    case 'warning':
      return `<aside class="callout callout-${node.type}" data-callout="${node.type}">${renderNodes(node.content)}</aside>`
    case 'table':
      return `<table>${renderNodes(node.content)}</table>`
    case 'tableRow':
      return `<tr>${renderNodes(node.content)}</tr>`
    case 'tableHeader':
      return `<th>${renderNodes(node.content)}</th>`
    case 'tableCell':
      return `<td>${renderNodes(node.content)}</td>`
    case 'text':
      return renderText(node)
    default:
      return renderNodes(node.content)
  }
}

function renderNodes(nodes: JSONContent[] | undefined): string {
  return (nodes ?? []).map(renderNode).join('')
}

function renderInline(nodes: JSONContent[] | undefined): string {
  return (nodes ?? [])
    .map((node) => {
      if (node.type === 'text') return renderText(node)
      if (node.type === 'hardBreak') return '<br>'
      return renderInline(node.content)
    })
    .join('')
}

function renderText(node: JSONContent): string {
  let html = escapeHtml(node.text ?? '')
  for (const mark of node.marks ?? []) {
    if (mark.type === 'bold') html = `<strong>${html}</strong>`
    else if (mark.type === 'italic') html = `<em>${html}</em>`
    else if (mark.type === 'underline') html = `<u>${html}</u>`
  }
  return html
}
