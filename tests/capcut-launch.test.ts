import { EventEmitter } from 'node:events'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  run: vi.fn(),
  spawn: vi.fn(),
  exists: vi.fn(),
  read: vi.fn(),
  list: vi.fn(),
  open: vi.fn()
}))
vi.mock('node:child_process', () => ({
  execFile: Object.assign(vi.fn(), { [Symbol.for('nodejs.util.promisify.custom')]: mocks.run }),
  spawn: mocks.spawn
}))
vi.mock('node:fs', () => ({ existsSync: mocks.exists }))
vi.mock('node:fs/promises', () => ({ readFile: mocks.read, readdir: mocks.list }))
vi.mock('electron', () => ({ shell: { openPath: mocks.open } }))
import { launchCapCut } from '../src/main/capcut-app'

const local = join('C:', 'Fixtures', 'AppData', 'Local')
const apps = join(local, 'CapCut', 'Apps')
const editor = join(apps, '9.6.0.4097', 'CapCut.exe')
const bootstrap = join(apps, 'CapCut.exe')
let children: (EventEmitter & { unref: ReturnType<typeof vi.fn> })[]
beforeEach(() => {
  vi.stubGlobal(
    'process',
    Object.defineProperty(Object.create(process), 'platform', { value: 'win32' })
  )
  vi.stubEnv('LOCALAPPDATA', local)
  for (const mock of Object.values(mocks)) mock.mockReset()
  mocks.read.mockResolvedValue('[capcut]\nlast_version=\n')
  mocks.list.mockResolvedValue([])
  mocks.run.mockImplementation((_exe, args) =>
    Promise.resolve({
      stdout: args.includes('-Command') ? 'ready' : ' DisplayVersion    REG_SZ    9.6.0.4097\r\n'
    })
  )
  mocks.exists.mockImplementation((path) => path === editor || path === bootstrap)
  children = []
  mocks.spawn.mockImplementation(() => {
    const child = Object.assign(new EventEmitter(), { unref: vi.fn() })
    children.push(child)
    queueMicrotask(() => {
      child.emit('spawn')
      child.emit('exit', 0, null)
    })
    return child
  })
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

it('prefers the official bootstrapper with its own working directory on the first request', async () => {
  await expect(launchCapCut()).resolves.toBe(true)
  expect(mocks.spawn).toHaveBeenCalledExactlyOnceWith(bootstrap, ['--src1'], {
    cwd: dirname(bootstrap),
    detached: true,
    stdio: 'ignore',
    windowsHide: false
  })
  expect(children[0].unref).toHaveBeenCalledOnce()
  expect(mocks.open).not.toHaveBeenCalled()
})

it('respects a valid configured version rather than choosing another installed version', async () => {
  const configured = join(apps, '9.2.0.3931', 'CapCut.exe')
  mocks.read.mockResolvedValue('[capcut]\r\nlast_version=9.2.0.3931\r\n')
  mocks.exists.mockImplementation((path) => path === editor || path === configured)
  await expect(launchCapCut()).resolves.toBe(true)
  expect(mocks.spawn.mock.calls[0][0]).toBe(configured)
  expect(mocks.run.mock.calls.every((call) => call[1].includes('-Command'))).toBe(true)
})

it('does not interpret registry/configuration values as arbitrary paths or shell commands', async () => {
  mocks.read.mockResolvedValue('last_version=../../evil')
  mocks.run.mockImplementation((_exe, args) =>
    Promise.resolve({
      stdout: args.includes('-Command') ? 'ready' : ' DisplayVersion REG_SZ ..\\evil\r\n'
    })
  )
  await expect(launchCapCut()).resolves.toBe(true)
  expect(mocks.spawn.mock.calls[0][0]).toBe(bootstrap)
  expect(mocks.spawn.mock.calls[0][2].shell).toBeUndefined()
})

it('coalesces overlapping launches and permits a deliberate later launch', async () => {
  let release!: (v: string) => void
  mocks.read.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve
      })
  )
  const a = launchCapCut(),
    b = launchCapCut()
  release('last_version=9.6.0.4097')
  await expect(Promise.all([a, b])).resolves.toEqual([true, true])
  expect(mocks.spawn).toHaveBeenCalledOnce()
  await launchCapCut()
  expect(mocks.spawn).toHaveBeenCalledTimes(2)
})

