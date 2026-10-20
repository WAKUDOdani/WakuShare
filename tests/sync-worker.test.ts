import { EventEmitter } from 'node:events'
import { PassThrough, Writable } from 'node:stream'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { workerStateSchema, type WorkerState } from '../src/main/sync/protocol'

const mocks = vi.hoisted(() => ({ spawn: vi.fn() }))
vi.mock('node:child_process', () => ({ spawn: mocks.spawn }))
import { ExplorerWorkerClient, type WorkerLaunchOptions } from '../src/main/sync/worker-client'

function state(phase: WorkerState['phase'] = 'Paused'): WorkerState {
  return {
    phase,
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
    work: { FullScans: 0, PartialScans: 0, MetadataEntries: 0, HashedFiles: 0, HashedBytes: 0 },
    readiness: {
      WaitingFiles: 0,
      ScheduledFiles: 0,
      ExhaustedFiles: 0,
      TotalAttempts: 0,
      DeferredFiles: 0
    },
    watches: [],
    editor: null,
    editorBlocked: true,
    blockedProjects: []
  }
}
interface Request {
  requestId: string
  command: string
  payload: object
}
it('accepts legacy states and a typed native execution barrier', () => {
  expect(workerStateSchema.safeParse(state()).success).toBe(true)
  expect(workerStateSchema.parse({ ...state(), nativeBusy: true }).nativeBusy).toBe(true)
  expect(workerStateSchema.parse({ ...state(), nativeBusy: false }).nativeBusy).toBe(false)
  expect(workerStateSchema.safeParse({ ...state(), nativeBusy: 'false' }).success).toBe(false)
})
class FakeWorker extends EventEmitter {
  stdout = new PassThrough()
  stderr = new PassThrough()
  requests: Request[] = []
  automatic = true
  ended = false
  sequence = 0
  kill = vi.fn(() => {
    this.close()
    return true
  })
  stdin = new Writable({
    write: (chunk, _encoding, done) => {
      const request = JSON.parse(chunk.toString()) as Request
      this.requests.push(request)
      if (this.automatic) this.reply(request)
      done()
    },
    final: (done) => {
      this.close()
      done()
    }
  })
  frame(type: string, payload: unknown, requestId: string | null = null): Buffer {
    return Buffer.from(
      JSON.stringify({ protocolVersion: 1, sequence: ++this.sequence, type, requestId, payload }) +
        '\n'
    )
  }
  push(type: string, payload: unknown, requestId: string | null = null): void {
    this.stdout.write(this.frame(type, payload, requestId))
  }
  ready(extra: Record<string, unknown> = {}): void {
    this.push('event', {
      name: 'ready',
      state: state(),
      capabilities: {
        planningOnly: true,
        nativeDispatch: false,
        runtimeConfiguration: false,
        maxFrameChars: 32768,
        replayWindow: 256,
        recurringScanTimers: 0,
        nativeObservation: false
      },
      bridge: null,
      ...extra
    })
  }
  reply(request: Request, result?: unknown): void {
    result ??= ['rescan', 'session'].includes(request.command)
      ? { queued: true }
      : state(
          request.command === 'start'
            ? 'Running'
            : request.command === 'stop'
              ? 'Stopped'
              : 'Paused'
        )
    this.push('response', { ok: true, result, error: null }, request.requestId)
    if (request.command === 'stop') {
      this.push('event', { name: 'stopped', state: state('Stopped'), reason: 'Requested' })
      this.close()
    }
  }
  close(code = 0): void {
    if (!this.ended) {
      this.ended = true
      this.emit('close', code, null)
    }
  }
}
let child: FakeWorker
const clients: ExplorerWorkerClient[] = []
function client(options: Partial<WorkerLaunchOptions> = {}): ExplorerWorkerClient {
  const value = new ExplorerWorkerClient({
    executable: resolve('runtime/CapSync.Observer.exe'),
    stateFile: resolve('private/state.json'),
    ...options
  })
  clients.push(value)
  return value
}
async function launch(value: ExplorerWorkerClient): Promise<void> {
  const pending = value.launch()
  child.ready()
  await pending
}
beforeEach(() => {
  child = new FakeWorker()
  mocks.spawn.mockReset().mockReturnValue(child)
})
afterEach(async () => {
  child.close()
  await Promise.all(clients.splice(0).map((value) => value.stop()))
  vi.useRealTimers()
})

