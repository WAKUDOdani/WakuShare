import { randomUUID } from 'node:crypto'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  cloneTimelineGraph,
  readProjectDocuments,
  validateTimelineGraph,
  writeProjectDocuments
} from '../src/main/core/capcut/project'

let folder: string
let ids: string[]
function write(rel: string, value: unknown): void {
  const path = join(folder, rel)
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, JSON.stringify(value))
}
beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), 'capshare-multitimeline-'))
  ids = Array.from({ length: 4 }, () => randomUUID().toUpperCase())
  const timelines = ids.map((id, i) => ({
    id,
    name: '',
    duration: (i + 1) * 1000000,
    tracks: [
      {
        id: `track-${i}`,
        type: 'video',
        segments: [{ id: `clip-${i}`, material_id: `media-${i}`, custom: { untouched: 42 } }]
      }
    ],
    materials: { videos: [{ id: `media-${i}`, path: `C:/media/${i}.mp4` }] },
    unknown_future_field: { nested: ['preserve', i] }
  }))
  write('draft_content.json', timelines[0])
  timelines.forEach((t) => write(`Timelines/${t.id}/draft_content.json`, t))
  write('Timelines/project.json', {
    id: randomUUID().toUpperCase(),
    main_timeline_id: ids[0],
    timelines: ids.map((id, i) => ({ id, name: String(i + 13), is_marked_delete: false }))
  })
  write('timeline_layout.json', {
    dockItems: [{ ratio: 1, timelineIds: ids, timelineNames: ['13', '14', '15', '16'] }]
  })
  write(`Timelines/${ids[0]}/attachment/patch/mini_draft.json`, {
    id: ids[0],
    tracks: timelines[0].tracks
  })
  write('subdraft/independent/draft_content.json', {
    id: 'independent',
    encoded: JSON.stringify({ timeline_id: ids[2], path: `./Timelines/${ids[2]}/cover.jpg` })
  })
})
afterEach(() => rmSync(folder, { recursive: true, force: true }))

describe('modern timeline graph', () => {
  it('clones all identities, directories, layout and embedded references without changing the edit', async () => {
    const documents = await readProjectDocuments(folder)
    const before = structuredClone([...documents].map(([key, d]) => [key, d.value]))
    const main = randomUUID().toUpperCase()
    const mapping = await cloneTimelineGraph(folder, documents, main, () =>
      randomUUID().toUpperCase()
    )
    await writeProjectDocuments(folder, documents)
    const reread = await readProjectDocuments(folder)
    const graph = validateTimelineGraph(reread)!
    expect(graph.mainId).toBe(main)
    expect(graph.timelines.map((t) => t.name)).toEqual(['13', '14', '15', '16'])
    expect(graph.timelines).toHaveLength(4)
    for (let i = 0; i < ids.length; i++) {
      const oldRel = `Timelines/${ids[i]}/draft_content.json`
      const original = before.find(([key]) => key === oldRel)![1] as Record<string, unknown>
      const doc = reread.get(`Timelines/${mapping.get(ids[i])}/draft_content.json`)!
        .value as Record<string, unknown>
      expect(doc['tracks']).toEqual(original['tracks'])
      expect(doc['materials']).toEqual(original['materials'])
      expect(doc['unknown_future_field']).toEqual(original['unknown_future_field'])
      expect(doc['id']).toBe(mapping.get(ids[i]))
      expect(reread.has(oldRel)).toBe(false)
    }
    const layout = reread.get('timeline_layout.json')!.value as {
      dockItems: { timelineIds: string[]; timelineNames: string[] }[]
    }
    expect(layout.dockItems[0].timelineIds).toEqual(ids.map((id) => mapping.get(id)))
    expect(layout.dockItems[0].timelineNames).toEqual(['13', '14', '15', '16'])
    const sub = JSON.parse(
      readFileSync(join(folder, 'subdraft/independent/draft_content.json'), 'utf8')
    )
    expect(sub.id).toBe('independent')
    expect(JSON.parse(sub.encoded).timeline_id).toBe(mapping.get(ids[2]))
    expect(JSON.parse(sub.encoded).path).toContain(`/Timelines/${mapping.get(ids[2])}/`)
  })

  it('rejects the exact stale-main-ID failure observed in 1012 4', async () => {
    const root = JSON.parse(readFileSync(join(folder, 'draft_content.json'), 'utf8'))
    root.id = randomUUID().toUpperCase()
    write('draft_content.json', root)
    const documents = await readProjectDocuments(folder)
    expect(() => validateTimelineGraph(documents)).toThrow('main_timeline_id')
  })

  it('rejects an undeclared empty timeline and an unknown layout tab', async () => {
    write('Timelines/orphan/draft_content.json', { id: 'orphan', tracks: [] })
    let documents = await readProjectDocuments(folder)
    expect(() => validateTimelineGraph(documents)).toThrow('undeclared timeline')
    rmSync(join(folder, 'Timelines/orphan'), { recursive: true })
    write('timeline_layout.json', { dockItems: [{ timelineIds: ['orphan'] }] })
    documents = await readProjectDocuments(folder)
    expect(() => validateTimelineGraph(documents)).toThrow('undeclared timeline')
  })
})
