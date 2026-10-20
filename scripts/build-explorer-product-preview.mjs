// Separate local build. No installer, publication, installed-profile change or auto-enable.
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const { build, Platform, Arch } = require('electron-builder')
const project = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const workspace = resolve(project, '../..')
const contrast = process.argv[2] === '--contrast'
const folders = process.argv[2] === '--folders'
const batch = process.argv[2] === '--batch'
const mass = process.argv[2] === '--mass'
if (process.argv[2] && !contrast && !folders && !batch && !mass)
  throw new Error('Unknown local build variant')
if (process.argv.length > (contrast || folders || batch || mass ? 3 : 2))
  throw new Error('Unknown local build variant')
const version = mass
  ? '1.2.0-explorer.6'
  : batch
    ? '1.2.0-explorer.5'
    : folders
      ? '1.2.0-explorer.4'
      : contrast
        ? '1.2.0-explorer.3'
        : '1.2.0-explorer.2'
// The default collector invokes pnpm even with npmRebuild:false. Use the
// builder's read-only filesystem collector; do not run a package manager.
const packageManager = require('app-builder-lib/out/node-module-collector/packageManager.js')
packageManager.detectPackageManager = async () => ({
  pm: packageManager.PM.TRAVERSAL,
  resolvedDirectory: project,
  detectionMethod: 'fixed local filesystem traversal'
})
const output = resolve(
  workspace,
  mass
    ? 'artifacts/WakuShareExplorerMassPreview'
    : batch
      ? 'artifacts/WakuShareExplorerBatchPreview'
      : folders
        ? 'artifacts/WakuShareExplorerFoldersPreview'
        : contrast
          ? 'artifacts/WakuShareExplorerContrastPreview'
          : 'artifacts/WakuShareExplorerProductPreview'
)
if (existsSync(output)) throw new Error('Preserve existing builds; select a new output generation')
for (const evidence of [
  'artifacts/ExplorerProductAcceptance-20261020/process-events.json',
  'artifacts/ExplorerProductAcceptance-20261020/scope-controls.json',
  'artifacts/ExplorerProductAcceptance-20261020/save-wait-controls.json',
  'artifacts/ExplorerProductAcceptance-20261020/selected-roots-03/scope-continuation/saved-nested-continuation/journal.json'
]) {
  if (!JSON.parse(readFileSync(resolve(workspace, evidence), 'utf8')).accepted)
    throw new Error('Product acceptance incomplete: ' + evidence)
}
const runtime = resolve(workspace, 'artifacts/CapShareRuntime42.3.3')
if (!existsSync(resolve(runtime, 'electron.exe')))
  throw new Error('Verified local Electron runtime absent')
execFileSync(
  process.execPath,
  [resolve(project, 'node_modules/electron-vite/bin/electron-vite.js'), 'build'],
  {
    cwd: project,
    env: {
      ...process.env,
      WAKUSHARE_PREVIEW: '1',
      WAKUSHARE_EXPLORER_WORKSPACE: workspace,
      WAKUSHARE_EXPLORER_PRODUCT: '1'
    },
    stdio: 'inherit'
  }
)
await build({
  projectDir: project,
  targets: Platform.WINDOWS.createTarget(['dir'], Arch.x64),
  publish: 'never',
  config: {
    extends: resolve(project, 'electron-builder.yml'),
    directories: { output },
    electronDist: runtime,
    appId: `io.github.wakudodani.wakushare.preview.${version}`,
    productName: 'WakuShare Explorer',
    win: { executableName: 'WakuShare Explorer', signAndEditExecutable: false },
    extraMetadata: { version }
  }
})
console.log(resolve(output, 'win-unpacked/WakuShare Explorer.exe'))
