import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { prepareAppProfile } from '../src/main/profile'

let root: string
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'wakushare-profiles-'))
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

describe('preview launch identity', () => {
  it('gives different builds independent locks and taskbar identities', () => {
    const one = prepareAppProfile(root, true, '1.2.0-preview.6')
    const two = prepareAppProfile(root, true, '1.2.0-preview.7')
    expect(one.directory).not.toBe(two.directory)
    expect(one.appId).not.toBe(two.appId)
    expect(one.directory).not.toBe(join(root, 'WakuSharePreview'))
    expect(prepareAppProfile(root, true, '1.2.0-preview.6')).toEqual(one)
  })
  it('inherits preferences once without modifying old or existing build settings', () => {
    const legacy = join(root, 'WakuSharePreview', 'settings.json')
    mkdirSync(join(root, 'WakuSharePreview'))
    const original = JSON.stringify({
      language: 'ru',
      theme: 'dark',
      defaultExportDir: 'D:/Exports'
    })
    writeFileSync(legacy, original)
    const profile = prepareAppProfile(root, true, '1.2.0-preview.6')
    const current = join(profile.directory, 'settings.json')
    expect(readFileSync(current, 'utf8')).toBe(original)
    writeFileSync(current, '{"language":"en"}')
    prepareAppProfile(root, true, '1.2.0-preview.6')
    expect(readFileSync(current, 'utf8')).toBe('{"language":"en"}')
    expect(readFileSync(legacy, 'utf8')).toBe(original)
  })
  it('preserves the installed app identity and rejects unsafe preview paths', () => {
    expect(prepareAppProfile(root, false, '1.1.2')).toEqual({
      name: 'WakuShare',
      directory: join(root, 'WakuShare'),
      appId: 'io.github.wakudodani.wakushare'
    })
    expect(() => prepareAppProfile(root, true, '../other')).toThrow('Invalid preview version')
  })
})
