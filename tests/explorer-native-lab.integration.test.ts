import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { expect, it } from 'vitest'
import { ExplorerConfigurationStore } from '../src/main/sync/configuration'
import { ExplorerSupervisor } from '../src/main/sync/supervisor'
import { ExplorerWorkerClient } from '../src/main/sync/worker-client'
import type { ExplorerSnapshot } from '../src/shared/explorer'

// Never part of the normal suite. Exactly one fresh accepted-stage directory.
it.skipIf(process.env.WAKUSHARE_NATIVE_LAB !== '1')(
  'imports and renames through the real Explorer supervisor in the authorized laboratory',
  async () => {
    const workspace = resolve('..', '..')
    const evidence = join(workspace, 'artifacts', 'ExplorerProductNativeLab-05')
    await readFile(join(evidence, 'user-acceptance.json')).then(
      () => {
        throw new Error('This native stage is already accepted; never replay it')
      },
      (error) => {
        if (error.code !== 'ENOENT') throw error
      }
    )
    const recovering = process.env.WAKUSHARE_NATIVE_LAB_RESUME === 'verified-folder'
    if (recovering) {
      expect(
        JSON.parse(await readFile(join(evidence, 'read-only-recovery.json'), 'utf8'))
      ).toMatchObject({ accepted: true, nativeCalls: 0 })
    } else await mkdir(evidence) // existing evidence refuses replay, even after a crash
    const source = join(
      workspace,
      'research/fixtures/AutoAddLab/ExplorerRuntime/ProductAcceptance-20261020'
    )
    await mkdir(source, { recursive: true })
    const backup = await promisify(execFile)('python', [join(workspace, 'tools/backup_lab.py')], {
      windowsHide: true,
      encoding: 'utf8'
    })
    await writeFile(
      join(evidence, recovering ? 'resume-backup.json' : 'backup.json'),
      backup.stdout
    )
    const stateFile = join(evidence, 'worker-state.json')
    if (!recovering)
      await writeFile(
        stateFile,
        JSON.stringify({ SchemaVersion: 1, Bindings: [], Sources: [], Pending: [] })
      )
    const store = new ExplorerConfigurationStore(
      join(evidence, 'configuration.json'),
      async (path) => path
    )
    if (!recovering) {
      const config = await store.enabled(0, true)
      await store.add(config.revision, { rootPath: source })
    }
    const workerStates: { phase: string; nativeStatus: string | null; pending: number }[] = []
    const owner = new ExplorerSupervisor({
      store,
      createWorker: async (callbacks) =>
        new ExplorerWorkerClient({
          executable: join(workspace, 'src/CapSync.Cli/bin/Debug/net10.0/CapSync.Observer.exe'),
          nativeRoot: workspace,
          stateFile,
          timeoutMs: 150000,
          ...callbacks,
          onState: (state) => {
            workerStates.push({
              phase: state.phase,
              nativeStatus: state.nativeStatus,
              pending: state.pending
            })
            callbacks.onState?.(state)
          }
        })
    })
    const waitFor = async (
      predicate: (value: ExplorerSnapshot) => boolean,
      timeoutMs = 135000
    ): Promise<void> => {
      if (predicate(await owner.snapshot())) return
      await new Promise<void>((yes, no) => {
        const timeout = setTimeout(() => {
          unsubscribe()
          no(new Error('Expected native laboratory completion'))
        }, timeoutMs)
        const unsubscribe = owner.subscribe((value) => {
          if (predicate(value)) {
            clearTimeout(timeout)
            unsubscribe()
            yes()
          }
        })
      })
    }
    const state = async (): Promise<{
      Sources: { MaterialId: string; AppliedPath: string }[]
      AddAttempts: { Status: string }[]
      UpdateAttempts: { Status: string }[]
    }> => JSON.parse(await readFile(stateFile, 'utf8'))
    try {
      await owner.initialize()
      await waitFor((value) => value.currentProject !== null, 20000)
      const image = join(source, 'explorer-autoimport.png')
      await writeFile(
        image,
        await readFile(join(workspace, 'research/fixtures/AutoAddLab/CapSync-Stock-Relink-NEW.png'))
      )
      await waitFor((value) => value.pending === 0 && value.indexedFiles === 1)
      // Wait for the durable applied state, not merely the initial unbound index.
      await waitFor(
        (value) =>
          value.currentProject !== null &&
          workerStates.at(-1)?.nativeStatus === 'Verified' &&
          value.pending === 0
      )
      const imported = await state()
      expect(imported.AddAttempts).toHaveLength(1)
      expect(imported.AddAttempts[0].Status).toBe('Completed')
      const material = imported.Sources[0].MaterialId
      expect(material).toBeTruthy()
      await rename(image, join(source, 'explorer-renamed.png'))
      await waitFor((value) => value.pending > 0)
      await waitFor(
        (value) => value.pending === 0 && workerStates.at(-1)?.nativeStatus === 'Verified'
      )
      const renamed = await state()
      expect(renamed.UpdateAttempts).toHaveLength(1)
      expect(renamed.UpdateAttempts[0].Status).toBe('Completed')
      expect(renamed.Sources[0].MaterialId).toBe(material)
      expect(renamed.Sources[0].AppliedPath).toBe('explorer-renamed.png')
      await writeFile(
        join(evidence, 'accept.json'),
        JSON.stringify(
          {
            accepted: true,
            materialId: material,
            imports: 1,
            renames: 1,
            nativeStates: workerStates
          },
          null,
          2
        )
      )
    } finally {
      await owner.close()
      await writeFile(join(evidence, 'states.json'), JSON.stringify(workerStates, null, 2))
    }
  },
  240000
)
