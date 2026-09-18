import { createServer } from 'node:http'
import { existsSync, mkdirSync, readFileSync, symlinkSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')

function mermaidDist(): string {
  return path.join(ROOT, 'node_modules', 'mermaid', 'dist')
}

export function htmlHasMermaid(html: string): boolean {
  return html.includes('class="mermaid"')
}

export function stageMermaidAssets(dir: string): void {
  const dist = mermaidDist()
  const entry = path.join(dist, 'mermaid.esm.min.mjs')
  const chunks = path.join(dist, 'chunks', 'mermaid.esm.min')
  if (!existsSync(entry) || !existsSync(chunks)) {
    throw new Error('mermaid is required to print diagrams.')
  }
  symlinkSync(entry, path.join(dir, 'mermaid.esm.min.mjs'))
  mkdirSync(path.join(dir, 'chunks'), { recursive: true })
  symlinkSync(chunks, path.join(dir, 'chunks', 'mermaid.esm.min'))
}

export function mermaidBootHtml(): string {
  return `<script type="module">
import mermaid from './mermaid.esm.min.mjs';
mermaid.initialize({
  startOnLoad: false,
  theme: 'neutral',
  look: 'classic',
  securityLevel: 'strict',
  flowchart: { htmlLabels: false, useMaxWidth: true },
});
await mermaid.run({ querySelector: '.mermaid' });
document.documentElement.dataset.mermaidReady = '1';
</script>`
}

export function withMermaidBoot(html: string): string {
  if (!htmlHasMermaid(html) || html.includes('mermaid.esm.min.mjs')) return html
  return html.replace('</body>', `${mermaidBootHtml()}\n</body>`)
}

function mimeFor(file: string): string {
  if (file.endsWith('.html')) return 'text/html; charset=utf-8'
  if (file.endsWith('.mjs') || file.endsWith('.js')) return 'text/javascript; charset=utf-8'
  if (file.endsWith('.css')) return 'text/css; charset=utf-8'
  if (file.endsWith('.svg')) return 'image/svg+xml'
  return 'application/octet-stream'
}

export function servePrintDir(dir: string): Promise<{ url: string; close: () => Promise<void> }> {
  const root = path.resolve(dir)
  const server = createServer((req, res) => {
    const raw = decodeURIComponent((req.url ?? '/').split('?')[0] ?? '/')
    const rel = raw === '/' ? 'manual.html' : raw.replace(/^\//, '')
    const file = path.resolve(root, rel)
    if (file !== root && !file.startsWith(`${root}${path.sep}`)) {
      res.statusCode = 403
      res.end()
      return
    }
    if (!existsSync(file)) {
      res.statusCode = 404
      res.end()
      return
    }
    res.setHeader('Content-Type', mimeFor(file))
    res.end(readFileSync(file))
  })
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address()
      if (!addr || typeof addr === 'string') {
        reject(new Error('print server failed to bind'))
        return
      }
      resolve({
        url: `http://127.0.0.1:${addr.port}/manual.html`,
        close: () =>
          new Promise((done, fail) => {
            server.close((error) => (error ? fail(error) : done()))
          }),
      })
    })
  })
}
