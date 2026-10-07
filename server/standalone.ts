// Revdesk without Vite: built UI (`dist/`) + `/api/*` on one loopback port.
// The desktop shell (`src-tauri/`) runs this as its sidecar and points its
// window at the printed URL. Same handler as the dev plugin, so same API.
//
//   node --experimental-strip-types server/standalone.ts [--port 0] [--dist dist]
//
// Env: REVDESK_APP_ROOT (repo or bundle resources), REVDESK_DATA (library),
// REVDESK_EXIT_ON_STDIN_CLOSE=1 (sidecar mode).
// Prints one line `REVDESK_LISTENING <url>` once bound.

import { createReadStream, existsSync, statSync } from 'node:fs'
import { createServer, type ServerResponse } from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createApiHandler } from './plugin.ts'

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.pdf': 'application/pdf',
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}

const appRoot = path.resolve(
  process.env.REVDESK_APP_ROOT?.trim() || path.join(path.dirname(fileURLToPath(import.meta.url)), '..'),
)
const distDir = path.resolve(appRoot, arg('dist') ?? 'dist')
const port = Number(arg('port') ?? 0)
const api = createApiHandler(appRoot)

if (!existsSync(path.join(distDir, 'index.html'))) {
  console.error(`revdesk: no built UI at ${distDir} (run \`npm run build\`).`)
  process.exit(1)
}

function sendFile(res: ServerResponse, file: string): void {
  res.writeHead(200, {
    'Content-Type': MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
    'Cache-Control': file.endsWith('index.html') ? 'no-cache' : 'public, max-age=31536000, immutable',
  })
  createReadStream(file).pipe(res)
}

const server = createServer(async (req, res) => {
  if (await api(req, res)) return
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405).end()
    return
  }
  const pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://revdesk.local').pathname)
  const file = path.join(distDir, path.normalize(pathname))
  if (file.startsWith(distDir + path.sep) && existsSync(file) && statSync(file).isFile()) {
    sendFile(res, file)
    return
  }
  // Client-side route (react-router): hand back the shell.
  sendFile(res, path.join(distDir, 'index.html'))
})

server.listen(port, '127.0.0.1', () => {
  const address = server.address()
  const bound = typeof address === 'object' && address ? address.port : port
  console.log(`REVDESK_LISTENING http://127.0.0.1:${bound}/`)
})

// Under the desktop shell, stdin is a pipe it holds open; exit when it closes.
if (process.env.REVDESK_EXIT_ON_STDIN_CLOSE === '1') {
  process.stdin.on('end', () => process.exit(0))
  process.stdin.resume()
}
