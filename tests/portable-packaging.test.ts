import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { expect, it } from 'vitest'

const yaml = createRequire(import.meta.url)('js-yaml') as {
  load(text: string): { portable: { unpackDirName?: boolean | string } }
}

it('gives each Portable launch a private extraction directory, so secondary cleanup cannot delete active resources', () => {
  const config = yaml.load(readFileSync('electron-builder.yml', 'utf8'))
  expect(config.portable.unpackDirName).toBe(true)
})
