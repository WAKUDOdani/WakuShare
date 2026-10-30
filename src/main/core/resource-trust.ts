import { lstat } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { archiveTarget, validateArchivePath } from './archive-safety'
import { hashFile } from './fsx'
import type { ApproveActiveContent } from './payload-policy'

export interface ExistingResource {
  relativePath: string
  size: number
  sha256?: string
}

/** Recognize bytes already installed in this machine's cache. Paths, names and
 * archive-declared hashes alone never establish trust. Payload hashes are still
 * verified by extractZip before the staged copy can be published. */
export function approveNewResources(
  cacheDir: string,
  resources: ReadonlyMap<string, ExistingResource>,
  approve?: ApproveActiveContent
): ApproveActiveContent {
  const root = resolve(cacheDir)
  return async (entries) => {
    const parents = new Map<string, Promise<void>>()
    const checkParent = (directory: string): Promise<void> => {
      const cached = parents.get(directory)
      if (cached) return cached
      const checked = (async () => {
        if (directory !== root) await checkParent(dirname(directory))
        const info = await lstat(directory)
        if (!info.isDirectory() || info.isSymbolicLink()) throw Error('Linked cache parent')
      })()
      parents.set(directory, checked)
      return checked
    }
    const isKnown = async (entry: string): Promise<boolean> => {
      const resource = resources.get(entry)
      let known = false
      if (resource && resource.sha256 && /^[a-f0-9]{64}$/i.test(resource.sha256)) {
        validateArchivePath(resource.relativePath)
        const target = archiveTarget(root, resource.relativePath)
        try {
          await checkParent(dirname(target))
          const before = await lstat(target)
          if (before.isFile() && !before.isSymbolicLink() && before.size === resource.size) {
            known = (await hashFile(target)) === resource.sha256.toLowerCase()
            const after = await lstat(target)
            known &&=
              !after.isSymbolicLink() &&
              after.size === before.size &&
              after.mtimeMs === before.mtimeMs
          }
        } catch {
          known = false
        }
      }
      return known
    }
    const unknown: string[] = []
    // Bound open files while independent small resources share parent checks.
    for (let offset = 0; offset < entries.length; offset += 16) {
      const batch = entries.slice(offset, offset + 16)
      const known = await Promise.all(batch.map(isKnown))
      unknown.push(...batch.filter((_entry, index) => !known[index]))
    }
    return unknown.length === 0 || (await approve?.(unknown)) === true
  }
}
