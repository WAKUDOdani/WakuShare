import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ root: '', failWrite: false }))
vi.mock('electron', () => ({ app: { getPath: () => mocks.root } }))
vi.mock('electron-log/main', () => ({ default: { warn: vi.fn() } }))
vi.mock('../src/main/core/fsx', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/main/core/fsx')>()
  return {
    ...original,
    atomicWriteFile: async (...args: Parameters<typeof original.atomicWriteFile>) => {
      if (mocks.failWrite) throw new Error('Simulated disk failure')
      return original.atomicWriteFile(...args)
    }
  }
})

beforeEach(() => {
  mocks.root = mkdtempSync(join(tmpdir(), 'wakushare-language-'))
  mocks.failWrite = false
  vi.resetModules()
})
afterEach(() => rmSync(mocks.root, { recursive: true, force: true }))

describe('language settings', () => {
  it('preserves both preferences when language and theme change together', async () => {
    const settings = await import('../src/main/settings')
    await Promise.all([
      settings.setSettings({ language: 'ru' }),
      settings.setSettings({ theme: 'dark' })
    ])
    vi.resetModules()
    expect((await import('../src/main/settings')).getSettings()).toMatchObject({
      language: 'ru',
      theme: 'dark'
    })
  })
  it('starts in Russian, fills legacy settings, and preserves a saved language choice', async () => {
    expect((await import('../src/main/settings')).getSettings().language).toBe('ru')
    vi.resetModules()
    writeFileSync(
      join(mocks.root, 'settings.json'),
      JSON.stringify({
        theme: 'dark',
        defaultExportDir: 'D:/Exports',
        includeCachesByDefault: false
      })
    )
    const settings = await import('../src/main/settings')
    expect(settings.getSettings()).toMatchObject({
      language: 'ru',
      theme: 'dark',
      defaultExportDir: 'D:/Exports',
      includeCachesByDefault: false,
      welcomeSeenVersion: null,
      welcomeHidden: false
    })
    await settings.setSettings({ language: 'ru' })
    vi.resetModules()
    const reloaded = await import('../src/main/settings')
    expect(reloaded.getSettings()).toMatchObject({
      language: 'ru',
      theme: 'dark',
      defaultExportDir: 'D:/Exports',
      includeCachesByDefault: false
    })
    await reloaded.setSettings({ language: 'en' })
    expect(JSON.parse(readFileSync(join(mocks.root, 'settings.json'), 'utf8')).language).toBe('en')
    vi.resetModules()
    expect((await import('../src/main/settings')).getSettings()).toMatchObject({
      language: 'en',
      theme: 'dark',
      defaultExportDir: 'D:/Exports',
      includeCachesByDefault: false
    })
  })

  it('does not claim a language was saved if the write failed', async () => {
    const settings = await import('../src/main/settings')
    await settings.setSettings({ language: 'ru' })
    mocks.failWrite = true
    await expect(settings.setSettings({ language: 'en' })).rejects.toThrow('Simulated disk failure')
    expect(settings.getSettings().language).toBe('ru')
    expect(JSON.parse(readFileSync(join(mocks.root, 'settings.json'), 'utf8')).language).toBe('ru')
  })

  it('retains a permanent welcome opt-out and the seen version across reloads and other writes', async () => {
    const settings = await import('../src/main/settings')
    await Promise.all([
      settings.setSettings({ welcomeSeenVersion: '1.2.0', welcomeHidden: true }),
      settings.setSettings({ language: 'ru', theme: 'dark' })
    ])
    vi.resetModules()
    const reloaded = await import('../src/main/settings')
    expect(reloaded.getSettings()).toMatchObject({
      welcomeSeenVersion: '1.2.0',
      welcomeHidden: true,
      language: 'ru',
      theme: 'dark'
    })
    await reloaded.setSettings({ welcomeSeenVersion: '1.3.0' })
    vi.resetModules()
    expect((await import('../src/main/settings')).getSettings()).toMatchObject({
      welcomeSeenVersion: '1.3.0',
      welcomeHidden: true
    })
  })

  it('keeps the welcome preference intact after a failed save, then allows retry', async () => {
    const settings = await import('../src/main/settings')
    await settings.setSettings({ welcomeSeenVersion: '1.2.0' })
    mocks.failWrite = true
    await expect(
      settings.setSettings({ welcomeSeenVersion: '1.3.0', welcomeHidden: true })
    ).rejects.toThrow()
    expect(settings.getSettings()).toMatchObject({
      welcomeSeenVersion: '1.2.0',
      welcomeHidden: false
    })
    mocks.failWrite = false
    await settings.setSettings({ welcomeSeenVersion: '1.3.0', welcomeHidden: true })
    vi.resetModules()
    expect((await import('../src/main/settings')).getSettings()).toMatchObject({
      welcomeSeenVersion: '1.3.0',
      welcomeHidden: true
    })
  })
})
