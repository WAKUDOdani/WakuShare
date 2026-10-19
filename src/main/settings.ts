import { app } from 'electron'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import log from 'electron-log/main'
import type { AppSettings } from '../shared/types'
import { atomicWriteFile } from './core/fsx'

const settingsSchema = z.object({
  language: z.enum(['en', 'ru']).default('en'),
  draftRootOverride: z.string().nullable().default(null),
  defaultExportDir: z.string().nullable().default(null),
  includeCachesByDefault: z.boolean().default(true),
  theme: z.enum(['system', 'light', 'dark']).default('system'),
  welcomeSeenVersion: z.string().max(80).nullable().default(null),
  welcomeHidden: z.boolean().default(false)
})

const DEFAULTS: AppSettings = {
  language: 'en',
  draftRootOverride: null,
  defaultExportDir: null,
  includeCachesByDefault: true,
  theme: 'system',
  welcomeSeenVersion: null,
  welcomeHidden: false
}

function settingsPath(): string {
  return join(app.getPath('userData'), 'settings.json')
}

let cached: AppSettings | null = null
let pendingWrite: Promise<unknown> = Promise.resolve()

export function getSettings(): AppSettings {
  if (cached) return cached
  try {
    const path = settingsPath()
    if (existsSync(path)) {
      cached = settingsSchema.parse(JSON.parse(readFileSync(path, 'utf8')))
      return cached
    }
  } catch (error) {
    log.warn('Failed to read settings, using defaults:', error)
  }
  cached = { ...DEFAULTS }
  return cached
}

export function setSettings(update: Partial<AppSettings>): Promise<AppSettings> {
  const operation = pendingWrite.then(async () => {
    const next = settingsSchema.parse({ ...getSettings(), ...update })
    await atomicWriteFile(settingsPath(), JSON.stringify(next, null, 2))
    cached = next
    return next
  })
  // Rapid language/theme changes must not overwrite each other's saved fields.
  pendingWrite = operation.catch(() => {})
  return operation
}
