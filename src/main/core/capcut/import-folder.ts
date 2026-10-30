import { randomUUID } from 'node:crypto'
import type { ProjectDocument } from './project'
import { CapShareError } from '../errors'

const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null

/** Reparent only library roots in the staged imported copy. Media/clip IDs,
 * nested folders, manual labels and every timeline document remain unchanged. */
export function groupImportedMedia(
  documents: Map<string, ProjectDocument>,
  uuid: () => string = randomUUID,
  now = Date.now()
): string | null {
  const meta = record(documents.get('draft_meta_info.json')?.value)
  const storeName = 'draft_virtual_store.json'
  const original = documents.get(storeName)
  const store = original ? record(original.value) : { draft_materials: [], draft_virtual_store: [] }
  if (!store || !Array.isArray(store.draft_virtual_store))
    throw new CapShareError('DRAFT_UNREADABLE', 'Unsupported media library hierarchy')
  const groups = store.draft_virtual_store
  const values = (type: number): unknown[] => {
    const matching = groups.filter((group) => record(group)?.type === type)
    if (matching.length > 1)
      throw new CapShareError('DRAFT_UNREADABLE', 'Ambiguous media library hierarchy')
    if (!matching.length) {
      const group = { type, value: [] as unknown[] }
      groups.push(group)
      return group.value
    }
    const value = record(matching[0])!.value
    if (!Array.isArray(value))
      throw new CapShareError('DRAFT_UNREADABLE', 'Unsupported media library group')
    return value
  }
  const folders = values(0),
    edges = values(1)
  const children = new Set<string>()
  const occupied = new Set<string>()
  for (const folder of folders) {
    const id = record(folder)?.id
    if (typeof id === 'string' && id) children.add(id)
  }
  if (Array.isArray(meta?.draft_materials))
    for (const group of meta.draft_materials) {
      const entries = record(group)?.value
      if (!Array.isArray(entries)) continue
      for (const item of entries) {
        const media = record(item)
        if (typeof media?.id === 'string' && typeof media.file_Path === 'string' && media.file_Path)
          children.add(media.id)
      }
    }
  for (const id of children) occupied.add(id)
  for (const item of edges) {
    const edge = record(item)
    if (typeof edge?.child_id === 'string') occupied.add(edge.child_id)
    if (typeof edge?.parent_id === 'string' && edge.parent_id)
      children.delete(String(edge.child_id))
  }
  if (!children.size) return null
  // Re-exporting an imported project must not add another ImportRes wrapper.
  if (children.size === 1) {
    const id = [...children][0]
    if (
      folders.some(
        (folder) => record(folder)?.id === id && record(folder)?.display_name === 'ImportRes'
      )
    )
      return id
  }
  const id = uuid()
  if (!id || occupied.has(id))
    throw new CapShareError('IMPORT_FAILED', 'Colliding import folder ID')
  const timestamp = Math.floor(now / 1000)
  const folder = {
    creation_time: timestamp,
    display_name: 'ImportRes',
    filter_type: 0,
    id,
    import_time: timestamp,
    import_time_us: Math.floor(now * 1000),
    material_color_tag: '',
    sort_sub_type: 0,
    sort_type: 0,
    subdraft_filter_type: 0
  }
  if (!folders.some((item) => record(item)?.id === ''))
    folders.push({
      ...folder,
      id: '',
      display_name: '',
      creation_time: 0,
      import_time: 0,
      import_time_us: 0
    })
  folders.push(folder)
  const linked = new Set<string>()
  for (const item of edges) {
    const edge = record(item)
    if (edge && children.has(String(edge.child_id)) && !edge.parent_id) {
      edge.parent_id = id
      linked.add(String(edge.child_id))
    }
  }
  for (const child of children)
    if (!linked.has(child)) edges.push({ child_id: child, parent_id: id })
  edges.push({ child_id: id, parent_id: '' })
  if (!original)
    documents.set(storeName, {
      relativePath: storeName,
      raw: Buffer.from(JSON.stringify(store)),
      value: store
    })
  return id
}
