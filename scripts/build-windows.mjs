import { execFileSync } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { prepareRuntime, project } from './explorer-runtime.mjs'

const dir = process.argv[2] === '--dir'
if (process.argv.length > (dir ? 3 : 2)) throw Error('Unknown build argument')
const runtime = await prepareRuntime()
const env = { ...process.env, WAKUSHARE_PREVIEW: '0', WAKUSHARE_EXPLORER_PRODUCT: '1' }
delete env.WAKUSHARE_EXPLORER_WORKSPACE
execFileSync(
  process.execPath,
  [join(project, 'node_modules/electron-vite/bin/electron-vite.js'), 'build'],
  { cwd: project, env, stdio: 'inherit' }
)
const cache = join(project, '.runtime-cache')
await mkdir(cache, { recursive: true })
const config = join(cache, 'builder.json')
await writeFile(
  config,
  JSON.stringify({
    extends: join(project, 'electron-builder.yml'),
    extraResources: [{ from: runtime, to: 'explorer' }]
  })
)
execFileSync(
  process.execPath,
  [
    join(project, 'node_modules/electron-builder/cli.js'),
    '--config',
    config,
    '--win',
    ...(dir ? ['--dir'] : ['nsis', 'portable']),
    '--x64',
    '--publish',
    'never'
  ],
  { cwd: project, env, stdio: 'inherit' }
)
