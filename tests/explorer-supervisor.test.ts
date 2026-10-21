import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ExplorerConfigurationStore } from '../src/main/sync/configuration'
import { ExplorerSupervisor, type ExplorerWorker } from '../src/main/sync/supervisor'
import type { WorkerCapabilities, WorkerState } from '../src/main/sync/protocol'
import type { WorkerLaunchOptions } from '../src/main/sync/worker-client'

const initial = (): WorkerState => ({
  phase: 'Paused',
  planningOnly: true,
  editorCommands: 0,
  nativeStatus: null,
  nativeReason: null,
  sources: 0,
  pending: 0,
  runtimeEpoch: 0,
  batches: 0,
  configurationRevision: 0,
  inventoryRoots: [],
  watches: [],
  editor: null,
  editorBlocked: true,
  blockedProjects: [],
  work: { FullScans: 0, PartialScans: 0, MetadataEntries: 0, HashedFiles: 0, HashedBytes: 0 },
  readiness: {
    WaitingFiles: 0,
    ScheduledFiles: 0,
    ExhaustedFiles: 0,
    TotalAttempts: 0,
    DeferredFiles: 0
  }
})
class FakeWorker implements ExplorerWorker {
  snapshot: WorkerState = initial()
  fault: string | null = null
  roots: string[] = []
  stopped = 0
  failConfiguration = false
  constructor(readonly callbacks: Pick<WorkerLaunchOptions, 'onState' | 'onFailure'>) {}
  async launch(): Promise<WorkerCapabilities> {
    return {
      planningOnly: true,
      nativeDispatch: false,
      runtimeConfiguration: true,
      maxFrameChars: 32768,
      replayWindow: 256,
      recurringScanTimers: 0,
      nativeObservation: false,
      nativeManaged: false
    }
  }
  async configure(_expected: number, revision: number, roots: string[]): Promise<WorkerState> {
    if (this.failConfiguration) throw new Error('Configuration rejected')
    this.roots = roots
    this.snapshot.configurationRevision = revision
    return this.snapshot
  }
  async run(): Promise<WorkerState> {
    this.emit({
      ...this.snapshot,
      phase: 'Running',
      runtimeEpoch: 1,
      batches: 1,
      watches: this.roots.map((RootPath) => ({ RootPath, Status: 'Watching', Reason: null })),
      inventoryRoots: this.roots.map((RootPath) => ({
        RootPath,
        Available: true,
        Complete: true,
        Files: 2,
        WaitingFiles: 0,
        Warnings: []
      }))
    })
    return this.snapshot
  }
  emit(state: WorkerState): void {
    this.snapshot = state
    this.callbacks.onState?.(state)
  }
  async rescan(): Promise<void> {
    this.emit({ ...this.snapshot, batches: this.snapshot.batches + 1 })
  }
  async session(): Promise<void> {
    await this.rescan()
  }
  async stop(): Promise<void> {
    ++this.stopped
  }
}
let root: string,
  source: string,
  store: ExplorerConfigurationStore,
  owner: ExplorerSupervisor,
  worker: FakeWorker,
  factory: ReturnType<
    typeof vi.fn<
      (callbacks: Pick<WorkerLaunchOptions, 'onState' | 'onFailure'>) => Promise<FakeWorker>
    >
  >
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'wakushare-supervisor-'))
  source = join(root, 'source')
  await mkdir(source)
  store = new ExplorerConfigurationStore(
    join(root, 'private', 'configuration.json'),
    async (path) => path
  )
  factory = vi.fn(async (callbacks) => (worker = new FakeWorker(callbacks)))
  owner = new ExplorerSupervisor({ store, createWorker: factory })
})
afterEach(async () => {
  await owner.close()
  await rm(root, { recursive: true, force: true })
})
async function enable(): Promise<void> {
  await owner.initialize()
  await owner.change(0, { type: 'enabled', enabled: true })
  await owner.change(1, { type: 'add', rootPath: source, scope: 'global' })
}
it('starts no worker while disabled or enabled with no roots, then stops it on switch off', async () => {
  await owner.initialize()
  expect(factory).not.toHaveBeenCalled()
  await owner.change(0, { type: 'enabled', enabled: true })
  expect(factory).not.toHaveBeenCalled()
  const active = await owner.change(1, { type: 'add', rootPath: source, scope: 'global' })
  expect(active.status).toBe('WaitingForAdapter')
  expect(active.indexedFiles).toBe(2)
  const off = await owner.change(active.configuration.revision, { type: 'enabled', enabled: false })
  expect(off.status).toBe('Disabled')
  expect(off.configuration.sources).toHaveLength(1)
  expect(worker.stopped).toBe(1)
})
it('does not stop observation when a renderer subscription is removed', async () => {
  await enable()
  const listener = vi.fn()
  const remove = owner.subscribe(listener)
  remove()
  await worker.rescan()
  expect((await owner.snapshot()).indexedFiles).toBe(2)
  expect(worker.stopped).toBe(0)
  expect(listener).not.toHaveBeenCalled()
})
it('preserves saved choices but closes the worker if configuration is rejected', async () => {
  await enable()
  worker.failConfiguration = true
  const second = join(root, 'second')
  await mkdir(second)
  const result = await owner.change(2, { type: 'add', rootPath: second, scope: 'global' })
  expect(result.status).toBe('Error')
  expect(result.configuration.sources).toHaveLength(2)
  expect(worker.stopped).toBe(1)
  expect(factory).toHaveBeenCalledTimes(1)
})
it('registers independent stable attachments for observed copies with the same draft ID', async () => {
  await enable()
  const emit = (letter: string, sequence: number): void =>
    worker.emit({
      ...worker.snapshot,
      editor: {
        Status: 'Project',
        ProcessId: 123,
        ConnectionId: '11111111-1111-4111-8111-111111111111',
        Generation: sequence,
        Sequence: sequence,
        ViewEpoch: sequence,
        Project: {
          Value: 'project-v1-' + letter.repeat(64),
          DraftId: '11111111-1111-4111-8111-111111111111',
          Location: join(root, letter)
        },
        Reason: null
      }
    })
  emit('a', 1)
  await owner.initialize()
  expect((await owner.snapshot()).currentProject?.key).toBe('project-v1-' + 'a'.repeat(64))
  emit('b', 2)
  await owner.initialize()
  const config = (await owner.snapshot()).configuration
  expect(config.projects).toHaveLength(2)
  expect(config.attachments).toHaveLength(2)
  expect(config.attachments[0].destinationFolderId).not.toBe(
    config.attachments[1].destinationFolderId
  )
  await owner.change(config.revision, { type: 'enabled', enabled: false })
  emit('c', 3)
  expect((await store.read()).projects).toHaveLength(2)
})
it('rejects stale UI revisions without replacing active configuration', async () => {
  await enable()
  await expect(owner.change(0, { type: 'enabled', enabled: false })).rejects.toMatchObject({
    code: 'EXPLORER_CONFIGURATION_CHANGED'
  })
  expect((await owner.snapshot()).configuration.enabled).toBe(true)
  expect(worker.stopped).toBe(0)
})
it('places a product source folder directly in the project root', async () => {
  await enable()
  const project = vi.fn(async () => worker.snapshot)
  Object.assign(worker, { project })
  worker.emit({
    ...worker.snapshot,
    planningOnly: false,
    nativeMode: 'product',
    nativeStatus: 'Verified',
    editorBlocked: false,
    editor: {
      Status: 'Project',
      ProcessId: 123,
      ConnectionId: '11111111-1111-4111-8111-111111111111',
      Generation: 1,
      Sequence: 1,
      ViewEpoch: 1,
      Project: {
        Value: 'project-v1-' + 'd'.repeat(64),
        DraftId: '11111111-1111-4111-8111-111111111111',
        Location: join(root, 'project')
      },
      Reason: null
    }
  })
  await owner.initialize()
  expect(project).toHaveBeenCalledWith('project-v1-' + 'd'.repeat(64), [
    expect.objectContaining({ RootPath: source, ContainerFolderId: '', Name: 'source' })
  ])
})
it('reports a missing packaged runtime while keeping the selected roots', async () => {
  await owner.close()
  owner = new ExplorerSupervisor({ store, createWorker: async () => null })
  await owner.change(0, { type: 'enabled', enabled: true })
  const snapshot = await owner.change(1, { type: 'add', rootPath: source, scope: 'global' })
  expect(snapshot.status).toBe('WaitingForRuntime')
  expect(snapshot.configuration.sources).toHaveLength(1)
})
