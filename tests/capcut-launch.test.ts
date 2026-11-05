import { EventEmitter } from 'node:events'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  run: vi.fn(),
  spawn: vi.fn(),
  exists: vi.fn(),
  read: vi.fn(),
  open: vi.fn()
}))
vi.mock('node:child_process', () => ({
  execFile: Object.assign(vi.fn(), { [Symbol.for('nodejs.util.promisify.custom')]: mocks.run }),
  spawn: mocks.spawn
}))
vi.mock('node:fs', () => ({ existsSync: mocks.exists }))
vi.mock('node:fs/promises', () => ({ readFile: mocks.read }))
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
  mocks.run.mockResolvedValue({ stdout: ' DisplayVersion    REG_SZ    9.6.0.4097\r\n' })
  mocks.exists.mockImplementation((path) => path === editor || path === bootstrap)
  children = []
  mocks.spawn.mockImplementation(() => {
    const child = Object.assign(new EventEmitter(), { unref: vi.fn() })
    children.push(child)
    queueMicrotask(() => child.emit('spawn'))
    return child
  })
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

it('launches the registered editor directly on the first request with its own working directory', async () => {
  await expect(launchCapCut()).resolves.toBe(true)
  expect(mocks.spawn).toHaveBeenCalledExactlyOnceWith(editor, ['--src1'], {
    cwd: dirname(editor),
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
  mocks.exists.mockImplementation(
    (path) => path === editor || path === configured || path === bootstrap
  )
  await expect(launchCapCut()).resolves.toBe(true)
  expect(mocks.spawn.mock.calls[0][0]).toBe(configured)
  expect(mocks.run).not.toHaveBeenCalled()
})

it('does not interpret registry/configuration values as arbitrary paths or shell commands', async () => {
  mocks.read.mockResolvedValue('last_version=../../evil')
  mocks.run.mockResolvedValue({ stdout: ' DisplayVersion REG_SZ ..\\evil\r\n' })
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

it('uses the bootstrapper only after an explicit OS spawn error, and releases failed requests', async () => {
  mocks.spawn.mockImplementationOnce(() => {
    const child = Object.assign(new EventEmitter(), { unref: vi.fn() })
    queueMicrotask(() => child.emit('error', new Error('access denied')))
    return child
  })
  await expect(launchCapCut()).resolves.toBe(true)
  expect(mocks.spawn.mock.calls.map((call) => call[0])).toEqual([editor, bootstrap])
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
