import { existsSync } from 'node:fs'
import { readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { CapShareError } from '../errors'
import { walkFiles } from '../fsx'
import { TIMELINE_FILENAMES, VOLATILE_FILE_PATTERNS } from './constants'
import { walkJsonStrings, normalizeSlashes } from './scanner'

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

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

/** Read every working JSON, including subdrafts, inline drafts and modern mirrors. */
export async function readProjectDocuments(folder: string): Promise<Map<string, ProjectDocument>> {
  const modern = existsSync(join(folder, 'Timelines', 'project.json'))
  const documents = new Map<string, ProjectDocument>()
  for await (const file of walkFiles(folder)) {
    const name = file.relPath.split('/').pop()!
    const template = /^template(-\d+)?\.tmp$/i.test(name)
    if (!file.relPath.endsWith('.json') && !(modern && template)) continue
    if (VOLATILE_FILE_PATTERNS.some((re) => re.test(name)) && !template) continue
    if (file.size > 100 * 1024 * 1024) {
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
