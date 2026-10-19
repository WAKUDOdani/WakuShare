import { constants, copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

/** A preview must never forward its launch to another build's single-instance lock. */
export function prepareAppProfile(
  appData: string,
  preview: boolean,
  version: string
): {
  name: string
  directory: string
  appId: string
} {
  if (!preview)
    return {
      name: 'WakuShare',
      directory: join(appData, 'WakuShare'),
      appId: 'io.github.wakudodani.wakushare'
    }
  if (!/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(version))
    throw new Error('Invalid preview version')
  const name = `WakuSharePreview-${version}`
  const directory = join(appData, name)
  mkdirSync(directory, { recursive: true })
  const inherited = join(appData, 'WakuSharePreview', 'settings.json')
  const destination = join(directory, 'settings.json')
  if (existsSync(inherited) && !existsSync(destination)) {
    try {
      copyFileSync(inherited, destination, constants.COPYFILE_EXCL)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    }
  }
  return { name, directory, appId: `io.github.wakudodani.wakushare.preview.${version}` }
}
