import { expect, it } from 'vitest'
import {
  isProjectPackage,
  PROJECT_EXTENSION,
  PROJECT_IMPORT_EXTENSIONS
} from '../src/shared/project-package'

it('exports WakuShare and recognizes both extensions on all import entry points', () => {
  expect(PROJECT_EXTENSION).toBe('wakushare')
  expect(PROJECT_IMPORT_EXTENSIONS).toEqual(['wakushare', 'capshare'])
  for (const file of ['Мой проект.wakushare', 'C:/Archive/old.CAPSHARE', 'new.WAKUSHARE'])
    expect(isProjectPackage(file)).toBe(true)
  for (const file of ['project.wakushare.exe', 'presets.wakupresets', 'project.zip'])
    expect(isProjectPackage(file)).toBe(false)
})
