import { basename } from 'node:path'
import type { ExplorerEdit, ExplorerProject, ExplorerSnapshot } from '../../shared/explorer'
import {
  ExplorerConfigurationError,
  ExplorerConfigurationStore,
  effectiveSources,
  observableRoots
} from './configuration'
import type { WorkerState } from './protocol'
import type { ExplorerWorkerClient, WorkerLaunchOptions } from './worker-client'

export type ExplorerWorker = Pick<
  ExplorerWorkerClient,
  'launch' | 'configure' | 'run' | 'rescan' | 'session' | 'stop' | 'snapshot' | 'fault'
> &
  Partial<Pick<ExplorerWorkerClient, 'project'>>
export interface ExplorerSupervisorOptions {
  nativeMode?: 'product'
  store: ExplorerConfigurationStore
  createWorker: (
    callbacks: Pick<WorkerLaunchOptions, 'onState' | 'onFailure'>
  ) => Promise<ExplorerWorker | null>
}

/** App-owned lifecycle. Renderer navigation only subscribes to snapshots. */
export class ExplorerSupervisor {
  private worker: ExplorerWorker | null = null
  private workerState: WorkerState | null = null
  private serial: Promise<unknown> = Promise.resolve()
  private listeners = new Set<(snapshot: ExplorerSnapshot) => void>()
  private status: ExplorerSnapshot['status'] = 'Disabled'
  private reason: string | null = null
  private checkedAt: string | null = null
  private checkingSequence = ''
  private generation = 0
  private snapshotSequence = 0
  private closed = false
  private registering = new Set<string>()
  private bindingKey = ''
  constructor(private readonly options: ExplorerSupervisorOptions) {}
  subscribe(listener: (snapshot: ExplorerSnapshot) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
  initialize(): Promise<void> {
    return this.enqueue(() => this.reconcile())
  }
  async snapshot(): Promise<ExplorerSnapshot> {
    const config = await this.options.store.read()
    const roots = this.workerState?.inventoryRoots ?? []
    return {
      sequence: ++this.snapshotSequence,
      configuration: config,
      currentProject: this.currentProject(config.projects),
      status: config.enabled ? this.status : 'Disabled',
      reason: config.enabled ? this.reason : null,
      indexedFiles: roots.reduce((sum, root) => sum + root.Files, 0),
      pending: this.workerState?.pending ?? 0,
      importProgress:
        this.workerState?.importProgress?.projectKey === this.currentProject(config.projects)?.key
          ? this.workerState?.importProgress
          : null,
      roots: roots.map((root) => ({
        rootPath: root.RootPath,
        available: root.Available,
        complete: root.Complete,
        files: root.Files,
        waitingFiles: root.WaitingFiles,
        warnings: root.Warnings
      })),
      lastCheckedAt: this.checkedAt,
      nativeMode:
        this.workerState?.planningOnly === false
          ? (this.workerState.nativeMode ?? 'laboratory')
          : this.options.nativeMode,
      nativeReason: this.workerState?.nativeReason ?? null
    }
  }
  change(expected: number, edit: ExplorerEdit): Promise<ExplorerSnapshot> {
    return this.enqueue(async () => {
      const store = this.options.store
      const config = await store.read()
      const project = this.currentProject(config.projects)
      if ('sourceId' in edit) {
        const source = config.sources.find((source) => source.id === edit.sourceId)
        if (source?.scope === 'project' && source.projectKey !== project?.key)
          throw new ExplorerConfigurationError('EXPLORER_NO_PROJECT')
      }
      switch (edit.type) {
        case 'enabled':
          await store.enabled(expected, edit.enabled)
          break
        case 'add':
          if (edit.scope === 'project' && (!project || edit.expectedProjectKey !== project.key))
            throw new ExplorerConfigurationError('EXPLORER_NO_PROJECT')
          await store.add(expected, {
            rootPath: edit.rootPath,
            label: edit.label,
            projectKey: edit.scope === 'project' ? project!.key : undefined
          })
          break
        case 'sourceEnabled':
          await store.source(expected, edit.sourceId, { enabled: edit.enabled })
          break
        case 'rename':
          await store.source(expected, edit.sourceId, { label: edit.label })
          break
        case 'detach':
          await store.source(expected, edit.sourceId, { detached: true })
          break
        case 'projectEnabled':
          if (!project || edit.expectedProjectKey !== project.key)
            throw new ExplorerConfigurationError('EXPLORER_NO_PROJECT')
          await store.projectOverride(expected, edit.sourceId, project.key, edit.enabled)
          break
      }
      await this.reconcile()
      return this.snapshot()
    })
  }
  rescan(sourceId?: string): Promise<void> {
    return this.enqueue(async () => {
      const config = await this.options.store.read()
      if (!config.enabled) throw new ExplorerConfigurationError('EXPLORER_DISABLED')
      await this.reconcile()
      if (!this.worker) throw new ExplorerConfigurationError('EXPLORER_RUNTIME_UNAVAILABLE')
      const source = sourceId
        ? config.sources.find(
            (source) => source.id === sourceId && !source.detached && source.enabled
          )
        : null
      if (sourceId && !source) throw new ExplorerConfigurationError('EXPLORER_SOURCE_NOT_FOUND')
      for (const root of source ? [source.rootPath] : observableRoots(config))
        await this.worker.rescan(root, true)
    })
  }
  resume(): Promise<void> {
    return this.enqueue(async () => {
      if (this.worker) await this.worker.session('Resume')
    })
  }
  close(): Promise<void> {
    this.closed = true
    return this.enqueue(async () => {
      await this.stopWorker()
      this.listeners.clear()
    }, true)
  }
  private currentProject(projects: ExplorerProject[]): ExplorerProject | null {
    const editor = this.workerState?.editor
    if (editor?.Status !== 'Project' || !editor.Project || this.worker?.fault) return null
    return projects.find((project) => project.key === editor.Project!.Value) ?? null
  }
  private async reconcile(): Promise<void> {
    if (this.closed) return
    const config = await this.options.store.read()
    const roots = observableRoots(config)
    if (!config.enabled || roots.length === 0) {
      await this.stopWorker()
      this.status = config.enabled ? 'Empty' : 'Disabled'
      this.reason = null
      await this.notify()
      return
    }
    try {
      this.reason = null
      if (this.worker?.fault) await this.stopWorker()
      if (!this.worker) {
        this.status = 'Starting'
        await this.notify()
        const generation = ++this.generation
        this.worker = await this.options.createWorker({
          onState: (state) => this.observe(generation, state),
          onFailure: () => {
            if (generation === this.generation && !this.closed) {
              this.status = 'Error'
              this.reason = 'EXPLORER_CONNECTION_FAILED'
              this.workerState = null
              void this.notify()
            }
          }
        })
        if (!this.worker) {
          this.status = 'WaitingForRuntime'
          this.reason = 'EXPLORER_RUNTIME_UNAVAILABLE'
          await this.notify()
          return
        }
        await this.worker.launch()
      }
      if (this.closed) {
        await this.stopWorker()
        return
      }
      const previous = this.worker.snapshot?.configurationRevision ?? 0
      if (previous !== config.revision)
        await this.worker.configure(previous, config.revision, roots)
      const project = this.currentProject(config.projects)
      const key = `${project?.key}:${this.workerState?.editor?.Generation}:${config.revision}`
      if (
        project &&
        this.worker.project &&
        this.workerState?.planningOnly === false &&
        key !== this.bindingKey
      ) {
        await this.worker.project(
          project.key,
          effectiveSources(config, project.key).map((source) => {
            const attachment = config.attachments.find(
              (value) => value.projectKey === project.key && value.sourceId === source.id
            )!
            return {
              Id: attachment.id,
              RootPath: source.rootPath,
              MediaFolderId: attachment.destinationFolderId,
              ContainerFolderId:
                this.workerState?.nativeMode === 'product' ? '' : project.containerFolderId,
              Name: basename(source.rootPath).slice(0, 80)
            }
          })
        )
        this.bindingKey = key
      }
      await this.worker.run()
      this.deriveStatus()
      await this.notify()
    } catch {
      await this.stopWorker()
      this.status = 'Error'
      this.reason = 'EXPLORER_CONNECTION_FAILED'
      await this.notify()
    }
  }
  private observe(generation: number, state: WorkerState): void {
    if (generation !== this.generation || this.closed) return
    this.workerState = state
    const sequence = `${generation}:${state.runtimeEpoch}:${state.batches}`
    if (state.batches > 0 && sequence !== this.checkingSequence) {
      this.checkingSequence = sequence
      this.checkedAt = new Date().toISOString()
    }
    this.deriveStatus()
    void this.notify()
    const project = state.editor?.Project
    if (state.editor?.Status === 'Project' && project && !this.registering.has(project.Value)) {
      this.registering.add(project.Value)
      void this.enqueue(async () => {
        try {
          const config = await this.options.store.read()
          if (!config.projects.some((candidate) => candidate.key === project.Value)) {
            await this.options.store.registerProject({
              key: project.Value,
              draftId: project.DraftId,
              location: project.Location,
              name: basename(project.Location)
            })
          }
          const key = `${project.Value}:${state.editor?.Generation}:${(await this.options.store.read()).revision}`
          if (state.planningOnly === false && key !== this.bindingKey) await this.reconcile()
        } finally {
          this.registering.delete(project.Value)
        }
      }).catch(() => {
        if (!this.closed) {
          this.reason = 'EXPLORER_CONFIGURATION_UNREADABLE'
          void this.notify()
        }
      })
    }
  }
  private deriveStatus(): void {
    if (
      !this.workerState ||
      this.workerState.phase !== 'Running' ||
      !this.workerState.inventoryRoots.length
    ) {
      this.status = 'Indexing'
      return
    }
    if (
      this.workerState.inventoryRoots.some((root) => !root.Available || !root.Complete) ||
      this.workerState.watches.some((watch) => watch.Status !== 'Watching')
    ) {
      this.status = 'SourceUnavailable'
      this.reason = 'EXPLORER_SOURCE_UNAVAILABLE'
    } else if (this.workerState.planningOnly === false) {
      this.reason = this.workerState.nativeReason
      this.status =
        this.workerState.nativeStatus === 'Conflict' || this.workerState.nativeStatus === 'Unknown'
          ? 'Conflict'
          : this.workerState.editor?.Status !== 'Project'
            ? 'WaitingForProject'
            : this.workerState.nativeStatus === 'Applying' || this.workerState.nativeBusy
              ? 'Syncing'
              : (this.workerState.pending === 0 ||
                    this.workerState.importProgress?.phase === 'ready') &&
                  this.workerState.nativeStatus === 'Verified' &&
                  !this.workerState.editorBlocked
                ? 'Watching'
                : 'WaitingForAdapter'
    } else {
      this.status = 'WaitingForAdapter'
      this.reason = 'EXPLORER_ADAPTER_UNAVAILABLE'
    }
  }
  private async stopWorker(): Promise<void> {
    ++this.generation
    const worker = this.worker
    this.worker = null
    this.workerState = null
    this.bindingKey = ''
    if (worker) await worker.stop()
  }
  private async notify(): Promise<void> {
    if (this.closed) return
    try {
      const snapshot = await this.snapshot()
      for (const listener of this.listeners) {
        try {
          listener(snapshot)
        } catch {}
      }
    } catch {}
  }
  private enqueue<T>(action: () => Promise<T>, closing = false): Promise<T> {
    const result = this.serial.then(() => {
      if (this.closed && !closing) throw new ExplorerConfigurationError('EXPLORER_STOPPED')
      return action()
    })
    this.serial = result.catch(() => {})
    return result
  }
}
