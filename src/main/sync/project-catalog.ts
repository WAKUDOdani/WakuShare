import { createHash } from 'node:crypto'
import { lstat, readFile, readdir, realpath } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { z } from 'zod'
import type { ExplorerProject, ExplorerProjectChoice } from '../../shared/explorer'

const uuid = z.uuid().refine((value) => value !== '00000000-0000-0000-0000-000000000000')
const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
const pathKey = (path: string): string => resolve(path).toUpperCase()
export function explorerProjectKey(draftId: string, location: string): string {
  return (
    'project-v1-' +
    createHash('sha256')
      .update(draftId.toUpperCase() + '\0' + pathKey(location))
      .digest('hex')
  )
}
async function bounded(path: string, max: number): Promise<Buffer | null> {
  try {
    const info = await lstat(path)
    if (!info.isFile() || info.isSymbolicLink() || info.size > max) return null
    const bytes = await readFile(path)
    return bytes.length <= max ? bytes : null
  } catch {
    return null
  }
}
async function json(path: string): Promise<Record<string, unknown>> {
  try {
    const bytes = await bounded(path, 16 * 1024 * 1024)
    return bytes ? record(JSON.parse(bytes.toString('utf8'))) : {}
  } catch {
    return {}
  }
}
/** Metadata/registry and small covers only: no timeline parsing or media-directory size scans. */
export async function listExplorerProjects(
  root: string | null,
  known: ExplorerProject[],
  thumbnail?: (bytes: Buffer) => string | null
): Promise<ExplorerProjectChoice[]> {
  const roots = [
    ...new Set([...(root ? [root] : []), ...known.map((project) => dirname(project.location))])
  ]
  const choices = new Map<string, ExplorerProjectChoice>(
    known.map((project) => [project.key, project])
  )
  for (const directory of roots) {
    const canonicalDirectory = await realpath(directory).catch(() => null)
    if (!canonicalDirectory) continue
    const registry = await json(join(directory, 'root_meta_info.json'))
    const entries = Array.isArray(registry.all_draft_store)
      ? registry.all_draft_store.map(record)
      : []
    const byPath = new Map<string, Record<string, unknown>[]>()
    for (const entry of entries) {
      if (typeof entry.draft_fold_path !== 'string' || !uuid.safeParse(entry.draft_id).success)
        continue
      const key = pathKey(entry.draft_fold_path)
      byPath.set(key, [...(byPath.get(key) ?? []), entry])
    }
    const folders = await readdir(directory, { withFileTypes: true }).catch(() => [])
    for (const folder of folders.slice(0, 2048)) {
      if (!folder.isDirectory() || folder.isSymbolicLink() || choices.size >= 1024) continue
      const location = await realpath(join(directory, folder.name)).catch(() => null)
      if (!location || pathKey(dirname(location)) !== pathKey(canonicalDirectory)) continue
      const meta = await json(join(location, 'draft_meta_info.json'))
      const rows = byPath.get(pathKey(location)) ?? []
      const indexed =
        rows.length && new Set(rows.map((row) => row.draft_id)).size === 1 ? rows[0] : {}
      const previous = known.find((project) => pathKey(project.location) === pathKey(location))
      const draftId = uuid.safeParse(meta.draft_id ?? previous?.draftId ?? indexed.draft_id)
      if (
        !draftId.success ||
        indexed.draft_is_invisible === true ||
        Number(indexed.tm_draft_removed) > 0
      )
        continue
      const key = explorerProjectKey(draftId.data, location)
      const name =
        (typeof meta.draft_name === 'string' && meta.draft_name.trim()) ||
        previous?.name ||
        (typeof indexed.draft_name === 'string' && indexed.draft_name.trim()) ||
        basename(location)
      for (const [oldKey, old] of choices)
        if (oldKey !== key && pathKey(old.location) === pathKey(location)) choices.delete(oldKey)
      choices.set(key, {
        key,
        draftId: draftId.data.toUpperCase(),
        location,
        name: name.slice(0, 256),
        coverDataUrl: null
      })
    }
  }
  // Bound concurrent decoding and thumbnail size; never return full-size covers.
  const output = [...choices.values()].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { numeric: true })
  )
  let cursor = 0
  await Promise.all(
    Array.from({ length: Math.min(4, output.length) }, async () => {
      while (cursor < output.length) {
        const project = output[cursor++]
        const bytes = await bounded(join(project.location, 'draft_cover.jpg'), 4 * 1024 * 1024)
        if (!bytes) continue
        try {
          project.coverDataUrl = thumbnail?.(bytes) ?? null
        } catch {
          /* A missing or invalid cover never hides a project. */
        }
      }
    })
  )
  return output
}
