import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { dirname, isAbsolute } from 'node:path'
import {
  envelopeSchema,
  eventSchema,
  readySchema,
  responseSchema,
  workerStateSchema,
  type NativeBootstrap,
  type WorkerCapabilities,
  type WorkerState
} from './protocol'

const MAX_OUTPUT_FRAME = 256 * 1024
const MAX_PENDING = 64
interface Deferred<T> {
  promise: Promise<T>
  resolve(value: T): void
  reject(error: Error): void
}
function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}
export class WorkerError extends Error {
  constructor(readonly code: string) {
    super(code)
    this.name = 'WorkerError'
  }
}
export interface WorkerLaunchOptions {
  /** Fixed paths resolved by main; never renderer-supplied commands. */
  executable: string
  /** Main-owned private runtime environment; not exposed through IPC. */
  environment?: NodeJS.ProcessEnv
  stateFile: string
  prefixArguments?: string[]
  editorPid?: number
  nativeRoot?: string
  nativeMode?: 'laboratory' | 'product'
  timeoutMs?: number
  /** This private hook owns the native attach. Tokens never appear in snapshots. */
  onBootstrap?: (bootstrap: NativeBootstrap) => void | Promise<void>
  onState?: (state: WorkerState) => void
  onFailure?: (code: string) => void
}
interface Pending {
  command: string
  reply: Deferred<unknown>
  timer: ReturnType<typeof setTimeout>
}

/** One main-process owner, no polling, no automatic restart/replay. */
export class ExplorerWorkerClient {
  private child: ChildProcessWithoutNullStreams | null = null
  private readonly ready = deferred<WorkerCapabilities>()
  private readonly closed = deferred<void>()
  private readonly pending = new Map<string, Pending>()
  private input = Buffer.alloc(0)
  private sequence = 0
  private hello = false
  private launched = false
  private ended = false
  private failure: string | null = null
  private startupTimer: ReturnType<typeof setTimeout> | null = null
  private killTimer: ReturnType<typeof setTimeout> | null = null
  private stopPromise: Promise<void> | null = null
  private state: WorkerState | null = null
  constructor(private readonly options: WorkerLaunchOptions) {
    if (
      !isAbsolute(options.executable) ||
      !isAbsolute(options.stateFile) ||
      (options.nativeMode !== undefined &&
        (!['laboratory', 'product'].includes(options.nativeMode) || !options.nativeRoot)) ||
      (options.nativeRoot !== undefined &&
        (!isAbsolute(options.nativeRoot) || options.nativeRoot.includes('\0'))) ||
      [options.executable, options.stateFile, ...(options.prefixArguments ?? [])].some((value) =>
        value.includes('\0')
      ) ||
      (options.editorPid !== undefined &&
        (!Number.isSafeInteger(options.editorPid) || options.editorPid <= 0)) ||
      (options.timeoutMs !== undefined &&
        (!Number.isFinite(options.timeoutMs) ||
          options.timeoutMs < 1 ||
          options.timeoutMs > (options.nativeRoot ? 180000 : 60000)))
    )
      throw new WorkerError('InvalidWorkerLaunch')
  }
  get snapshot(): WorkerState | null {
    return this.state
  }
  get fault(): string | null {
    return this.failure
  }

