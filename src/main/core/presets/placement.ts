import { randomUUID } from 'node:crypto'
import type { PresetImportOptions, PresetNode } from '../../../shared/types'
import { uniqueName } from '../fsx'
import { CapShareError } from '../errors'

export interface Placement {
  ids: Map<string, string>
  names: Map<string, string>
  parents: Map<string, string | null>
  folders: { sourceId: string; name: string; action: 'merge' | 'create'; targetId: string }[]
  wrapper: PresetNode | null
}
const same = (a: string, b: string): boolean =>
  a.normalize('NFC').toLowerCase() === b.normalize('NFC').toLowerCase()
export function placeFolders(
  source: PresetNode[],
  existing: PresetNode[],
  options: PresetImportOptions
): Placement {
  let target = options.targetFolderId ?? null
  if (target && !existing.some((node) => node.id === target && node.kind === 'folder'))
    throw new CapShareError(
      'IMPORT_FAILED',
      'The destination folder no longer exists. Refresh the library.'
    )
  const result: Placement = {
    ids: new Map(),
    names: new Map(),
    parents: new Map(),
    folders: [],
    wrapper: null
  }
  const known = [...existing]
  const folder = (
    name: string,
    parent: string | null
  ): { id: string; name: string; action: 'merge' | 'create' } => {
    const siblings = known.filter((node) => node.kind === 'folder' && node.parentId === parent)
    const matches = siblings.filter((node) => same(node.name, name))
    if (options.folderMode !== 'copies' && matches.length > 1)
      throw new CapShareError(
        'IMPORT_FAILED',
        `Several destination folders are named ${name}. Choose a specific destination or create folder copies.`
      )
    if (options.folderMode !== 'copies' && matches.length === 1)
      return { id: matches[0].id, name: matches[0].name, action: 'merge' }
    const unique = uniqueName(name, new Set(siblings.map((node) => node.name))),
      id = randomUUID().toUpperCase()
    known.push({ id, name: unique, kind: 'folder', parentId: parent })
    return { id, name: unique, action: 'create' }
  }
  if (options.newFolderName?.trim()) {
    const placed = folder(options.newFolderName.trim(), target)
    if (placed.action === 'create')
      result.wrapper = { id: placed.id, name: placed.name, kind: 'folder', parentId: target }
    target = placed.id
  }
  const visit = (node: PresetNode): void => {
    if (result.ids.has(node.id)) return
    const parent = source.find((parent) => parent.id === node.parentId)
    if (parent) visit(parent)
    const parentId = node.parentId ? result.ids.get(node.parentId)! : target
    result.parents.set(node.id, parentId)
    if (node.kind === 'folder') {
      const placed = folder(node.name, parentId)
      result.ids.set(node.id, placed.id)
      result.names.set(node.id, placed.name)
      result.folders.push({
        sourceId: node.id,
        name: placed.name,
        action: placed.action,
        targetId: placed.id
      })
    }
  }
  source.filter((node) => node.kind === 'folder').forEach(visit)
  for (const node of source.filter((node) => node.kind === 'preset'))
    result.parents.set(node.id, node.parentId ? result.ids.get(node.parentId)! : target)
  return result
}
