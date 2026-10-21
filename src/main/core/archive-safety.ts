import { lstat, mkdir, realpath } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { CapShareError } from './errors'

export const ARCHIVE_LIMITS = {
  entries: 250_000,
  namesBytes: 64 * 1024 * 1024,
  entryBytes: 256 * 1024 ** 3,
  metadataBytes: 32 * 1024 ** 2,
  metadataTotalBytes: 128 * 1024 ** 2
} as const

export function archiveError(message: string): CapShareError {
  return new CapShareError('ARCHIVE_INVALID', message)
}

/** Portable names have one meaning on Windows, including device/ADS namespaces. */
export function validateArchivePath(name: string): string {
  if (
    !name ||
    name.length > 4096 ||
    name.includes('\\') ||
    name.split('/').length > 128 ||
    isAbsolute(name) ||
    name
      .split('/')
      .some(
        (part) =>
          !part ||
          part === '.' ||
          part === '..' ||
          part.length > 255 ||
          /[<>:"|?*]/.test(part) ||
          /[. ]$/.test(part) ||
          [...part].some((c) => c.charCodeAt(0) < 32) ||
          /^(?:con|prn|aux|nul|conin\$|conout\$|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(part)
      )
  )
    throw archiveError(`Unsafe archive path: ${name.slice(0, 160)}`)
  return name
}

export const archivePathKey = (name: string): string => name.normalize('NFC').toLowerCase()

export function archiveTarget(root: string, name: string): string {
  validateArchivePath(name)
  const target = resolve(root, name)
  const rel = relative(resolve(root), target)
  if (!rel || rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel))
    throw archiveError('Archive target escapes its root')
  return target
}

/** Cache checked parents once per operation; never follow a package-created link. */
export class ArchiveDestination {
  private readonly parents = new Set<string>()
  private constructor(readonly root: string) {
    this.parents.add(root)
  }

  static async create(root: string): Promise<ArchiveDestination> {
    await mkdir(root, { recursive: true })
    if ((await lstat(root)).isSymbolicLink()) throw archiveError('Linked extraction root')
    return new ArchiveDestination(await realpath(root))
  }

  async target(name: string): Promise<string> {
    const target = archiveTarget(this.root, name)
    await this.parent(dirname(target))
    return target
  }

  private async parent(directory: string): Promise<void> {
    if (this.parents.has(directory)) return
    if (!relative(this.root, directory) || !directory.startsWith(this.root + sep))
      throw archiveError('Extraction parent escapes its root')
    await this.parent(dirname(directory))
    try {
      await mkdir(directory)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    }
    const info = await lstat(directory)
    if (!info.isDirectory() || info.isSymbolicLink()) throw archiveError('Linked extraction parent')
    this.parents.add(directory)
  }
}
