import type { IncomingMessage, ServerResponse } from 'node:http'
import path from 'node:path'
import type { Plugin, ViteDevServer } from 'vite'
import { bindRemote, libraryInfo, resolveLibraryRoot } from './config.ts'
import { applyIngest, classifyUpload } from './ingest.ts'
import { renderIssuedPdf, type PdfKind } from './print.ts'
import { Repo, RepoError } from './repo.ts'
import type { ChangeAction, TouchAction } from './types.ts'

const ACTIONS = new Set<ChangeAction>(['submit', 'approve', 'open-letter'])

export function controlDeskPlugin(appRoot: string): Plugin {
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
          const dataRoot = resolveLibraryRoot(appRoot)
          const repo = new Repo(dataRoot)
          await handle(repo, appRoot, req, res)
        } catch (error) {
          if (error instanceof RepoError) {
            sendJson(res, httpStatus(error.status), { error: error.message, code: error.status })
            return
          }
          const message = error instanceof Error ? error.message : 'Server error'
          sendJson(res, 500, { error: message })
        }
      })
    },
  }
}

function httpStatus(code: number): number {
  if (code === 3) return 404
  if (code === 4) return 403
  if (code === 2 || code === 5) return 409
  if (code >= 400 && code < 600) return code
  return 400
}

