import { mkdtemp, mkdir, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { ExplorerConfigurationStore, effectiveSources } from '../src/main/sync/configuration'
import { ExplorerSupervisor } from '../src/main/sync/supervisor'
import { projectFolderChoices } from '../src/shared/explorer-folders'

const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})
it('prepares any catalog project while synchronization is off, without creating a worker or touching project files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'wakushare-offline-settings-'))
  roots.push(root)
  const media = join(root, 'media')
  await mkdir(media)
  const candidate = {
    key: 'project-v1-' + 'a'.repeat(64),
    draftId: randomUUID(),
    location: join(root, 'closed-project'),
    name: 'Client A'
  }
  const file = join(root, 'private/configuration.json'),
    store = new ExplorerConfigurationStore(file, async (path) => path)
  const createWorker = vi.fn(async () => null)
  const owner = new ExplorerSupervisor({
    store,
    createWorker,
    listProjects: async () => [candidate]
  })
  expect(await owner.projects()).toEqual([candidate])
  await expect(readFile(file)).rejects.toMatchObject({ code: 'ENOENT' })
  const result = await owner.change(0, {
    type: 'add',
    scope: 'project',
    rootPath: media,
    expectedProjectKey: candidate.key
  })
  expect(result.currentProject).toBeNull()
  expect(effectiveSources(result.configuration, candidate.key)).toHaveLength(1)
  expect(createWorker).not.toHaveBeenCalled()
  await expect(
    owner.change(result.configuration.revision, {
      type: 'add',
      scope: 'project',
      rootPath: media,
      expectedProjectKey: 'project-v1-' + 'b'.repeat(64)
    })
  ).rejects.toMatchObject({ code: 'EXPLORER_NO_PROJECT' })
  await expect(readFile(join(candidate.location, 'draft_meta_info.json'))).rejects.toMatchObject({
    code: 'ENOENT'
  })
  await owner.close()
})
it('deduplicates reusable folders and prefers the selected project without including common folders in its switches', () => {
  const a = 'project-v1-' + 'a'.repeat(64),
    b = 'project-v1-' + 'b'.repeat(64)
  const source = {
    id: randomUUID(),
    label: 'Client folder',
    rootPath: 'C:/Client',
    scope: 'project' as const,
    projectKey: a,
    enabled: true,
    detached: false
  }
  const owned = {
    ...source,
    id: randomUUID(),
    projectKey: b,
    rootPath: 'c:\\Client',
    enabled: false
  }
  const common = {
    ...source,
    id: randomUUID(),
    rootPath: 'C:/Common',
    scope: 'global' as const,
    projectKey: null
  }
  const config = {
    schemaVersion: 1 as const,
    revision: 0,
    enabled: true,
    projects: [],
    attachments: [],
    overrides: [],
    sources: [source, owned, common]
  }
  expect(projectFolderChoices(config, b)).toEqual([{ source: owned, enabled: false }])
  expect(projectFolderChoices(config, a)).toEqual([{ source, enabled: true }])
  expect(effectiveSources(config, b)).toEqual([common])
})
