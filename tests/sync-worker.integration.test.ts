import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { expect, it } from 'vitest'
import { ExplorerWorkerClient } from '../src/main/sync/worker-client'
import type { WorkerState } from '../src/main/sync/protocol'
import { ExplorerConfigurationStore } from '../src/main/sync/configuration'
import { ExplorerSupervisor } from '../src/main/sync/supervisor'

// Opt-in developer runtime; no installed WakuShare/CapCut or user state is used.
it.skipIf(!process.env.WAKUSHARE_EVENT_WORKER)(
  'exchanges real worker events through the WakuShare main client',
  async () => {
    const folder = await mkdtemp(join(tmpdir(), 'wakushare-worker-test-'))
    if (dirname(folder) !== resolve(tmpdir())) throw new Error('Unexpected temporary test location')
    const source = join(folder, 'sources')
    await mkdir(source)
    const image = join(source, 'a.png')
    await writeFile(image, 'before')
    const stateFile = join(folder, 'state.json')
    await writeFile(
      stateFile,
      JSON.stringify({
        SchemaVersion: 1,
        Bindings: [
          {
            Id: randomUUID(),
            ProjectId: 'synthetic-main-client',
            MediaFolderId: randomUUID(),
            RootPath: source
          }
        ],
        Sources: [],
        Pending: []
      })
    )
    const listeners = new Set<(state: WorkerState) => void>()
    const client = new ExplorerWorkerClient({
      executable: process.env.WAKUSHARE_EVENT_WORKER!,
      stateFile,
      onState: (state) => {
        for (const listener of listeners) listener(state)
      }
    })
    function waitFor(predicate: (state: WorkerState) => boolean): Promise<WorkerState> {
      if (client.snapshot && predicate(client.snapshot)) return Promise.resolve(client.snapshot)
      return new Promise((yes, no) => {
        const timeout = setTimeout(() => {
          listeners.delete(check)
          no(new Error('Expected worker event'))
        }, 5000)
        const check = (state: WorkerState): void => {
          if (predicate(state)) {
            clearTimeout(timeout)
            listeners.delete(check)
            yes(state)
          }
        }
        listeners.add(check)
      })
    }
    try {
      const capabilities = await client.launch()
      expect(capabilities.nativeDispatch).toBe(false)
      await client.run()
      const initial = await waitFor((state) => state.batches === 1)
      expect(initial.work.FullScans).toBe(1)
      const before = await readFile(stateFile)
      await new Promise((done) => setTimeout(done, 200))
      expect(await readFile(stateFile)).toEqual(before)
      await writeFile(image, 'after')
      const changed = await waitFor((state) => state.work.PartialScans > initial.work.PartialScans)
      expect(changed.work.FullScans).toBe(initial.work.FullScans)
      expect(changed.work.HashedBytes - initial.work.HashedBytes).toBe(5)
      await client.stop()
      expect(client.fault).toBeNull()
    } finally {
      await client.stop()
      await rm(folder, { recursive: true, force: true })
    }
  },
  15000
)

it.skipIf(!process.env.WAKUSHARE_EVENT_WORKER)(
  'owns a real unbound watcher across navigation, changes and main-switch restart',
  async () => {
    const folder = await mkdtemp(join(tmpdir(), 'wakushare-supervisor-test-'))
    const source = join(folder, 'media')
    const privateRoot = join(folder, 'private')
    await mkdir(source)
    await mkdir(privateRoot)
    await writeFile(join(source, 'clip.mp4'), Buffer.alloc(1024 * 1024, 7))
    const stateFile = join(privateRoot, 'worker.json')
    await writeFile(
      stateFile,
      JSON.stringify({ SchemaVersion: 1, Bindings: [], Sources: [], Pending: [] })
    )
    const store = new ExplorerConfigurationStore(
      join(privateRoot, 'configuration.json'),
      async (path) => path
    )
    const workers: ExplorerWorkerClient[] = []
    const owner = new ExplorerSupervisor({
      store,
      createWorker: async (callbacks) => {
        const worker = new ExplorerWorkerClient({
          executable: process.env.WAKUSHARE_EVENT_WORKER!,
          stateFile,
          ...callbacks
        })
        workers.push(worker)
        return worker
      }
    })
    try {
      await owner.initialize()
      expect(workers).toHaveLength(0)
      await owner.change(0, { type: 'enabled', enabled: true })
      let snapshot = await owner.snapshot()
      expect(snapshot.status).toBe('Empty')
      expect(workers).toHaveLength(0)
      snapshot = await owner.change(snapshot.configuration.revision, {
        type: 'add',
        rootPath: source,
        scope: 'global'
      })
      const awaitIndex = async (files: number): Promise<void> => {
        if ((await owner.snapshot()).indexedFiles === files) return
        await new Promise<void>((yes, no) => {
          const timeout = setTimeout(() => {
            unsubscribe()
            no(new Error('Expected supervisor inventory'))
          }, 5000)
          const unsubscribe = owner.subscribe((value) => {
            if (value.indexedFiles === files) {
              clearTimeout(timeout)
              unsubscribe()
              yes()
            }
          })
        })
      }
      await awaitIndex(1)
      expect((await owner.snapshot()).status).toBe('WaitingForAdapter')
      expect(workers).toHaveLength(1)
      const unsubscribe = owner.subscribe(() => {})
      unsubscribe() // leaving the view must not stop main-owned watches
      await writeFile(join(source, 'new.png'), 'hello')
      await awaitIndex(2)
      expect(workers[0].snapshot?.work.HashedBytes).toBe(1024 * 1024 + 5)
      snapshot = await owner.snapshot()
      await owner.change(snapshot.configuration.revision, { type: 'enabled', enabled: false })
      expect((await owner.snapshot()).status).toBe('Disabled')
      const state = JSON.parse(await readFile(stateFile, 'utf8'))
      expect(state.Bindings).toEqual([])
      expect(state.Sources).toEqual([])
      expect(state.Pending).toEqual([])
      snapshot = await owner.snapshot()
      await owner.change(snapshot.configuration.revision, { type: 'enabled', enabled: true })
      await awaitIndex(2)
      expect(workers).toHaveLength(2)
      expect(workers[1].snapshot?.work.HashedBytes).toBe(0)
      expect((await owner.snapshot()).configuration.sources[0].id).toBe(
        snapshot.configuration.sources[0].id
      )
    } finally {
      await owner.close()
      await rm(folder, { recursive: true, force: true })
    }
  },
  15000
)
