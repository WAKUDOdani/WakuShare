import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  ExplorerConfigurationStore,
  effectiveSources,
  observableRoots
} from '../src/main/sync/configuration'
import { ExplorerSourcePolicy } from '../src/main/sync/source-policy'

let root: string,
  sources: string,
  privateRoot: string,
  file: string,
  store: ExplorerConfigurationStore
const project = (
  letter: string,
  location: string
): { key: string; draftId: string; location: string; name: string } => ({
  key: 'project-v1-' + letter.repeat(64),
  draftId: '11111111-1111-4111-8111-111111111111',
  location,
  name: 'Test project'
})
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'wakushare-explorer-config-'))
  sources = join(root, 'sources')
  privateRoot = join(root, 'private')
  file = join(privateRoot, 'config.json')
  await mkdir(sources)
  await mkdir(privateRoot)
  const policy = new ExplorerSourcePolicy([privateRoot], async () => {})
  store = new ExplorerConfigurationStore(file, (path) => policy.resolve(path))
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('Explorer durable configuration', () => {
  it('starts disabled without creating state or watchers', async () => {
    expect(await store.read()).toMatchObject({ enabled: false, revision: 0, sources: [] })
    await expect(readFile(file)).rejects.toMatchObject({ code: 'ENOENT' })
  })
  it('keeps one source and its ID for an exact repeat', async () => {
    const first = await store.add(0, { rootPath: sources })
    const repeated = await store.add(first.revision, { rootPath: sources })
    expect(repeated).toEqual(first)
    expect(repeated.sources).toHaveLength(1)
  })
  it('gives each copied project independent destination IDs for the same global root', async () => {
    await store.add(0, { rootPath: sources })
    await store.registerProject(project('a', join(root, 'project-a')))
    const config = await store.registerProject(project('b', join(root, 'project-b')))
    expect(config.attachments).toHaveLength(2)
    expect(
      new Set(config.attachments.map((attachment) => attachment.destinationFolderId)).size
    ).toBe(2)
    expect(new Set(config.projects.map((project) => project.containerFolderId)).size).toBe(2)
  })
  it('allows equal local roots in separate projects and watches the physical root once', async () => {
    await store.registerProject(project('a', join(root, 'project-a')))
    let config = await store.registerProject(project('b', join(root, 'project-b')))
    config = await store.add(config.revision, {
      rootPath: sources,
      projectKey: project('a', '').key
    })
    config = await store.add(config.revision, {
      rootPath: sources,
      projectKey: project('b', '').key
    })
    config = await store.enabled(config.revision, true)
    expect(effectiveSources(config, project('a', '').key)).toHaveLength(1)
    expect(effectiveSources(config, project('b', '').key)).toHaveLength(1)
    expect(observableRoots(config)).toHaveLength(1)
  })
  it('rejects a local/global intersection without changing the saved configuration', async () => {
    const nested = join(sources, 'nested')
    await mkdir(nested)
    await store.registerProject(project('a', join(root, 'project-a')))
    const config = await store.add(1, { rootPath: sources })
    const before = await readFile(file)
    await expect(
      store.add(config.revision, { rootPath: nested, projectKey: project('a', '').key })
    ).rejects.toMatchObject({ code: 'EXPLORER_SOURCE_OVERLAP' })
    expect(await readFile(file)).toEqual(before)
  })
  it('persists a per-project pause without pausing another project', async () => {
    const added = await store.add(0, { rootPath: sources })
    await store.registerProject(project('a', join(root, 'a')))
    const config = await store.registerProject(project('b', join(root, 'b')))
    await store.projectOverride(config.revision, added.sources[0].id, project('a', '').key, false)
    const restored = await new ExplorerConfigurationStore(file, async (path) => path).read()
    expect(effectiveSources(restored, project('a', '').key)).toHaveLength(0)
    expect(effectiveSources(restored, project('b', '').key)).toHaveLength(1)
  })
  it('retains source and destination ownership when detached and reconnected', async () => {
    await writeFile(join(sources, 'a.png'), 'original')
    let config = await store.add(0, { rootPath: sources })
    config = await store.registerProject(project('a', join(root, 'a')))
    const source = config.sources[0]
    const attachment = config.attachments[0]
    config = await store.source(config.revision, source.id, { detached: true })
    config = await store.add(config.revision, { rootPath: sources })
    expect(config.sources[0].id).toBe(source.id)
    expect(config.sources[0].detached).toBe(false)
    expect(config.attachments[0]).toEqual(attachment)
    expect(await readFile(join(sources, 'a.png'), 'utf8')).toBe('original')
  })
  it('preserves enabled preference and all ownership while the main switch is off', async () => {
    let config = await store.add(0, { rootPath: sources })
    config = await store.registerProject(project('a', join(root, 'a')))
    config = await store.enabled(config.revision, true)
    expect((await new ExplorerConfigurationStore(file, async (path) => path).read()).enabled).toBe(
      true
    )
    const off = await store.enabled(config.revision, false)
    expect(off.attachments).toEqual(config.attachments)
    expect(observableRoots(off)).toEqual([])
  })
  it('serializes competing edits and rejects the stale revision', async () => {
    const results = await Promise.allSettled([
      store.enabled(0, true),
      store.add(0, { rootPath: sources })
    ])
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1)
  })
  it('does not overwrite an external writer or replace corrupt configuration with defaults', async () => {
    let config = await store.add(0, { rootPath: sources })
    config = { ...config, revision: 99 }
    const external = JSON.stringify(config)
    await writeFile(file, external)
    await expect(store.enabled(1, true)).rejects.toMatchObject({
      code: 'EXPLORER_CONFIGURATION_CHANGED'
    })
    expect(await readFile(file, 'utf8')).toBe(external)
    await writeFile(file, '{broken')
    await expect(
      new ExplorerConfigurationStore(file, async (path) => path).read()
    ).rejects.toMatchObject({ code: 'EXPLORER_CONFIGURATION_UNREADABLE' })
    expect(await readFile(file, 'utf8')).toBe('{broken')
  })
  it('rejects a linked root or ancestor and protects the private state tree', async () => {
    const link = join(root, 'linked')
    await symlink(sources, link, process.platform === 'win32' ? 'junction' : 'dir')
    const policy = new ExplorerSourcePolicy([privateRoot], async () => {})
    await expect(policy.resolve(link)).rejects.toMatchObject({ code: 'EXPLORER_LINKED_SOURCE' })
    await expect(policy.resolve(root)).rejects.toMatchObject({ code: 'EXPLORER_PROTECTED_SOURCE' })
    await expect(policy.resolve(privateRoot)).rejects.toMatchObject({
      code: 'EXPLORER_PROTECTED_SOURCE'
    })
    await expect(policy.resolve('\\\\server\\share')).rejects.toMatchObject({
      code: 'EXPLORER_LOCAL_SOURCE_REQUIRED'
    })
  })
  it.skipIf(process.platform !== 'win32')(
    'checks an actual local Windows volume only when adding a source',
    async () => {
      const policy = new ExplorerSourcePolicy([privateRoot])
      expect(await policy.resolve(sources)).toBe(sources)
    }
  )
})
