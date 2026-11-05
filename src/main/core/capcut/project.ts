import { existsSync } from 'node:fs'
import { readFile, rename, writeFile } from 'node:fs/promises'
import { join, posix } from 'node:path'
import { CapShareError } from '../errors'
import { walkFiles } from '../fsx'
import { DRAFT_PATH_PLACEHOLDER, TIMELINE_FILENAMES, VOLATILE_FILE_PATTERNS } from './constants'
import {
  walkJsonStrings,
  classifyString,
  normalizeSlashes,
  normalizeResourcePath,
  type ScannedString
} from './scanner'

export interface ProjectDocument {
  relativePath: string
  raw: Buffer
  value: Record<string, unknown> | unknown[]
}

export interface TimelineGraph {
  mainId: string
  projectId: string | null
  timelines: { id: string; name: string; relativePath: string }[]
}

/** Preserve every timeline and library entry, including unused compositions.
 * Unreferenced UUID subdraft directories are detached editor leftovers, not
 * library entries. Legacy/unknown directory shapes remain conservative. */
export function portableProjectDocuments(all: Map<string, ProjectDocument>): {
  documents: Map<string, ProjectDocument>
  excludes: (relative: string) => boolean
} {
  const proxy = new Set(['draft_agency_config.json', 'draft_agency_info.json'])
  const subdraft = /^subdraft\/([a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12})(?:\/|$)/i
  const roots = new Set(
    [...all.keys()].flatMap((name) => {
      const match = subdraft.exec(name)
      return match ? [match[1].toLowerCase()] : []
    })
  )
  const reachable = new Set<string>()
  const edges = new Map<string, Set<string>>()
  // Only modern projects have a declared complete timeline index. Inspect all
  // other documents too: metadata/library-only entries and opaque JSON fields
  // can own a composition even when no timeline uses it.
  if (all.has('Timelines/project.json')) {
    for (const [name, doc] of all) {
      if (proxy.has(name)) continue
      const owner = subdraft.exec(name)?.[1].toLowerCase()
      const refs = owner ? (edges.get(owner) ?? new Set<string>()) : reachable
      const collect = (text: string): void => {
        for (const match of text.matchAll(/[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}/gi)) {
          const id = match[0].toLowerCase()
          if (roots.has(id)) refs.add(id)
        }
      }
      collect(JSON.stringify(doc.value)) // Includes UUID-valued object keys.
      walkJsonStrings(doc.value, (value) => {
        collect(value) // Also decodes embedded JSON strings without mutating them.
        return undefined
      })
      if (owner) edges.set(owner, refs)
    }
    const queue = [...reachable]
    for (let i = 0; i < queue.length; i++) {
      for (const id of edges.get(queue[i]) ?? []) {
        if (reachable.has(id)) continue
        reachable.add(id)
        queue.push(id)
      }
    }
  } else {
    for (const id of roots) reachable.add(id)
  }
  const excludes = (relative: string): boolean => {
    if (proxy.has(relative)) return true
    const id = subdraft.exec(relative)?.[1].toLowerCase()
    return id !== undefined && roots.has(id) && !reachable.has(id)
  }
  return {
    documents: new Map([...all].filter(([name]) => !excludes(name))),
    excludes
  }
}

/** A copied compound draft can retain its old project root. Resolve only its
 * packaged UUID documents and native smart-crop caches, never external media. */
