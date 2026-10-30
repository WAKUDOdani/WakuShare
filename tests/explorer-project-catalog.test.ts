import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { afterEach, expect, it } from 'vitest'
import { explorerProjectKey, listExplorerProjects } from '../src/main/sync/project-catalog'

const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})
async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'wakushare-project-catalog-'))
  roots.push(root)
  return root
}
it('lists closed projects from metadata without reading their timelines or media', async () => {
  const root = await fixture(),
    folder = join(root, 'Client project'),
    draftId = randomUUID()
  await mkdir(folder)
  await writeFile(
    join(folder, 'draft_meta_info.json'),
    JSON.stringify({ draft_id: draftId, draft_name: 'Client A' })
  )
  await writeFile(join(folder, 'draft_content.json'), 'unreadable encrypted timeline')
  const projects = await listExplorerProjects(root, [])
  expect(projects).toMatchObject([
    {
      name: 'Client A',
      draftId: draftId.toUpperCase(),
      location: folder,
      key: explorerProjectKey(draftId, folder)
    }
  ])
})
it('uses a unique matching CapCut registry entry for encrypted metadata', async () => {
  const root = await fixture(),
    folder = join(root, 'Encrypted'),
    draftId = randomUUID()
  await mkdir(folder)
  await writeFile(join(folder, 'draft_meta_info.json'), 'encrypted')
  await writeFile(
    join(root, 'root_meta_info.json'),
    JSON.stringify({
      all_draft_store: [
        { draft_fold_path: folder, draft_id: draftId, draft_name: 'Encrypted project' }
      ]
    })
  )
  expect(await listExplorerProjects(root, [])).toMatchObject([
    { name: 'Encrypted project', draftId: draftId.toUpperCase() }
  ])
  await writeFile(
    join(root, 'root_meta_info.json'),
    JSON.stringify({
      all_draft_store: [draftId, randomUUID()].map((id) => ({
        draft_fold_path: folder,
        draft_id: id
      }))
    })
  )
  expect(await listExplorerProjects(root, [])).toEqual([])
})
it('keeps known external projects and refuses arbitrary registry paths and linked folders', async () => {
  const root = await fixture(),
    external = await fixture(),
    id = randomUUID(),
    folder = join(external, 'Known')
  await mkdir(folder)
  await writeFile(join(folder, 'draft_meta_info.json'), 'encrypted')
  const known = {
    key: explorerProjectKey(id, folder),
    draftId: id,
    location: folder,
    name: 'External',
    containerFolderId: randomUUID()
  }
  await writeFile(
    join(root, 'root_meta_info.json'),
    JSON.stringify({ all_draft_store: [{ draft_fold_path: folder, draft_id: id }] })
  )
  expect(await listExplorerProjects(root, [])).toEqual([])
  await symlink(folder, join(root, 'Linked'), process.platform === 'win32' ? 'junction' : 'dir')
  expect(await listExplorerProjects(root, [])).toEqual([])
  expect(await listExplorerProjects(root, [known])).toMatchObject([{ key: known.key }])
})
it('prefers the observed SDK identity over stale encrypted-project registry metadata', async () => {
  const root = await fixture(),
    folder = join(root, 'Encrypted'),
    id = randomUUID()
  await mkdir(folder)
  await writeFile(join(folder, 'draft_meta_info.json'), 'encrypted')
  await writeFile(
    join(root, 'root_meta_info.json'),
    JSON.stringify({
      all_draft_store: [
        { draft_fold_path: folder, draft_id: randomUUID(), draft_name: 'Stale name' }
      ]
    })
  )
  const known = {
    key: explorerProjectKey(id, folder),
    draftId: id,
    location: folder,
    name: 'Observed name',
    containerFolderId: randomUUID()
  }
  expect(await listExplorerProjects(root, [known])).toMatchObject([
    { key: known.key, draftId: id.toUpperCase(), name: known.name }
  ])
})
