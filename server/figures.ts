import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { RepoError } from './repo.ts'

export const FIGURE_MAX_BYTES = 10 * 1024 * 1024
export const FIGURE_FILE = /^[0-9a-f]{12}\.(png|jpg|gif|svg|webp)$/

const MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  webp: 'image/webp',
}

export function figureExt(ext: string): string {
  const clean = ext.replace(/^\./, '').toLowerCase()
  const norm = clean === 'jpeg' ? 'jpg' : clean
  if (!MIME[norm]) throw new RepoError(2, `Figure type .${clean || '?'} is not allowed. Use png, jpg, gif, svg, or webp.`)
  return norm
}

export function figureName(bytes: Buffer, ext: string): string {
  const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 12)
  return `${hash}.${figureExt(ext)}`
}

export function figureMime(file: string): string {
  return MIME[path.extname(file).slice(1)] ?? 'application/octet-stream'
}

function figureDir(dataRoot: string, manualId: string): string {
  if (!/^[\w-][\w.-]*$/.test(manualId)) throw new RepoError(2, 'Bad manual id.')
  return path.join(dataRoot, 'manuals', manualId, 'figures')
}

export function writeFigure(
  dataRoot: string,
  manualId: string,
  bytes: Buffer,
  ext: string,
): { src: string; existed: boolean } {
  const name = figureName(bytes, ext)
  if (!bytes.length) throw new RepoError(2, 'Figure file is empty.')
  if (bytes.length > FIGURE_MAX_BYTES) throw new RepoError(2, 'Figure is over the 10 MB limit.')
  const dir = figureDir(dataRoot, manualId)
  const target = path.join(dir, name)
  const src = `figures/${name}`
  if (existsSync(target)) return { src, existed: true }
  mkdirSync(dir, { recursive: true })
  try {
    writeFileSync(target, bytes, { flag: 'wx' })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return { src, existed: true }
    throw error
  }
  return { src, existed: false }
}

export function readFigure(
  dataRoot: string,
  manualId: string,
  file: string,
): { bytes: Buffer; mime: string } | null {
  if (!FIGURE_FILE.test(file) || !/^[\w-][\w.-]*$/.test(manualId)) return null
  const target = path.join(figureDir(dataRoot, manualId), file)
  if (!existsSync(target) || !statSync(target).isFile()) return null
  return { bytes: readFileSync(target), mime: figureMime(file) }
}
