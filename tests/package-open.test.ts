import { expect, it } from 'vitest'
import { extractPackageArg, packageView } from '../src/shared/package-open'
import { PackageOpenRequests } from '../src/main/package-open'
import { readFileSync } from 'node:fs'

it('routes preset packages separately without changing legacy project handling', () => {
  expect(packageView('C:/Мои пресеты/Пакет.WAKUPRESETS')).toBe('presets')
  expect(packageView('D:\\Projects\\Проект.wakushare')).toBe('import')
  expect(packageView('old.CAPSHARE')).toBe('import')
  for (const path of [
    'script.exe',
    'package.wakupresets.exe',
    '--test.wakupresets',
    '\0.wakupresets'
  ])
    expect(packageView(path)).toBeNull()
  expect(extractPackageArg(['WakuShare.exe', '--flag', 'C:/Мои пресеты/Пакет.wakupresets'])).toBe(
    'C:/Мои пресеты/Пакет.wakupresets'
  )
  expect(extractPackageArg(['WakuShare.exe', 'other.zip'])).toBeNull()
})

it('retains cold-start requests until the renderer subscribes, then consumes them once', () => {
  const queue = new PackageOpenRequests()
  expect(queue.receive('presets.wakupresets')).toBeNull()
  expect(queue.rendererReady()).toBe('presets.wakupresets')
  expect(queue.rendererReady()).toBeNull()
  expect(queue.receive('another.wakupresets')).toBe('another.wakupresets')
  expect(queue.receive('another.wakupresets')).toBe('another.wakupresets')
})

it('holds a second-instance request during loading and preserves it across invalid input', () => {
  const queue = new PackageOpenRequests()
  queue.rendererReady()
  queue.loading()
  expect(queue.receive('new.wakupresets')).toBeNull()
  expect(queue.receive('invalid.exe')).toBeNull()
  expect(queue.rendererReady()).toBe('new.wakupresets')
  expect(queue.receive('project.capshare')).toBe('project.capshare')
})

it('registers all supported package extensions in the installer', () => {
  const config = readFileSync('electron-builder.yml', 'utf8').replaceAll('\r\n', '\n')
  for (const extension of ['wakupresets', 'wakushare', 'capshare'])
    expect(config).toContain(`- ext: ${extension}\n`)
})