it('uses the registered fallback only after an explicit OS spawn error, and releases failed requests', async () => {
  mocks.spawn.mockImplementationOnce(() => {
    const child = Object.assign(new EventEmitter(), { unref: vi.fn() })
    queueMicrotask(() => child.emit('error', new Error('access denied')))
    return child
  })
  await expect(launchCapCut()).resolves.toBe(true)
  expect(mocks.spawn.mock.calls.map((call) => call[0])).toEqual([bootstrap, editor])
  mocks.spawn.mockImplementation(() => {
    const child = Object.assign(new EventEmitter(), { unref: vi.fn() })
    queueMicrotask(() => child.emit('error', new Error('access denied')))
    return child
  })
  await expect(launchCapCut()).rejects.toThrow('Could not launch CapCut')
  mocks.exists.mockReturnValue(false)
  await expect(launchCapCut()).resolves.toBe(false)
})

it('keeps the macOS application route unchanged', async () => {
  vi.stubGlobal(
    'process',
    Object.defineProperty(Object.create(process), 'platform', { value: 'darwin' })
  )
  mocks.exists.mockImplementation((path) => path === '/Applications/CapCut.app')
  mocks.open.mockResolvedValue('')
  await expect(launchCapCut()).resolves.toBe(true)
  expect(mocks.open).toHaveBeenCalledExactlyOnceWith('/Applications/CapCut.app')
  expect(mocks.spawn).not.toHaveBeenCalled()
})

it('rechecks file-task safety after asynchronous discovery, before spawning', async () => {
  let finish!: (value: string) => void
  mocks.read.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve
      })
  )
  let blocked = false
  const launched = launchCapCut(() => {
    if (blocked) throw new Error('File task started')
  })
  blocked = true
  finish('last_version=9.6.0.4097')
  await expect(launched).rejects.toThrow('File task started')
  expect(mocks.spawn).not.toHaveBeenCalled()
})

it('does not spawn a fallback after an early exit if a descendant window is ready', async () => {
  mocks.spawn.mockImplementationOnce(() => {
    const child = Object.assign(new EventEmitter(), { unref: vi.fn() })
    queueMicrotask(() => {
      child.emit('spawn')
      child.emit('exit', 3221225477, null)
    })
    return child
  })
  await expect(launchCapCut()).resolves.toBe(true)
  expect(mocks.spawn.mock.calls.map((call) => call[0])).toEqual([bootstrap])
})

it('bounds observation for a persistent editor and never relaunches it on a late crash', async () => {
  vi.useFakeTimers()
  try {
    let child!: EventEmitter & { unref: ReturnType<typeof vi.fn> }
    mocks.spawn.mockImplementationOnce(() => {
      child = Object.assign(new EventEmitter(), { unref: vi.fn() })
      queueMicrotask(() => child.emit('spawn'))
      return child
    })
    const request = launchCapCut()
    await vi.advanceTimersByTimeAsync(8000)
    await expect(request).resolves.toBe(true)
    child.emit('exit', 3221225477, null)
    expect(mocks.spawn).toHaveBeenCalledOnce()
  } finally {
    vi.useRealTimers()
  }
})

it('recovers exactly once after confirmed absence, but never replays a hidden or delayed editor', async () => {
  const states = ['stopped', 'ready', 'running', 'stopped', 'stopped']
  mocks.run.mockImplementation((_exe, args) =>
    Promise.resolve({
      stdout: args.includes('-Command') ? states.shift() : 'DisplayVersion REG_SZ 9.6.0.4097'
    })
  )
  await expect(launchCapCut()).resolves.toBe(true)
  expect(mocks.spawn).toHaveBeenCalledTimes(2)
  await expect(launchCapCut()).rejects.toThrow('did not open a window')
  expect(mocks.spawn).toHaveBeenCalledTimes(3)
  await expect(launchCapCut()).rejects.toThrow('did not open a window')
  expect(mocks.spawn).toHaveBeenCalledTimes(5)
})