async function handle(repo: Repo, appRoot: string, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://revdesk.local')
  const method = req.method ?? 'GET'
  const parts = url.pathname.replace(/^\/api\//, '').split('/').filter(Boolean)

  if (method === 'GET' && parts[0] === 'config' && parts.length === 1) {
    sendJson(res, 200, publicLibrary(libraryInfo(appRoot)))
    return
  }

  if (method === 'PUT' && parts[0] === 'config' && parts.length === 1) {
    const body = await readJson<{ remote?: string }>(req)
    const info = bindRemote(body.remote ?? '')
    if (!info.bound) {
      info.library_root = path.join(appRoot, 'data')
      info.solo = true
    }
    sendJson(res, 200, publicLibrary(info))
    return
  }

  if (method === 'POST' && parts[0] === 'ingest' && parts[1] === 'classify') {
    const body = await readJson<{ file?: string; filename?: string; content?: string }>(req)
    const source = uploadedBook(body)
    sendJson(res, 200, classifyUpload(source.filename, source.bytes))
    return
  }

  if (method === 'POST' && parts[0] === 'ingest' && parts.length === 1) {
    const body = await readJson<{ file?: string; filename?: string; content?: string }>(req)
    const source = uploadedBook(body)
    sendJson(res, 201, applyIngest({ filename: source.filename, bytes: source.bytes }, repo.root))
    return
  }

  if (method === 'GET' && parts[0] === 'desk') {
    sendJson(res, 200, repo.desk())
    return
  }

  if (method === 'GET' && parts[0] === 'launched' && parts[1]) {
    sendJson(res, 200, repo.launched(parts[1]))
    return
  }

  if (method === 'GET' && parts[0] === 'manuals' && parts.length === 1) {
    sendJson(res, 200, repo.listManuals())
    return
  }

  if (method === 'GET' && parts[0] === 'manuals' && parts.length === 2) {
    sendJson(res, 200, repo.getManual(parts[1]))
    return
  }

  if (method === 'GET' && parts[0] === 'manuals' && parts[2] === 'pdf' && parts.length === 3) {
    const kind: PdfKind = url.searchParams.get('kind') === 'regulator' ? 'regulator' : 'reference'
    const download = url.searchParams.get('download') === '1' || url.searchParams.get('download') === 'true'
    const pdf = await renderIssuedPdf(repo.issuedBook(parts[1]), { kind, downloadedAt: new Date() })
    sendPdf(res, pdf.bytes, pdf.filename, download)
    return
  }

  if (method === 'GET' && parts[0] === 'manuals' && parts[2] === 'theme' && parts.length === 3) {
    sendJson(res, 200, repo.readTheme(parts[1]))
    return
  }

  if (method === 'GET' && parts[0] === 'manuals' && parts[2] === 'sections' && parts[4] === 'findings') {
    sendJson(res, 200, repo.findingsForManual(parts[1], parts[3]))
    return
  }

  if (method === 'GET' && parts[0] === 'manuals' && parts[2] === 'sections' && parts[3]) {
    sendJson(res, 200, repo.issuedSection(parts[1], parts[3]))
    return
  }

  if (method === 'GET' && parts[0] === 'changes' && parts.length === 1) {
    sendJson(res, 200, repo.listChanges())
    return
  }

  if (method === 'POST' && parts[0] === 'changes' && parts.length === 1) {
    const body = await readJson<{
      manual?: string
      title?: string
      reason?: string
      reasonType?: string
      reasonRef?: string
      kind?: string
      sectionIds?: string[]
      supersedes?: string
    }>(req)
    sendJson(
      res,
      201,
      repo.startChange({
        manual: body.manual ?? '',
        title: body.title ?? '',
        reason: body.reason,
        reasonType: body.reasonType,
        reasonRef: body.reasonRef,
        kind: body.kind,
        sectionIds: body.sectionIds ?? [],
        supersedes: body.supersedes,
      }),
    )
    return
  }

  if (method === 'GET' && parts[0] === 'changes' && parts.length === 2) {
    sendJson(res, 200, repo.readChange(parts[1]))
    return
  }

  if (method === 'POST' && parts[0] === 'changes' && parts[2] === 'touch') {
    const body = await readJson<{ section?: string; action?: string }>(req)
    sendJson(
      res,
      200,
      repo.touchChange(parts[1], body.section ?? '', (body.action as TouchAction) || 'amend'),
    )
    return
  }

  if (method === 'POST' && parts[0] === 'changes' && parts[2] === 'compose') {
    const body = await readJson<{
      file?: string
      to?: string
      from?: string
      dated?: string
      subject?: string
      authority?: string
      body?: string
      as?: string
    }>(req)
    if (body.file?.trim()) {
      throw new RepoError(
        2,
        'The desk types the letter; it does not take a server path. CLI compose still uses --body-file.',
      )
    }
    const as = body.as === 'tr' || body.as === 'rev' ? body.as : undefined
    sendJson(
      res,
      200,
      repo.composeLetter(parts[1], {
        to: body.to ?? '',
        from: body.from ?? '',
        dated: body.dated ?? '',
        subject: body.subject ?? '',
        authority: body.authority ?? '',
        body: body.body ?? '',
        as,
      }),
    )
    return
  }

  if (method === 'POST' && parts[0] === 'changes' && parts[2] === 'instrument') {
    const body = await readJson<{
      file?: string
      filename?: string
      content?: string
      type?: string
      authority?: string
      dated?: string
      reference?: string
    }>(req)
    const letter = uploadedLetter(body)
    sendJson(
      res,
      200,
      repo.attachInstrument(parts[1], {
        bytes: letter.bytes,
        filename: letter.filename,
        type: body.type ?? '',
        authority: body.authority ?? '',
        dated: body.dated ?? '',
        reference: body.reference,
      }),
    )
    return
  }

  if (method === 'POST' && parts[0] === 'changes' && parts[2] === 'return-to-edit') {
    sendJson(res, 200, repo.returnToEdit(parts[1]))
    return
  }

  if (method === 'POST' && parts[0] === 'changes' && parts[2] === 'withdraw') {
    const body = await readJson<{ why?: string }>(req)
    sendJson(res, 200, repo.withdraw(parts[1], body.why ?? ''))
    return
  }

  if (method === 'GET' && parts[0] === 'changes' && parts[2] === 'preview') {
    sendJson(res, 200, repo.preview(parts[1]))
    return
  }

  if (method === 'GET' && parts[0] === 'changes' && parts[2] === 'comments') {
    sendJson(res, 200, repo.listComments(parts[1]))
    return
  }

  if (method === 'POST' && parts[0] === 'changes' && parts[2] === 'comments' && parts[4] === 'answer') {
    const body = await readJson<{ status?: string; reason?: string }>(req)
    sendJson(
      res,
      200,
      repo.answerComment(parts[1], {
        comment: parts[3] ?? '',
        status: body.status ?? '',
        reason: body.reason,
      }),
    )
    return
  }

  if (method === 'POST' && parts[0] === 'changes' && parts[2] === 'comments') {
    const body = await readJson<{
      section?: string
      line?: number
      side?: string
      body?: string
    }>(req)
    sendJson(
      res,
      201,
      repo.addComment(parts[1], {
        section: body.section ?? '',
        line: Number(body.line),
        side: body.side === 'old' ? 'old' : 'new',
        body: body.body ?? '',
      }),
    )
    return
  }

  if (method === 'GET' && parts[0] === 'changes' && parts[2] === 'sections' && parts[4] === 'review') {
    sendJson(res, 200, repo.reviewSection(parts[1], parts[3]))
    return
  }

  if (method === 'GET' && parts[0] === 'changes' && parts[2] === 'sections' && parts[3]) {
    sendJson(res, 200, repo.getSectionForChange(parts[3], parts[1]))
    return
  }

  if (method === 'PUT' && parts[0] === 'changes' && parts[2] === 'sections' && parts[3]) {
    const body = await readJson<{ markdown?: string; mark?: string; note?: string }>(req)
    if (!body.markdown) throw new RepoError(2, 'markdown is required.')
    sendJson(res, 200, repo.saveWorkingSection(parts[1], parts[3], body.markdown, {
      mark: body.mark,
      note: body.note,
    }))
    return
  }

  if (method === 'POST' && parts[0] === 'changes' && parts[2] === 'transition') {
    const body = await readJson<{ action?: string; role?: string }>(req)
    const action = body.action as ChangeAction
    if (!ACTIONS.has(action)) throw new RepoError(2, 'action must be submit, approve, or open-letter.')
    sendJson(res, 200, repo.transition(parts[1], action, { role: body.role }))
    return
  }

  if (method === 'POST' && parts[0] === 'changes' && parts[2] === 'issue') {
    const body = await readJson<{ effective?: string }>(req)
    sendJson(res, 200, repo.issueFull(parts[1], body.effective ?? ''))
    return
  }

  if (method === 'POST' && parts[0] === 'changes' && parts[2] === 'tr') {
    const body = await readJson<{
      parent?: string
      authority?: string
      file?: string
      filename?: string
      content?: string
      expires?: string
    }>(req)
    if (body.file?.trim()) {
      throw new RepoError(
        2,
        'The desk uploads the letter; it does not take a server path. CLI still uses --file.',
      )
    }
    const hasUpload = Boolean((body.filename ?? '').trim() || body.content)
    const letter = hasUpload ? uploadedLetter(body) : null
    sendJson(
      res,
      200,
      repo.issueTr(parts[1], {
        parent: body.parent ?? '',
        authority: body.authority ?? '',
        ...(letter ? { bytes: letter.bytes, filename: letter.filename } : {}),
        expires: body.expires,
      }),
    )
    return
  }

  if (method === 'GET' && parts[0] === 'issues' && parts.length === 1) {
    sendJson(res, 200, repo.listIssues())
    return
  }

  if (method === 'GET' && parts[0] === 'issues' && parts[2] === 'pdf' && parts.length === 3) {
    const issue = repo.readIssue(parts[1])
    const kind: PdfKind = url.searchParams.get('kind') === 'regulator' ? 'regulator' : 'reference'
    const download = url.searchParams.get('download') === '1' || url.searchParams.get('download') === 'true'
    const pdf = await renderIssuedPdf(repo.issuedBook(issue.manual), { kind, downloadedAt: new Date() })
    sendPdf(res, pdf.bytes, pdf.filename, download)
    return
  }

  if (method === 'POST' && parts[0] === 'issues' && parts[2] === 'sections' && parts[4] === 'findings') {
    const body = await readJson<{ body?: string }>(req)
    sendJson(res, 201, repo.addFinding(parts[1], parts[3], body.body ?? ''))
    return
  }

  if (method === 'GET' && parts[0] === 'issues' && parts[2] === 'sections' && parts[4] === 'findings') {
    sendJson(res, 200, repo.listFindings(parts[1], parts[3]))
    return
  }

  if (method === 'GET' && parts[0] === 'issues' && parts[2] === 'sections' && parts[3]) {
    sendJson(res, 200, repo.crewSection(parts[1], parts[3]))
    return
  }

  if (method === 'GET' && parts[0] === 'issues' && parts[1]) {
    sendJson(res, 200, repo.readIssue(parts[1]))
    return
  }

  if (method === 'GET' && parts[0] === 'trs' && parts.length === 1) {
    sendJson(res, 200, repo.listTrs({ manual: url.searchParams.get('manual') ?? undefined }))
    return
  }

  if (method === 'GET' && parts[0] === 'trs' && parts[1]) {
    sendJson(res, 200, repo.readTr(parts[1]))
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

function sendPdf(res: ServerResponse, bytes: Buffer, filename: string, download: boolean): void {
  const disposition = download ? 'attachment' : 'inline'
  res.statusCode = 200
  res.setHeader('Content-Type', 'application/pdf')
  res.setHeader('Content-Disposition', `${disposition}; filename="${filename}"`)
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('Content-Length', String(bytes.length))
  res.end(bytes)
}

async function readJson<T>(req: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  const raw = Buffer.concat(chunks).toString('utf8')
  if (!raw.trim()) return {} as T
  return JSON.parse(raw) as T
}

function uploadedLetter(body: { file?: string; filename?: string; content?: string }): {
  bytes: Buffer
  filename: string
} {
  if (body.file?.trim()) {
    throw new RepoError(
      2,
      'The desk uploads the letter; it does not take a server path. CLI still uses --file.',
    )
  }
  const filename = (body.filename ?? '').trim()
  if (!filename) throw new RepoError(2, 'filename is required.')
  if (!body.content) throw new RepoError(2, 'content is required.')
  const bytes = Buffer.from(body.content, 'base64')
  if (!bytes.length) throw new RepoError(2, 'Instrument file is empty.')
  return { bytes, filename }
}

function uploadedBook(body: { file?: string; filename?: string; content?: string }): {
  bytes: Buffer
  filename: string
} {
  if (body.file?.trim()) {
    throw new RepoError(
      2,
      'The desk uploads the book; it does not take a server path. CLI ingest still uses a file argument.',
    )
  }
  const filename = path.basename((body.filename ?? '').trim())
  if (!filename) throw new RepoError(2, 'filename is required.')
  if (!body.content) throw new RepoError(2, 'content is required.')
  const bytes = Buffer.from(body.content, 'base64')
  if (!bytes.length) throw new RepoError(2, 'Source file is empty.')
  return { bytes, filename }
}

function publicLibrary(info: ReturnType<typeof libraryInfo>) {
  return {
    remote: info.remote,
    bound: info.bound,
    solo: info.solo,
    library_root: info.library_root,
    cloned: info.cloned,
  }
}

export function dataRootFrom(cwd: string): string {
  return resolveLibraryRoot(cwd)
}
