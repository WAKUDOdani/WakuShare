import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { lstat, mkdir, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, extname, join, relative } from 'node:path'
import { pipeline } from 'node:stream/promises'

const windowsDeviceName = /^(?:con|prn|aux|nul|conin\$|conout\$|com[1-9¹²³]|lpt[1-9¹²³]) *(?:\.|$)/i

function truncateName(name: string, maxUnits: number, maxBytes: number): string {
  let end = 0
  let bytes = 0
  for (const character of name) {
    bytes += Buffer.byteLength(character)
    if (end + character.length > maxUnits || bytes > maxBytes) break
    end += character.length
  }
  return name.slice(0, end)
}

/** Shorten a generated media filename while reserving room for its extension and suffix. */
export function portableFileName(name: string, maxUnits = 80, suffix = ''): string {
  // eslint-disable-next-line no-control-regex -- Windows forbids control characters.
  const clean = name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/[. ]+$/g, '')
  const lastExtension = extname(clean)
  const extension = lastExtension.length <= 20 ? lastExtension : ''
  const base = clean.slice(0, clean.length - extension.length)
  const tail = suffix + extension
  const stem = (prefix: string): string => {
    const original = prefix + base
    const shortened = truncateName(original, maxUnits - tail.length, 255 - Buffer.byteLength(tail))
    return (shortened === original ? shortened : shortened.replace(/[. ]+$/g, '')) || 'source'
  }
  const result = stem('') + tail
  return windowsDeviceName.test(result) ? stem('_') + tail : result
}

export interface WalkedFile {
  /** Absolute path. */
  absPath: string
  /** Path relative to the walk root, with forward slashes. */
  relPath: string
  size: number
  mtimeMs: number
}

/**
 * Recursively walks files under `root`, never following symlinks (a CapCut
 * draft can sit behind sandbox redirects; following links risks runaway walks).
 * Order is deterministic (sorted per directory).
 */
export async function* walkFiles(
  root: string,
  options: { skip?: (relPath: string, isDir: boolean) => boolean } = {}
): AsyncGenerator<WalkedFile> {
  const { skip } = options

  async function* walk(dir: string): AsyncGenerator<WalkedFile> {
    let entries: string[]
    try {
      entries = (await readdir(dir)).sort()
    } catch {
      return
    }
    for (const name of entries) {
      const absPath = join(dir, name)
      const relPath = relative(root, absPath).split('\\').join('/')
      let stats
      try {
        stats = await lstat(absPath)
      } catch {
        continue
      }
      if (stats.isSymbolicLink()) continue
      if (stats.isDirectory()) {
        if (skip?.(relPath, true)) continue
        yield* walk(absPath)
      } else if (stats.isFile()) {
        if (skip?.(relPath, false)) continue
        yield { absPath, relPath, size: stats.size, mtimeMs: stats.mtimeMs }
      }
    }
  }

  yield* walk(root)
}

/** Total size in bytes of all regular files under root (symlinks excluded). */
export async function dirSize(root: string): Promise<number> {
  let total = 0
  for await (const file of walkFiles(root)) total += file.size
  return total
}

/** Streaming file hash — multi-GB-safe. */
export async function hashFile(
  path: string,
  algorithm: 'sha256' | 'md5' = 'sha256'
): Promise<string> {
  const hash = createHash(algorithm)
  await pipeline(createReadStream(path), hash)
  return hash.digest('hex')
}

export function hashString(value: string, algorithm: 'sha256' | 'md5' = 'sha256'): string {
  return createHash(algorithm).update(value).digest('hex')
}

/**
 * Writes a file atomically: write to a sibling temp file, then rename.
 * Rename is atomic on the same volume — readers never observe partial content.
 */
export async function atomicWriteFile(path: string, data: string | Buffer): Promise<void> {
  const tmpPath = join(dirname(path), `.${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`)
  await writeFile(tmpPath, data, { flag: 'wx' })
  try {
    await rename(tmpPath, path)
  } catch (error) {
    await rm(tmpPath, { force: true })
    throw error
  }
}

export async function ensureDir(path: string): Promise<void> {
  await mkdir(path, { recursive: true })
}

/**
 * Sanitizes a draft display name into a folder basename valid on the given OS.
 * Windows forbids <>:"/\|?* plus trailing dots/spaces and reserved device
 * names; macOS mainly forbids '/' and ':'. The display name itself is
 * preserved separately in draft_meta_info.json.
 */
export function sanitizeFolderName(name: string, os: 'mac' | 'windows'): string {
  let safe = name
    // eslint-disable-next-line no-control-regex -- control chars are intentionally stripped
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  const shorten = (value: string): string => {
    const trimmed = truncateName(value, 80, 255).trimEnd()
    return os === 'windows' ? trimmed.replace(/[. ]+$/g, '') : trimmed
  }
  safe = shorten(safe)
  if (os === 'windows' && windowsDeviceName.test(safe)) safe = shorten(`_${safe}`)
  return safe && safe !== '.' && safe !== '..' ? safe : 'Imported Project'
}

/** Returns `base`, or `base 2`, `base 3`, … — the first name not in `taken`. */
export function uniqueName(base: string, taken: ReadonlySet<string>): string {
  const lowerTaken = new Set([...taken].map((n) => n.toLowerCase()))
  if (!lowerTaken.has(base.toLowerCase())) return base
  for (let i = 2; ; i++) {
    const candidate = `${base} ${i}`
    if (!lowerTaken.has(candidate.toLowerCase())) return candidate
  }
}