export function createProjectReferenceResolver(
  documents: Map<string, ProjectDocument>,
  references: Pick<ScannedString, 'value' | 'pointer'>[],
  resources: ReadonlySet<string> = new Set(),
  projectFolder?: string
): (value: string, pointer: string, document?: string) => string | undefined {
  const names = new Map([...documents.keys()].map((name) => [name.toLowerCase(), name]))
  const roots = new Set<string>()
  const paths = new Map<string, string>()
  const packedNames = new Map([...resources].map((name) => [name.toLowerCase(), name]))
  const documentField =
    /\/(?:materials\/drafts\/\d+\/(?:draft_file_path|draft_config_path)|draft_materials\/\d+\/value\/\d+\/file_Path)$/
  const uuid = '[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}'
  const documentPath = new RegExp(
    `^(.+)/(subdraft/${uuid}/(?:draft_content|draft_info|sub_draft_config)\\.json)$`,
    'i'
  )
  const cachePath = new RegExp(`^smart_crop/${uuid}/[^<>:"|?*]+$`, 'i')
  const coverPath = new RegExp(
    `^(?:(?:subdraft|Timelines)/${uuid}/)?draft_cover\\.(?:jpg|jpeg|png)$`,
    'i'
  )
  const coverField = /\/(?:draft_cover_path|cover_path|draft_cover)$/
  const combinedMedia = new RegExp(
    `^Resources/combination/${uuid}_(?:audio|video)\\.(?:aac|mp4|mov)$`,
    'i'
  )
  for (const ref of references) {
    if (!documentField.test(ref.pointer)) continue
    const normalized = normalizeResourcePath(ref.value)
    if (normalized.startsWith('//') || !/^(?:[a-z]:\/|\/)/i.test(normalized)) continue
    const match = documentPath.exec(normalized)
    const relative = match && names.get(match[2].toLowerCase())
    if (!match || !relative) continue
    roots.add(match[1].toLowerCase())
    paths.set(normalized.toLowerCase(), relative)
  }
  return (value, pointer, document = '') => {
    const normalized = normalizeResourcePath(value),
      key = normalized.toLowerCase()
    if (documentField.test(pointer)) return paths.get(key)
    // Generated project/compound/timeline thumbnails are optional, regardless
    // of the native local path spelling. Real media paths never use this rule.
    if (coverField.test(pointer)) {
      const item = classifyString(value, { draftFolderJson: projectFolder })
      const relative =
        item.cls === 'placeholder' && normalized.startsWith(DRAFT_PATH_PLACEHOLDER + '/')
          ? normalized.slice(DRAFT_PATH_PLACEHOLDER.length + 1)
          : item.cls === 'draft-internal'
            ? item.draftRelative
            : item.cls === 'relative'
              ? /^\.{1,2}\//.test(normalized)
                ? posix.normalize(posix.join(posix.dirname(document), normalized))
                : normalized
              : undefined
      if (relative && coverPath.test(relative)) return packedNames.get(relative.toLowerCase()) ?? ''
    }
    for (const root of roots) {
      if (!key.startsWith(root + '/')) continue
      const relative = normalized.slice(root.length + 1)
      const packaged = packedNames.get(relative.toLowerCase())
      if (/\/materials\/smart_crops\/\d+\/cache_path$/.test(pointer) && cachePath.test(relative))
        return relative
      if (coverField.test(pointer) && coverPath.test(relative)) return packaged ?? ''
      if (
        /\/materials\/(?:audios|videos)\/\d+\/path$/.test(pointer) &&
        combinedMedia.test(relative) &&
        packaged
      )
        return packaged
    }
    return undefined
  }
}

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

/** Read every working JSON, including subdrafts, inline drafts and modern mirrors. */
export async function readProjectDocuments(folder: string): Promise<Map<string, ProjectDocument>> {
  const modern = existsSync(join(folder, 'Timelines', 'project.json'))
  const documents = new Map<string, ProjectDocument>()
  let documentBytes = 0
  for await (const file of walkFiles(folder)) {
    const name = file.relPath.split('/').pop()!
    const template = /^template(-\d+)?\.tmp$/i.test(name)
    if (!file.relPath.endsWith('.json') && !(modern && template)) continue
    if (VOLATILE_FILE_PATTERNS.some((re) => re.test(name)) && !template) continue
    documentBytes += file.size
    if (
      file.size > 100 * 1024 * 1024 ||
      documentBytes > 512 * 1024 ** 2 ||
      documents.size > 10000
    ) {
      throw new CapShareError('DRAFT_UNREADABLE', `Project document is too large: ${file.relPath}`)
    }
    const raw = await readFile(file.absPath)
    if (raw.length === 0) continue // CapCut writes an empty draft_biz_config.json.
    let value: unknown
    try {
      value = JSON.parse(raw.toString('utf8').replace(/^\uFEFF/, ''))
    } catch {
      throw new CapShareError(
        'DRAFT_UNREADABLE',
        `Cannot inspect project document: ${file.relPath}`
      )
    }
    if (value !== null && typeof value === 'object') {
      documents.set(file.relPath, {
        relativePath: file.relPath,
        raw,
        value: value as ProjectDocument['value']
      })
    }
  }
  return documents
}