it('rechecks file-task safety before a stopped-start recovery', async () => {
  let guarded = 0
  mocks.run.mockImplementation((_exe, args) =>
    Promise.resolve({
      stdout: args.includes('-Command') ? 'stopped' : 'DisplayVersion REG_SZ 9.6.0.4097'
    })
  )
  await expect(
    launchCapCut(() => {
      if (++guarded > 1) throw Error('File task started')
    })
  ).rejects.toThrow('File task started')
  expect(mocks.spawn).toHaveBeenCalledOnce()
})

it('does not replay when window observation fails or returns unknown output', async () => {
  mocks.run.mockImplementation((_exe, args) =>
    args.includes('-Command')
      ? Promise.reject(Error('PowerShell unavailable'))
      : Promise.resolve({ stdout: 'DisplayVersion REG_SZ 9.6.0.4097' })
  )
  await expect(launchCapCut()).rejects.toThrow('Could not verify whether the CapCut window opened')
  expect(mocks.spawn).toHaveBeenCalledOnce()
  mocks.run.mockImplementation((_exe, args) =>
    Promise.resolve({
      stdout: args.includes('-Command') ? 'unknown' : 'DisplayVersion REG_SZ 9.6.0.4097'
    })
  )
  await expect(launchCapCut()).rejects.toThrow('Could not verify whether the CapCut window opened')
  expect(mocks.spawn).toHaveBeenCalledTimes(2)
})

it('uses the installed editor after confirming that the bootstrapper left no descendants', async () => {
  const states = ['stopped', 'ready']
  mocks.run.mockImplementation((_exe, args) =>
    Promise.resolve({
      stdout: args.includes('-Command') ? states.shift() : 'DisplayVersion REG_SZ 9.6.0.4097'
    })
  )
  mocks.spawn.mockImplementationOnce(() => {
    const child = Object.assign(new EventEmitter(), { unref: vi.fn() })
    queueMicrotask(() => {
      child.emit('spawn')
      child.emit('exit', 3221225477, null)
    })
    return child
  })
  await expect(launchCapCut()).resolves.toBe(true)
  expect(mocks.spawn.mock.calls.map((call) => call[0])).toEqual([bootstrap, editor])
})

it('discovers a fresh 9.7 install when both configuration and registry are empty', async () => {
  const current = join(apps, '9.7.1.4203', 'CapCut.exe')
  mocks.run.mockImplementation((_exe, args) =>
    args.includes('-Command')
      ? Promise.resolve({ stdout: 'ready' })
      : Promise.reject(Error('missing'))
  )
  mocks.list.mockResolvedValue(['9.6.0.4097', '9.7.1.4203', '..\\evil'])
  mocks.exists.mockImplementation((path) => path === current)
  await expect(launchCapCut()).resolves.toBe(true)
  expect(mocks.spawn.mock.calls[0][0]).toBe(current)
})

it('compares version components numerically and ignores incomplete version directories', async () => {
  const current = join(apps, '9.10.0.4300', 'CapCut.exe')
  mocks.run.mockImplementation((_exe, args) =>
    args.includes('-Command')
      ? Promise.resolve({ stdout: 'ready' })
      : Promise.reject(Error('missing'))
  )
  mocks.list.mockResolvedValue(['9.9.0.4200', '9.10.0.4300', '10.0.0.4400'])
  mocks.exists.mockImplementation(
    (path) => path === current || path === join(apps, '9.9.0.4200', 'CapCut.exe')
  )
  await expect(launchCapCut()).resolves.toBe(true)
  expect(mocks.spawn.mock.calls[0][0]).toBe(current)
})

it('does not fall back while a 9.7 editor is still starting without a window', async () => {
  mocks.run.mockImplementation((_exe, args) =>
    Promise.resolve({
      stdout: args.includes('-Command') ? 'running' : 'DisplayVersion REG_SZ 9.7.1.4203'
    })
  )
  await expect(launchCapCut()).rejects.toThrow('did not open a window')
  expect(mocks.spawn).toHaveBeenCalledOnce()
})
