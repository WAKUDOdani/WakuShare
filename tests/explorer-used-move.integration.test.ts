import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { expect, it } from 'vitest'
import { ExplorerConfigurationStore } from '../src/main/sync/configuration'
import { ExplorerSupervisor } from '../src/main/sync/supervisor'
import { ExplorerWorkerClient } from '../src/main/sync/worker-client'
import type { ExplorerSnapshot } from '../src/shared/explorer'
import type { WorkerState } from '../src/main/sync/protocol'

// A separate, explicit user-created fixture. The accepted import test is frozen.
it.skipIf(process.env.WAKUSHARE_USED_MOVE_LAB !== '1')(
  'moves a used photo into its owned nested folder with every clip preserved',
  async () => {
    const workspace = resolve('..', '..')
    const evidence = join(workspace, 'artifacts/ExplorerUsedPhotoMoveLab')
    const marker = join(evidence, 'journal.json')
    const record = JSON.parse(await readFile(marker, 'utf8'))
    const resume = process.env.WAKUSHARE_USED_PHOTO_RESUME === '1'
    expect(record.stage).toBe(resume ? 'awaitingReopen' : 'fixtureReady')
    if (resume)
      expect(JSON.parse(await readFile(join(evidence, 'resume-gate.json'), 'utf8'))).toMatchObject({
        accepted: true,
        nativeMutationCommands: 0,
        resumePhase: 'observeAlreadyRenamedSource'
      })
    const stateFile = join(evidence, 'worker-state.json')
    const desiredName = 'MovedAcceptance-20261020/explorer-used-final.png'
    const desired = join(dirname(record.path), desiredName)
    const attempt = Date.now()
    const states: WorkerState[] = []
    const store = new ExplorerConfigurationStore(
      join(evidence, 'configuration.json'),
      async (path) => path
    )
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
            states.push(state)
            callbacks.onState?.(state)
          }
        })
    })
    const waitFor = async (
      predicate: (value: ExplorerSnapshot) => boolean | Promise<boolean>,
      timeoutMs: number
    ): Promise<void> => {
      if (await predicate(await owner.snapshot())) return
      await new Promise<void>((yes, no) => {
        let done = false
        const finish = (error?: unknown): void => {
          if (done) return
          done = true
          clearTimeout(timeout)
          unsubscribe()
          if (error) no(error)
          else yes()
        }
        const timeout = setTimeout(
          () => finish(new Error('Used-photo stage is waiting; inspect its journal, never replay')),
          timeoutMs
        )
        const unsubscribe = owner.subscribe((value) => {
          void Promise.resolve(predicate(value)).then((ready) => {
            if (ready) finish()
          }, finish)
        })
        // Close the snapshot/subscription race without a polling timer.
        void owner
          .snapshot()
          .then((value) => predicate(value))
          .then((ready) => {
            if (ready) finish()
          }, finish)
      })
    }
    const persist = async (): Promise<void> => {
      const temporary = marker + '.next'
      await writeFile(temporary, JSON.stringify(record, null, 2))
      await rename(temporary, marker)
    }
    try {
      await owner.initialize()
      if (!resume) {
        await waitFor(() => states.at(-1)?.editor?.Status === 'Home', 20000)
        record.stage = 'renamingFile'
        record.newPath = desired
        await persist()
        await mkdir(dirname(desired)) // exactly one new physical folder
        await rename(record.path, desired) // exactly one move attempt; Windows locks are respected
        record.stage = 'awaitingReopen'
        await persist()
        process.stdout.write('USED_PHOTO_READY_FOR_REOPEN\n')
      }
      await waitFor(async (value) => {
        if (['Conflict', 'Unknown'].includes(states.at(-1)?.nativeStatus ?? ''))
          throw new Error('Native stage stopped; preserve its receipt and never replay')
        if (
          !value.currentProject ||
          value.pending !== 0 ||
          states.at(-1)?.nativeStatus !== 'Verified'
        )
          return false
        const state = JSON.parse(await readFile(stateFile, 'utf8'))
        return state.Sources.some(
          (source) =>
            source.Id === record.sourceId &&
            source.MaterialId === record.materialId &&
            source.AppliedPath === desiredName
        )
      }, 600000)
      const state = JSON.parse(await readFile(stateFile, 'utf8'))
      const attempts = state.UpdateAttempts.filter(
        (attempt) => attempt.Job.RelativePath.replace(/\\/g, '/') === desiredName
      )
      expect(attempts).toHaveLength(1)
      expect(attempts[0].Status).toBe('Completed')
      expect(state.AddAttempts).toHaveLength(1) // the original accepted import; no new card
      expect(state.Pending).toHaveLength(0)
      const folders = state.ManagedFolders.filter(
        (folder) => folder.Job.RelativePath === 'MovedAcceptance-20261020'
      )
      expect(folders).toHaveLength(1)
      expect(folders[0].Status).toBe('Completed')
      expect(attempts[0].Job.DestinationFolderId).toBe(folders[0].Job.FolderId)
      record.destinationFolderId = folders[0].Job.FolderId
      record.stage = 'awaitingUserAcceptance'
      record.updateJobId = attempts[0].Job.Id
      record.acceptedAutomatically = true
      await persist()
      await writeFile(
        join(evidence, 'accept.json'),
        JSON.stringify(
          {
            accepted: true,
            materialId: record.materialId,
            updateJobId: record.updateJobId,
            newImports: 0,
            movedUsedPhotos: 1
          },
          null,
          2
        )
      )
    } catch (error) {
      record.testFailurePhase = record.stage
      record.stage = 'StoppedForReview'
      await persist()
      throw error
    } finally {
      await owner.close()
      await writeFile(join(evidence, `states-${attempt}.json`), JSON.stringify(states, null, 2))
    }
  },
  660000
)
