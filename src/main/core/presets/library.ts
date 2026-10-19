import { existsSync } from 'node:fs'
import { readFile, readdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type { PresetLibrary, PresetNode } from '../../../shared/types'
import type { CapCutEnv } from '../capcut/model'
import { CapShareError } from '../errors'
import { walkFiles } from '../fsx'

export const STORE_PATH = 'Combination/Presets/CombinationPresetVirtualStore.json'
export type NativeRecord = Record<string, unknown>
export interface LibraryData {
  view: PresetLibrary
  catalog: NativeRecord
  raw: Buffer | null
  records: Map<string, NativeRecord>
  storage: Map<string, { directory: string; metadata: string }>
}
export const object = (value: unknown): NativeRecord =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as NativeRecord)
    : {}

export async function detectPresetRoot(env: CapCutEnv): Promise<string> {
  const config = await readFile(join(env.userDataDir, 'Config/globalSetting'), 'utf8').catch(
    () => ''
  )
  const custom = /^customPresetPath=(.+)$/m
    .exec(config)?.[1]
    .trim()
    .replace(/^"|"$/g, '')
    .replace(/\\\\/g, '\\')
  return custom ? resolve(custom) : join(env.userDataDir, 'Presets')
}

export function nativeGroups(catalog: NativeRecord): {
  records: NativeRecord[]
  links: NativeRecord[]
} {
  const groups = catalog['preset_virtual_store']
  if (!Array.isArray(groups))
    throw new CapShareError('DRAFT_UNREADABLE', 'Unsupported preset catalog format')
  const group = (type: number): NativeRecord[] => {
    const value = object(groups.find((item) => object(item)['type'] === type))['value']
    if (!Array.isArray(value))
      throw new CapShareError('DRAFT_UNREADABLE', 'Incomplete preset catalog')
    return value.map(object)
  }
  return { records: group(0), links: group(1) }
}

export function validateNodes(nodes: PresetNode[]): void {
  const ids = new Map(nodes.map((node) => [node.id, node]))
  if (ids.size !== nodes.length)
    throw new CapShareError('ARCHIVE_INVALID', 'Duplicate preset or folder ID')
  for (const node of nodes) {
    if (!/^[\w-]+$/.test(node.id) || !node.name)
      throw new CapShareError('ARCHIVE_INVALID', 'Invalid preset node')
    const seen = new Set([node.id])
    let parent = node.parentId
    while (parent) {
      const ancestor = ids.get(parent)
      if (!ancestor || ancestor.kind !== 'folder' || seen.has(parent))
        throw new CapShareError('ARCHIVE_INVALID', 'Invalid preset folder hierarchy')
      seen.add(parent)
      parent = ancestor.parentId
    }
  }
}

/** Include selected folders recursively, plus ancestors of selected individual presets. */
export function selectNodes(nodes: PresetNode[], selection: string[]): PresetNode[] {
  validateNodes(nodes)
  const ids = new Map(nodes.map((node) => [node.id, node]))
  const selected = new Set<string>()
  const descendants = (id: string): void => {
    if (!ids.has(id)) throw new CapShareError('ARCHIVE_INVALID', 'Selected preset no longer exists')
    if (selected.has(id)) return
    selected.add(id)
    for (const child of nodes.filter((node) => node.parentId === id)) descendants(child.id)
  }
  selection.forEach(descendants)
  for (const id of [...selected]) {
    let parent = ids.get(id)!.parentId
    while (parent) {
      selected.add(parent)
      parent = ids.get(parent)!.parentId
    }
  }
  if (!selected.size) throw new CapShareError('EXPORT_FAILED', 'Select presets or folders first')
  return nodes.filter((node) => selected.has(node.id))
}

export async function readLibrary(root: string): Promise<LibraryData> {
  root = resolve(root)
  const path = join(root, STORE_PATH)
  const raw = await readFile(path).catch((error) => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  })
  const catalog = raw
    ? object(JSON.parse(raw.toString('utf8').replace(/^\uFEFF/, '')))
    : {
        preset_virtual_store: [
          { type: 0, value: [] },
          { type: 1, value: [] }
        ]
      }
  const { records, links } = nativeGroups(catalog)
  const storage = new Map<string, { directory: string; metadata: string }>()
  const directory = join(root, 'Combination/Presets')
  for (const item of await readdir(directory, { withFileTypes: true }).catch((error) => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  })) {
    if (!item.isDirectory() || item.isSymbolicLink()) continue
    const folder = join(directory, item.name)
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue
      const value = object(
        JSON.parse((await readFile(join(folder, entry.name), 'utf8')).replace(/^\uFEFF/, ''))
      )
      if (typeof value['id'] !== 'string' || typeof value['cover_path'] !== 'string') continue
      if (storage.has(value['id']))
        throw new CapShareError('DRAFT_UNREADABLE', 'Duplicate preset definition ID')
      storage.set(value['id'], { directory: folder, metadata: entry.name })
    }
  }
  const parents = new Map<string, string | null>()
  for (const link of links) {
    if (
      typeof link['child_id'] !== 'string' ||
      typeof link['parent_id'] !== 'string' ||
      parents.has(link['child_id'])
    )
      throw new CapShareError('DRAFT_UNREADABLE', 'Invalid preset folder links')
    parents.set(link['child_id'], link['parent_id'] || null)
  }
  const nodes: PresetNode[] = records.map((record) => {
    const id = String(record['id'] ?? '')
    if (record['type'] !== 0 && record['type'] !== 1)
      throw new CapShareError('DRAFT_UNREADABLE', 'Unknown preset category in the catalog')
    if (!storage.has(id) && record['type'] === 1)
      throw new CapShareError('DRAFT_UNREADABLE', `Preset files are missing: ${record['name']}`)
    return {
      id,
      name: String(record['name'] ?? ''),
      kind: storage.has(id) ? 'preset' : 'folder',
      parentId: parents.get(id) ?? null
    }
  })
  validateNodes(nodes)
  if ([...parents.keys()].some((id) => !nodes.some((node) => node.id === id)))
    throw new CapShareError('DRAFT_UNREADABLE', 'Orphan preset folder link')
  const warnings: string[] = []
  for (const category of ['Text_V2', 'Adjust']) {
    const folder = join(root, category)
    if (!existsSync(folder)) continue
    const entries = await readdir(folder, { withFileTypes: true })
    let nonempty = false
    for await (const file of walkFiles(folder)) {
      if (file.relPath.includes('/')) {
        nonempty = true
        break
      }
    }
    for (const entry of entries.filter((entry) => entry.isFile())) {
      if (category === 'Adjust' && entry.name === 'AdjustPresetCfg.json') {
        const value = JSON.parse(await readFile(join(folder, entry.name), 'utf8'))
        nonempty ||= !Array.isArray(value) || value.length > 0
      } else nonempty = true
    }
    if (nonempty)
      warnings.push(
        `${category} contains another preset format. This page currently transfers composition presets only.`
      )
  }
  return {
    view: { root, nodes, warnings },
    catalog,
    raw,
    records: new Map(records.map((record) => [String(record['id']), record])),
    storage
  }
}
