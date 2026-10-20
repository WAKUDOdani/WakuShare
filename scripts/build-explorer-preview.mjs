// Local linked preview for this workstation. No installer or publication.
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
const require = createRequire(import.meta.url)
const { build, Platform, Arch } = require('electron-builder')
const project = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const workspace = resolve(project, '../..')
if (!existsSync(resolve(workspace, 'artifacts/ExplorerRuntime/used-photo-proof.json')))
  throw new Error('Accepted Explorer runtime proof is required')
execFileSync(
  process.execPath,
  [resolve(project, 'node_modules/electron-vite/bin/electron-vite.js'), 'build'],
  {
    cwd: project,
    env: { ...process.env, WAKUSHARE_PREVIEW: '1', WAKUSHARE_EXPLORER_WORKSPACE: workspace },
    stdio: 'inherit'
  }
)
await build({
  projectDir: project,
  targets: Platform.WINDOWS.createTarget(['dir'], Arch.x64),
  publish: 'never',
  config: {
    extends: resolve(project, 'electron-builder.yml'),
    directories: { output: resolve(workspace, 'artifacts/WakuShareExplorerPreview') },
    extraMetadata: { version: '1.2.0-explorer.1' }
  }
})