  launch(): Promise<WorkerCapabilities> {
    if (!this.launched && this.stopPromise) return Promise.reject(new WorkerError('WorkerStopped'))
    if (this.launched) return this.ready.promise
    this.launched = true
    const args = [
      ...(this.options.prefixArguments ?? []),
      'event-worker',
      '--state',
      this.options.stateFile
    ]
    if (this.options.editorPid !== undefined)
      args.push('--editor-pid', String(this.options.editorPid))
    if (this.options.nativeRoot) args.push('--native-root', this.options.nativeRoot)
    if (this.options.nativeMode) args.push('--native-mode', this.options.nativeMode)
    this.startupTimer = setTimeout(() => this.fail('WorkerStartTimeout'), this.timeout)
    try {
      const child = (this.child = spawn(this.options.executable, args, {
        cwd: this.options.nativeRoot ?? dirname(this.options.executable),
        shell: false,
        windowsHide: true,
        env: this.options.environment,
        stdio: 'pipe'
      }))
      child.on('error', () => this.fail('WorkerLaunchFailed'))
      child.stdout.on('data', (chunk: Buffer) => this.receive(chunk))
      // Drain diagnostics without retaining arbitrary text or private bootstrap data.
      child.stderr.on('data', () => {})
      child.stdin.on('error', () => this.fail('WorkerConnectionLost'))
      child.on('close', (code, signal) => {
        this.ended = true
        if (!this.stopPromise || code !== 0 || signal) this.fail('WorkerExited')
        if (!this.hello) this.ready.reject(new WorkerError('WorkerStoppedBeforeReady'))
        this.clearTimers()
        for (const item of this.pending.values()) {
          clearTimeout(item.timer)
          item.reply.reject(new WorkerError('WorkerConnectionLost'))
        }
        this.pending.clear()
        this.closed.resolve()
      })
    } catch {
      this.fail('WorkerLaunchFailed')
      this.ended = true
      this.closed.resolve()
    }
    return this.ready.promise
  }
  async run(): Promise<WorkerState> {
    return workerStateSchema.parse(await this.request('start', {}))
  }
  async pause(): Promise<WorkerState> {
    return workerStateSchema.parse(await this.request('pause', {}))
  }
  async status(): Promise<WorkerState> {
    return workerStateSchema.parse(await this.request('status', {}))
  }
  async configure(
    expectedRevision: number,
    revision: number,
    roots: string[]
  ): Promise<WorkerState> {
    const capabilities = await this.launch()
    if (!capabilities.runtimeConfiguration) throw new WorkerError('WorkerConfigurationUnsupported')
    return workerStateSchema.parse(
      await this.request('configure', { expectedRevision, revision, roots })
    )
  }
  async project(
    projectKey: string,
    bindings: {
      Id: string
      RootPath: string
      MediaFolderId: string
      ContainerFolderId: string
      Name: string
    }[]
  ): Promise<WorkerState> {
    return workerStateSchema.parse(await this.request('project', { projectKey, bindings }))
  }
  async rescan(root: string, audit = false): Promise<void> {
    await this.request('rescan', { root, audit })
  }
  async session(
    event:
      | 'ProjectOpened'
      | 'ProjectClosed'
      | 'ProjectChanged'
      | 'MediaChanged'
      | 'Resume'
      | 'DeviceChanged'
  ): Promise<void> {
    await this.request('session', { event })
  }
  stop(): Promise<void> {
    if (this.stopPromise) return this.stopPromise
    // Defer the body until stopPromise has been assigned; a fast child close is expected.
    this.stopPromise = Promise.resolve().then(async () => {
      if (!this.launched || this.ended) return
      if (this.hello && !this.failure) {
        try {
          await this.request('stop', {})
        } catch {
          /* EOF is the fallback shutdown signal. */
        }
      }
      this.endInput()
      await this.closed.promise
    })
    return this.stopPromise
  }
  private get timeout(): number {
    return this.options.timeoutMs ?? 10000
  }
  private async request(command: string, payload: object): Promise<unknown> {
    await this.launch()
    if (this.failure || this.ended || !this.child)
      throw new WorkerError(this.failure ?? 'WorkerConnectionLost')
    if (this.pending.size >= MAX_PENDING) throw new WorkerError('WorkerRequestLimit')
    const id = randomUUID()
    const line = JSON.stringify({ protocolVersion: 1, requestId: id, command, payload })
    if (line.length > 32768) throw new WorkerError('WorkerRequestTooLarge')
    const reply = deferred<unknown>()
    const timer = setTimeout(() => this.fail('WorkerResponseTimeout'), this.timeout)
    this.pending.set(id, { command, reply, timer })
    this.child.stdin.write(line + '\n', 'utf8', (error) => {
      if (error) this.fail('WorkerConnectionLost')
    })
    return reply.promise
  }
  private receive(chunk: Buffer): void {
    if (this.failure || this.ended) return
    try {
      if (chunk.length > MAX_OUTPUT_FRAME) throw new Error()
      this.input = Buffer.concat([this.input, chunk])
      while (true) {
        const newline = this.input.indexOf(10)
        if (newline < 0) break
        if (newline > MAX_OUTPUT_FRAME) throw new Error()
        const frame = this.input.subarray(0, newline)
        this.input = this.input.subarray(newline + 1)
        const message = envelopeSchema.parse(
          JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(frame))
        )
        if (message.sequence !== ++this.sequence) throw new Error()
        if (!this.hello) {
          if (message.type !== 'event' || message.requestId !== null) throw new Error()
          const hello = readySchema.parse(message.payload)
          if (
            hello.capabilities.nativeDispatch !== !hello.capabilities.planningOnly ||
            hello.state.planningOnly !== hello.capabilities.planningOnly ||
            (hello.capabilities.nativeManaged &&
              (!hello.capabilities.nativeObservation ||
                hello.bridge !== null ||
                (hello.state.editor === null &&
                  !(
                    this.options.nativeMode === 'product' && hello.state.nativeMode === 'product'
                  )))) ||
            (this.options.nativeMode === 'product' && hello.state.nativeMode !== 'product') ||
            (hello.capabilities.nativeManaged && !this.options.nativeRoot) ||
            (!hello.capabilities.nativeManaged &&
              (hello.capabilities.nativeDispatch ||
                hello.capabilities.nativeObservation !== (hello.bridge !== null) ||
                hello.capabilities.nativeObservation !== (this.options.editorPid !== undefined))) ||
            (hello.bridge &&
              (hello.bridge.ProcessId !== this.options.editorPid ||
                !this.options.onBootstrap ||
                hello.state.editor?.ConnectionId !== hello.bridge.ConnectionId ||
                hello.state.editor.ProcessId !== hello.bridge.ProcessId))
          )
            throw new Error()
          this.hello = true
          if (this.startupTimer) clearTimeout(this.startupTimer)
          this.startupTimer = null
          this.update(hello.state)
          this.ready.resolve(hello.capabilities)
          if (hello.bridge) {
            const bridge = hello.bridge
            Promise.resolve()
              .then(() => this.options.onBootstrap!(bridge))
              .catch(() => this.fail('NativeBootstrapFailed'))
          }
        } else if (message.type === 'response') {
          const response = responseSchema.parse(message.payload)
          const item = message.requestId ? this.pending.get(message.requestId) : null
          if (!item) throw new Error()
          let result = response.result
          if (response.ok) {
            if (response.error !== null) throw new Error()
            if (
              ['start', 'pause', 'stop', 'status', 'configure', 'project'].includes(item.command)
            ) {
              const state = workerStateSchema.parse(result)
              const expected = { start: 'Running', pause: 'Paused', stop: 'Stopped' }[item.command]
              if (expected && state.phase !== expected) throw new Error()
              this.update(state)
              result = state
            } else if (
              !result ||
              typeof result !== 'object' ||
              Object.keys(result).length !== 1 ||
              !('queued' in result) ||
              result.queued !== true
            )
              throw new Error()
          } else if (!response.error || response.result !== null) throw new Error()
          this.pending.delete(message.requestId!)
          clearTimeout(item.timer)
          if (!response.ok)
            item.reply.reject(new WorkerError(response.error ?? 'WorkerRequestRejected'))
          else item.reply.resolve(result)
        } else {
          if (message.requestId !== null) throw new Error()
          const event = eventSchema.parse(message.payload)
          this.update(event.state)
          if (event.name === 'fault') this.fail('WorkerProtocolFault')
          if (event.name === 'stopped' && !this.stopPromise) this.fail('WorkerStoppedUnexpectedly')
        }
      }
      if (this.input.length > MAX_OUTPUT_FRAME) throw new Error()
    } catch {
      this.fail('WorkerProtocolFault')
    }
  }
  private update(state: WorkerState): void {
    this.state = state
    try {
      this.options.onState?.(state)
    } catch {
      /* A subscriber cannot break the process owner. */
    }
  }
  private fail(code: string): void {
    if (this.failure) return
    this.failure = code
    this.ready.reject(new WorkerError(code))
    for (const item of this.pending.values()) {
      clearTimeout(item.timer)
      item.reply.reject(new WorkerError(code))
    }
    this.pending.clear()
    this.input = Buffer.alloc(0)
    if (this.startupTimer) clearTimeout(this.startupTimer)
    this.startupTimer = null
    try {
      this.options.onFailure?.(code)
    } catch {
      /* No raw protocol data enters diagnostics. */
    }
    this.endInput()
  }
  private endInput(): void {
    if (!this.child || this.ended) return
    this.child.stdin.end()
    // This client negotiates planningOnly/nativeDispatch=false. A parent that
    // stops responding can therefore be closed without an in-flight mutation.
    if (!this.ended && !this.killTimer) this.killTimer = setTimeout(() => this.child?.kill(), 3000)
  }
  private clearTimers(): void {
    if (this.startupTimer) clearTimeout(this.startupTimer)
    if (this.killTimer) clearTimeout(this.killTimer)
    this.startupTimer = null
    this.killTimer = null
  }
}
