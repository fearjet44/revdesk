import type { IncomingMessage, ServerResponse } from 'node:http'
import path from 'node:path'
import type { Plugin, ViteDevServer } from 'vite'
import { Repo, RepoError } from './repo.ts'
import type { ChangeAction } from './types.ts'

const ACTIONS = new Set<ChangeAction>(['submit', 'approve', 'issue'])

export function controlDeskPlugin(dataRoot: string): Plugin {
  const repo = new Repo(dataRoot)
  return {
    name: 'revdesk-control-api',
    configureServer(server: ViteDevServer) {
      server.middlewares.use(async (req, res, next) => {
        const url = req.url ?? ''
        if (!url.startsWith('/api/')) {
          next()
          return
        }
        try {
          await handle(repo, req, res)
        } catch (error) {
          if (error instanceof RepoError) {
            sendJson(res, error.status, { error: error.message })
            return
          }
          const message = error instanceof Error ? error.message : 'Server error'
          sendJson(res, 500, { error: message })
        }
      })
    },
  }
}

async function handle(repo: Repo, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://revdesk.local')
  const method = req.method ?? 'GET'
  const parts = url.pathname.replace(/^\/api\//, '').split('/').filter(Boolean)

  if (method === 'GET' && parts.length === 1 && parts[0] === 'desk') {
    sendJson(res, 200, repo.desk())
    return
  }

  if (method === 'GET' && parts.length === 1 && parts[0] === 'manuals') {
    sendJson(res, 200, repo.listManuals())
    return
  }

  if (method === 'GET' && parts.length === 2 && parts[0] === 'manuals') {
    sendJson(res, 200, repo.getManual(parts[1]))
    return
  }

  if (method === 'GET' && parts.length === 4 && parts[0] === 'manuals' && parts[2] === 'sections') {
    const manual = repo.getManual(parts[1])
    const section = manual.sections.find((item) => item.id === parts[3])
    if (!section) throw new RepoError(404, `Section ${parts[3]} not found.`)
    sendJson(res, 200, repo.readSection(section.path))
    return
  }

  if (method === 'GET' && parts.length === 1 && parts[0] === 'changes') {
    sendJson(res, 200, repo.listChanges())
    return
  }

  if (method === 'POST' && parts.length === 1 && parts[0] === 'changes') {
    const body = await readJson<{
      manual?: string
      title?: string
      reason?: string
      sectionIds?: string[]
    }>(req)
    sendJson(
      res,
      201,
      repo.startChange({
        manual: body.manual ?? '',
        title: body.title ?? '',
        reason: body.reason ?? '',
        sectionIds: body.sectionIds ?? [],
      }),
    )
    return
  }

  if (method === 'GET' && parts.length === 2 && parts[0] === 'changes') {
    sendJson(res, 200, repo.readChange(parts[1]))
    return
  }

  if (
    method === 'GET' &&
    parts.length === 4 &&
    parts[0] === 'changes' &&
    parts[2] === 'sections'
  ) {
    const change = repo.readChange(parts[1])
    const touched = change.touched.find((item) => item.id === parts[3])
    if (!touched) throw new RepoError(404, `Section ${parts[3]} is not on ${parts[1]}.`)
    sendJson(res, 200, repo.readSection(touched.working))
    return
  }

  if (
    method === 'PUT' &&
    parts.length === 4 &&
    parts[0] === 'changes' &&
    parts[2] === 'sections'
  ) {
    const body = await readJson<{ markdown?: string }>(req)
    if (!body.markdown) throw new RepoError(400, 'markdown is required.')
    sendJson(res, 200, repo.saveWorkingSection(parts[1], parts[3], body.markdown))
    return
  }

  if (method === 'POST' && parts.length === 3 && parts[0] === 'changes' && parts[2] === 'transition') {
    const body = await readJson<{ action?: string }>(req)
    const action = body.action as ChangeAction
    if (!ACTIONS.has(action)) throw new RepoError(400, 'action must be submit, approve, or issue.')
    sendJson(res, 200, repo.transition(parts[1], action))
    return
  }

  if (method === 'GET' && parts.length === 1 && parts[0] === 'issues') {
    sendJson(res, 200, repo.listIssues())
    return
  }

  if (method === 'GET' && parts.length === 2 && parts[0] === 'issues') {
    sendJson(res, 200, repo.readIssue(parts[1]))
    return
  }

  sendJson(res, 404, { error: `No route for ${method} ${url.pathname}` })
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.end(payload)
}

async function readJson<T>(req: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  const raw = Buffer.concat(chunks).toString('utf8')
  if (!raw.trim()) return {} as T
  return JSON.parse(raw) as T
}

export function dataRootFrom(cwd: string): string {
  return path.resolve(cwd, 'data')
}