describe('Explorer worker owner', () => {
  it('accepts product lifecycle observation while CapCut is absent without exposing a bridge', async () => {
    const value = client({ nativeRoot: resolve('native'), nativeMode: 'product' })
    const launched = value.launch()
    child.ready({
      state: { ...state(), planningOnly: false, nativeMode: 'product' },
      capabilities: {
        planningOnly: false,
        nativeDispatch: true,
        runtimeConfiguration: true,
        maxFrameChars: 32768,
        replayWindow: 256,
        recurringScanTimers: 0,
        nativeObservation: true,
        nativeManaged: true
      }
    })
    expect((await launched).nativeManaged).toBe(true)
    expect(value.snapshot?.nativeMode).toBe('product')
    expect(value.snapshot?.editor).toBeNull()
    expect(mocks.spawn.mock.calls[0][1]).toContain('--native-mode')
    expect(mocks.spawn.mock.calls[0][1]).toContain('product')
  })
  it('spawns a fixed command hidden without a shell and stays idle after ready', async () => {
    vi.useFakeTimers()
    const value = client()
    await launch(value)
    expect(mocks.spawn).toHaveBeenCalledWith(
      resolve('runtime/CapSync.Observer.exe'),
      ['event-worker', '--state', resolve('private/state.json')],
      { shell: false, windowsHide: true, stdio: 'pipe' }
    )
    await vi.advanceTimersByTimeAsync(6000)
    expect(child.requests).toHaveLength(0)
    expect(vi.getTimerCount()).toBe(0)
  })
  it('runs, pauses and stops by requests with distinct correlation IDs', async () => {
    const value = client()
    await launch(value)
    expect((await value.run()).phase).toBe('Running')
    expect((await value.pause()).phase).toBe('Paused')
    await value.stop()
    expect(value.snapshot?.phase).toBe('Stopped')
    expect(new Set(child.requests.map((request) => request.requestId)).size).toBe(3)
    expect(child.kill).not.toHaveBeenCalled()
  })
  it('reassembles a UTF-8 path split in the middle of a character', async () => {
    const value = client()
    await launch(value)
    const next = {
      ...state('Running'),
      watches: [{ RootPath: 'C:\\Видео\\素材', Status: 'Watching', Reason: null }]
    }
    const frame = child.frame('event', { name: 'stateChanged', state: next })
    const split = frame.indexOf(Buffer.from('В')) + 1
    child.stdout.write(frame.subarray(0, split))
    child.stdout.write(frame.subarray(split))
    expect(value.snapshot?.watches[0].RootPath).toBe('C:\\Видео\\素材')
  })
  it('rejects a sequence gap and pending requests without replay or restart', async () => {
    const value = client()
    await launch(value)
    child.automatic = false
    const pending = expect(value.status()).rejects.toMatchObject({ code: 'WorkerProtocolFault' })
    await Promise.resolve()
    child.sequence += 2
    child.push('event', { name: 'stateChanged', state: state() })
    await pending
    expect(mocks.spawn).toHaveBeenCalledTimes(1)
    expect(child.requests).toHaveLength(1)
  })
  it('rejects a malformed successful response and settles its waiter', async () => {
    const value = client()
    await launch(value)
    child.automatic = false
    const pending = expect(value.status()).rejects.toMatchObject({ code: 'WorkerProtocolFault' })
    await Promise.resolve()
    child.reply(child.requests[0], 'not a state')
    await pending
  })
  it('fails closed on an unknown response ID', async () => {
    const value = client()
    await launch(value)
    child.push('response', { ok: true, result: state(), error: null }, 'unknown')
    expect(value.fault).toBe('WorkerProtocolFault')
  })
  it('bounds output before parsing an unending frame', async () => {
    const value = client()
    await launch(value)
    child.stdout.write(Buffer.alloc(256 * 1024 + 1, 65))
    expect(value.fault).toBe('WorkerProtocolFault')
  })
  it('does not accept mutation capabilities under the planning protocol', async () => {
    const value = client()
    const pending = expect(value.launch()).rejects.toMatchObject({ code: 'WorkerProtocolFault' })
    child.ready({ capabilities: { planningOnly: false, nativeDispatch: true } })
    await pending
    expect(value.snapshot).toBeNull()
  })
  it('keeps the native bootstrap token out of state callbacks', async () => {
    const onBootstrap = vi.fn()
    const onState = vi.fn()
    const value = client({ editorPid: 123, onBootstrap, onState })
    const pending = value.launch()
    const connection = '11111111-1111-4111-8111-111111111111'
    const token = 'a'.repeat(64)
    child.ready({
      state: {
        ...state(),
        editor: {
          Status: 'Connecting',
          ProcessId: 123,
          ConnectionId: connection,
          Generation: 0,
          Sequence: 0,
          ViewEpoch: 0,
          Project: null,
          Reason: null
        }
      },
      capabilities: {
        planningOnly: true,
        nativeDispatch: false,
        runtimeConfiguration: false,
        maxFrameChars: 32768,
        replayWindow: 256,
        recurringScanTimers: 0,
        nativeObservation: true
      },
      bridge: {
        PipeName: 'wakushare-explorer-' + 'b'.repeat(32),
        Token: token,
        ConnectionId: connection,
        ProcessId: 123
      }
    })
    await pending
    await Promise.resolve()
    expect(onBootstrap).toHaveBeenCalledOnce()
    expect(JSON.stringify(onState.mock.calls)).not.toContain(token)
    expect(JSON.stringify(value.snapshot)).not.toContain(token)
  })
  it('rejects a mismatched native PID before accepting ready', async () => {
    const value = client({ editorPid: 123, onBootstrap: () => {} })
    const pending = expect(value.launch()).rejects.toMatchObject({ code: 'WorkerProtocolFault' })
    child.ready()
    await pending
  })
  it('times out one unanswered request and never retries it', async () => {
    vi.useFakeTimers()
    const value = client({ timeoutMs: 20 })
    await launch(value)
    child.automatic = false
    const pending = expect(value.status()).rejects.toMatchObject({ code: 'WorkerResponseTimeout' })
    await vi.advanceTimersByTimeAsync(21)
    await pending
    expect(child.requests).toHaveLength(1)
    expect(mocks.spawn).toHaveBeenCalledTimes(1)
  })
  it('settles requests if the worker exits unexpectedly', async () => {
    const value = client()
    await launch(value)
    child.automatic = false
    const pending = expect(value.status()).rejects.toMatchObject({ code: 'WorkerExited' })
    await Promise.resolve()
    child.close(1)
    await pending
  })
  it('cannot launch a client that was stopped before startup', async () => {
    const value = client()
    await value.stop()
    await expect(value.launch()).rejects.toMatchObject({ code: 'WorkerStopped' })
    expect(mocks.spawn).not.toHaveBeenCalled()
  })
  it('rejects mutation capabilities unless main explicitly selected a native runtime', async () => {
    const value = client()
    const pending = expect(value.launch()).rejects.toMatchObject({ code: 'WorkerProtocolFault' })
    child.ready({
      state: { ...state(), planningOnly: false },
      capabilities: {
        planningOnly: false,
        nativeDispatch: true,
        runtimeConfiguration: true,
        maxFrameChars: 32768,
        replayWindow: 256,
        recurringScanTimers: 0,
        nativeObservation: true,
        nativeManaged: true
      }
    })
    await pending
  })
  it('allows a bounded save deadline only for an explicit absolute native runtime', () => {
    expect(() => client({ timeoutMs: 150000 })).toThrow('InvalidWorkerLaunch')
    expect(() => client({ nativeRoot: 'relative', timeoutMs: 150000 })).toThrow(
      'InvalidWorkerLaunch'
    )
    expect(() => client({ nativeRoot: resolve('runtime'), timeoutMs: 150000 })).not.toThrow()
  })
})
