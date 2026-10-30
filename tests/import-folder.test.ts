import { expect, it } from 'vitest'
import { groupImportedMedia } from '../src/main/core/capcut/import-folder'
import type { ProjectDocument } from '../src/main/core/capcut/project'

function documents(values: Record<string, unknown>): Map<string, ProjectDocument> {
  return new Map(
    Object.entries(values).map(([relativePath, value]) => [
      relativePath,
      {
        relativePath,
        value: value as ProjectDocument['value'],
        raw: Buffer.from(JSON.stringify(value))
      }
    ])
  )
}
it('wraps library roots while preserving inner folders, material IDs, labels and clip edits', () => {
  const store = {
    unknown: 42,
    draft_virtual_store: [
      {
        type: 0,
        value: [
          { id: '', display_name: '' },
          { id: 'folder', display_name: 'Manual folder', custom: true }
        ]
      },
      {
        type: 1,
        value: [
          { child_id: 'folder', parent_id: '' },
          { child_id: 'nested', parent_id: 'folder' },
          { child_id: 'root-media', parent_id: '' },
          { child_id: 'service', parent_id: '' }
        ]
      },
      { type: 7, value: ['keep unknown'] }
    ]
  }
  const meta = {
    draft_materials: [
      {
        type: 0,
        value: [
          { id: 'nested', file_Path: './Resources/local/a.png', extra_info: 'Manual label' },
          { id: 'root-media', file_Path: './Resources/local/b.png' },
          { id: 'unlinked', file_Path: './Resources/local/c.png' },
          { id: 'service', file_Path: '', metetype: 'none' }
        ]
      }
    ]
  }
  const timeline = {
    tracks: [
      { segments: [{ material_id: 'material', local_material_id: 'nested', custom: { edit: 5 } }] }
    ]
  }
  const docs = documents({
    'draft_meta_info.json': meta,
    'draft_virtual_store.json': store,
    'draft_content.json': timeline
  })
  const originals = JSON.stringify({ meta, timeline })
  expect(groupImportedMedia(docs, () => 'wrapper', 100000)).toBe('wrapper')
  expect(store.draft_virtual_store[1].value).toEqual([
    { child_id: 'folder', parent_id: 'wrapper' },
    { child_id: 'nested', parent_id: 'folder' },
    { child_id: 'root-media', parent_id: 'wrapper' },
    { child_id: 'service', parent_id: '' },
    { child_id: 'unlinked', parent_id: 'wrapper' },
    { child_id: 'wrapper', parent_id: '' }
  ])
  expect(JSON.stringify({ meta, timeline })).toBe(originals)
  const beforeAgain = JSON.stringify(store)
  expect(
    groupImportedMedia(docs, () => {
      throw Error('Must reuse wrapper')
    })
  ).toBe('wrapper')
  expect(JSON.stringify(store)).toBe(beforeAgain)
})
it('creates the native hierarchy when an older package has only media metadata', () => {
  const docs = documents({
    'draft_meta_info.json': {
      draft_materials: [{ type: 0, value: [{ id: 'media', file_Path: './source.mp4' }] }]
    }
  })
  expect(groupImportedMedia(docs, () => 'wrapper')).toBe('wrapper')
  expect(JSON.stringify(docs.get('draft_virtual_store.json')!.value)).toContain('ImportRes')
})