/** An inconsistent project must fail before it can enter CapCut's project list. */
export function validateTimelineGraph(
  documents: Map<string, ProjectDocument>
): TimelineGraph | null {
  const manifest = documents.get('Timelines/project.json')
  if (!manifest) return null // Legacy single-document draft.
  const fail = (message: string): never => {
    throw new CapShareError('DRAFT_UNREADABLE', `Timeline graph is inconsistent: ${message}`)
  }
  const project = object(manifest.value)
  const mainId = project['main_timeline_id']
  if (typeof mainId !== 'string' || !Array.isArray(project['timelines']))
    fail('missing timeline index')
  const timelines: TimelineGraph['timelines'] = []
  const declared = new Set<string>()
  for (const item of project['timelines'] as unknown[]) {
    const entry = object(item)
    const id = entry['id']
    if (typeof id !== 'string' || !/^[\w-]+$/.test(id) || declared.has(id))
      fail('invalid/duplicate timeline ID')
    declared.add(id as string)
    if (entry['is_marked_delete'] === true) continue
    const relativePath = TIMELINE_FILENAMES.map((name) => `Timelines/${id}/${name}`).find((name) =>
      documents.has(name)
    )
    if (!relativePath || object(documents.get(relativePath)!.value)['id'] !== id) {
      fail(`document ID does not match directory ${id}`)
    }
    timelines.push({
      id: id as string,
      name: String(entry['name'] ?? ''),
      relativePath: relativePath!
    })
  }
  if (!timelines.some((t) => t.id === mainId)) fail('main timeline is not declared')
  for (const filename of TIMELINE_FILENAMES) {
    const root = documents.get(filename)
    if (root && object(root.value)['id'] !== mainId)
      fail(`${filename} does not match main_timeline_id`)
  }
  for (const relativePath of documents.keys()) {
    const match = /^Timelines\/([^/]+)\/draft_(?:content|info)\.json$/.exec(relativePath)
    if (match && !declared.has(match[1])) fail(`undeclared timeline directory ${match[1]}`)
  }
  const layout = object(documents.get('timeline_layout.json')?.value)
  if (Array.isArray(layout['dockItems'])) {
    for (const item of layout['dockItems']) {
      const ids = object(item)['timelineIds']
      if (Array.isArray(ids) && ids.some((id) => typeof id !== 'string' || !declared.has(id))) {
        fail('layout refers to an undeclared timeline')
      }
    }
  }
  return {
    mainId: mainId as string,
    projectId: typeof project['id'] === 'string' ? project['id'] : null,
    timelines
  }
}

/** Only discovered top-level identity tokens are remapped; material/segment IDs survive. */
export async function cloneTimelineGraph(
  folder: string,
  documents: Map<string, ProjectDocument>,
  newMainId: string | null,
  uuid: () => string
): Promise<Map<string, string>> {
  const graph = validateTimelineGraph(documents)
  const ids = new Map<string, string>()
  if (!newMainId) return ids
  if (!graph) {
    for (const filename of TIMELINE_FILENAMES) {
      const doc = documents.get(filename)
      if (doc) object(doc.value)['id'] = newMainId
    }
    return ids
  }
  ids.set(graph.mainId, newMainId)
  for (const timeline of graph.timelines) {
    if (!ids.has(timeline.id)) ids.set(timeline.id, uuid())
  }
  if (graph.projectId && !ids.has(graph.projectId)) ids.set(graph.projectId, uuid())
  const values = [...ids.values()]
  if (
    values.some((id) => typeof id !== 'string' || !/^[\w-]+$/.test(id) || ids.has(id)) ||
    new Set(values).size !== values.length
  ) {
    throw new CapShareError('IMPORT_FAILED', 'Invalid or colliding IDs for the project copy')
  }
  for (const doc of documents.values()) {
    walkJsonStrings(doc.value, (value) => {
      if (value.trimStart().startsWith('{') || value.trimStart().startsWith('[')) return undefined
      const direct = ids.get(value)
      if (direct) return direct
      const normalized = normalizeSlashes(value)
      const updated = normalized.replace(
        /(^|\/)Timelines\/([^/]+)(?=\/|$)/g,
        (match, prefix: string, id: string) =>
          ids.has(id) ? `${prefix}Timelines/${ids.get(id)}` : match
      )
      return updated !== normalized ? updated : undefined
    })
  }
  for (const timeline of graph.timelines) {
    await rename(
      join(folder, 'Timelines', timeline.id),
      join(folder, 'Timelines', ids.get(timeline.id)!)
    )
  }
  for (const [relativePath, doc] of [...documents]) {
    const match = /^Timelines\/([^/]+)\//.exec(relativePath)
    if (match && ids.has(match[1])) {
      documents.delete(relativePath)
      doc.relativePath = relativePath.replace(
        `Timelines/${match[1]}/`,
        `Timelines/${ids.get(match[1])}/`
      )
      documents.set(doc.relativePath, doc)
    }
  }
  return ids
}

export async function writeProjectDocuments(
  folder: string,
  documents: Map<string, ProjectDocument>
): Promise<void> {
  for (const doc of documents.values()) {
    await writeFile(join(folder, doc.relativePath), JSON.stringify(doc.value))
  }
}
