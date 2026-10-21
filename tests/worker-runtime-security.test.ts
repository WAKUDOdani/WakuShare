import { expect, it, vi } from 'vitest'
vi.mock('electron', () => ({ app: {} }))
import { safeRuntimeEnvironment } from '../src/main/sync/runtime'

it('does not forward interpreter, startup-hook or profiler injection into the worker', () => {
  const env = safeRuntimeEnvironment({
    PATH: 'trusted-system-path',
    TEMP: 'temp',
    PYTHONPATH: 'foreign',
    PYTHONSTARTUP: 'foreign',
    pythoninspect: '1',
    DOTNET_STARTUP_HOOKS: 'foreign',
    CORECLR_PROFILER: 'foreign',
    COMPlus_ReadyToRun: '0',
    COR_ENABLE_PROFILING: '1',
    NODE_OPTIONS: '--require foreign',
    ELECTRON_RUN_AS_NODE: '1'
  })
  expect(env).toEqual({ PATH: 'trusted-system-path', TEMP: 'temp' })
})
