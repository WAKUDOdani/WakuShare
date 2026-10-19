// Static artifact verification; never launches the app or installer.
import { createRequire } from 'node:module'
import { join, resolve, posix } from 'node:path'
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
const require = createRequire(import.meta.url)
const asar = require('@electron/asar')
const yaml = require('js-yaml')
const folder = resolve(process.argv[2] || 'dist')
const unpacked = join(folder, 'win-unpacked')
const archive = join(unpacked, 'resources/app.asar')
const pkg = JSON.parse(asar.extractFile(archive, 'package.json'))
const code = asar.extractFile(archive, join('out', 'main', 'index.js')).toString()
const files = asar.listPackage(archive).map((name) => name.replaceAll('\\', '/'))
const feed = yaml.load(readFileSync(join(unpacked, 'resources/app-update.yml'), 'utf8'))
const unresolvedDependencies = []
for (const name of files.filter(
  (name) => name.includes('/node_modules/') && name.endsWith('/package.json')
)) {
  let dependencyPackage
  try {
    dependencyPackage = JSON.parse(asar.extractFile(archive, join(...name.slice(1).split('/'))))
  } catch {
    continue
  }
  for (const dependency of Object.keys(dependencyPackage.dependencies || {})) {
    let directory = posix.dirname(name),
      found = false
    while (directory !== '/' && directory !== '.') {
      if (files.includes(`${directory}/node_modules/${dependency}/package.json`)) {
        found = true
        break
      }
      directory = posix.dirname(directory)
    }
    if (!found && !files.includes(`/node_modules/${dependency}/package.json`))
      unresolvedDependencies.push(`${dependencyPackage.name} -> ${dependency}`)
  }
}
const result = {
  version: pkg.version,
  brand: pkg.name === 'wakushare' && code.includes('WakuShare'),
  identity: code.includes('io.github.wakudodani.wakushare'),
  repository: pkg.repository.url === 'https://github.com/WAKUDOdani/WakuShare.git',
  publicFeed:
    feed.provider === 'github' &&
    feed.owner === 'WAKUDOdani' &&
    feed.repo === 'WakuShare' &&
    !feed.token &&
    !feed.private,
  manualInstall: code.includes('autoInstallOnAppQuit = false'),
  upstreamDisabled: !code.includes('updater-lab') && !code.includes('repo: "CapShare"'),
  modernGraph: code.includes('Timeline graph is inconsistent'),
  organizedSources: code.includes('Исходники'),
  license:
    files.includes('/LICENSE') && existsSync(join(unpacked, 'resources/LICENSE-WakuShare.txt')),
  dependencies: [
    'yauzl/index.js',
    'yazl/index.js',
    'zod/package.json',
    'electron-updater/out/main.js'
  ].every((name) => files.includes('/node_modules/' + name)),
  transitiveDependencies: unresolvedDependencies.length === 0,
  privateDataExcluded: !files.some((name) =>
    /\/(?:research|tests|scripts)\/|\.capshare$/i.test(name)
  ),
  installerMetadata: null,
  unresolvedDependencies,
  launched: false
}
const latest = join(folder, 'latest.yml')
if (existsSync(latest)) {
  const info = yaml.load(readFileSync(latest, 'utf8'))
  result.installerMetadata =
    info.version === pkg.version &&
    info.files.length > 0 &&
    info.files.every((file) => {
      if (file.url !== `WakuShare-${pkg.version}-setup-x64.exe`) return false
      const bytes = readFileSync(join(folder, file.url))
      return (
        bytes.length === file.size &&
        createHash('sha512').update(bytes).digest('base64') === file.sha512
      )
    }) &&
    existsSync(join(folder, `WakuShare-${pkg.version}-setup-x64.exe.blockmap`))
}
const allowed = new Set(['version', 'launched', 'installerMetadata', 'unresolvedDependencies'])
result.accepted =
  Object.entries(result).every(([key, value]) => allowed.has(key) || value === true) &&
  result.installerMetadata !== false
writeFileSync(join(folder, 'package-verification.json'), JSON.stringify(result, null, 2))
console.log(JSON.stringify(result))
if (!result.accepted) process.exitCode = 1
// A Release job must contain all update artifacts, not merely the unpacked app.
if (process.env['WAKUSHARE_REQUIRE_INSTALLER'] === '1' && result.installerMetadata !== true)
  process.exitCode = 1
const artifacts = readdirSync(folder).filter(
  (name) => name.endsWith('.exe') || name.endsWith('.yml') || name.endsWith('.blockmap')
)
writeFileSync(
  join(folder, 'SHA256SUMS.txt'),
  artifacts
    .map(
      (name) =>
        `${createHash('sha256')
          .update(readFileSync(join(folder, name)))
          .digest('hex')}  ${name}`
    )
    .join('\n') + '\n'
)
