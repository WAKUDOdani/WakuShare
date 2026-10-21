// Static artifact verification; never launches the app or installer.
import { createRequire } from 'node:module'
import { join, resolve, posix } from 'node:path'
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { verifySecurityRuntime } from './runtime-refresh.mjs'
const require = createRequire(import.meta.url)
const asar = require('@electron/asar')
const yaml = require('js-yaml')
const { NtExecutable, NtExecutableResource, Resource, Data } = require('resedit')
const folder = resolve(process.argv[2] || 'dist')
const unpacked = join(folder, 'win-unpacked')
const archive = join(unpacked, 'resources/app.asar')
const pkg = JSON.parse(asar.extractFile(archive, 'package.json'))
const code = asar.extractFile(archive, join('out', 'main', 'index.js')).toString()
const files = asar.listPackage(archive).map((name) => name.replaceAll('\\', '/'))
const feed = yaml.load(readFileSync(join(unpacked, 'resources/app-update.yml'), 'utf8'))
const exeResources = NtExecutableResource.from(
  NtExecutable.from(readFileSync(join(unpacked, 'WakuShare.exe')), { ignoreCert: true })
)
const { getCurrentFuseWire, FuseV1Options } = require('@electron/fuses')
const fuseWire = await getCurrentFuseWire(join(unpacked, 'WakuShare.exe'))
const expectedIcons = Data.IconFile.from(readFileSync('build/icon.ico')).icons.map((item) =>
  createHash('sha256').update(Buffer.from(item.data.bin)).digest('hex')
)
const embeddedIcons = Resource.IconGroupEntry.fromEntries(exeResources.entries)
const versionInfo = Resource.VersionInfo.fromEntries(exeResources.entries)
const rendererCode = files
  .filter((name) => /^\/out\/renderer\/assets\/.*\.js$/.test(name))
  .map((name) => asar.extractFile(archive, join(...name.slice(1).split('/'))).toString())
  .join('\n')
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
  hardenedRuntime: Boolean(await verifySecurityRuntime(join(unpacked, 'resources/explorer'))),
  hardenedElectron:
    [
      FuseV1Options.RunAsNode,
      FuseV1Options.EnableNodeOptionsEnvironmentVariable,
      FuseV1Options.EnableNodeCliInspectArguments
    ].every((id) => fuseWire[id] === 48) &&
    [FuseV1Options.EnableEmbeddedAsarIntegrityValidation, FuseV1Options.OnlyLoadAppFromAsar].every(
      (id) => fuseWire[id] === 49
    ),
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
  presets: code.includes('presets:review') && code.includes('wakushare-presets'),
  russianInterface: code.includes('Пресеты не добавлены'),
  productionUpdater: code.includes('NsisUpdater') && !code.includes('const installed = false'),
  brandedInterface: rendererCode.includes('waku-share-gradient'),
  welcomeDialog:
    code.includes('welcomeSeenVersion') &&
    code.includes('welcomeHidden') &&
    rendererCode.includes('Welcome to WakuShare') &&
    rendererCode.includes('welcomeHidden'),
  staticWelcome:
    rendererCode.includes("Let's stay in touch") && !rendererCode.includes('data-welcome-carousel'),
  windowsIcon:
    embeddedIcons.length > 0 &&
    embeddedIcons.every((group) => {
      const hashes = group
        .getIconItemsFromEntries(exeResources.entries)
        .map((item) =>
          item.isRaw() ? createHash('sha256').update(Buffer.from(item.bin)).digest('hex') : ''
        )
      return expectedIcons.every((hash) => hashes.includes(hash))
    }),
  windowsVersion: versionInfo.some((entry) =>
    entry.getAllLanguagesForStringValues().some((lang) => {
      const values = entry.getStringValues(lang)
      return values.ProductName === 'WakuShare' && values.FileVersion === pkg.version
    })
  ),
  license:
    readFileSync(join(unpacked, 'resources/LICENSE-WakuShare.txt'), 'utf8') ===
      readFileSync('LICENSE', 'utf8') &&
    existsSync(join(unpacked, 'resources/THIRD_PARTY_NOTICES.md')),
  dependencies: [
    'yauzl/index.js',
    'yazl/index.js',
    'zod/package.json',
    'electron-updater/out/main.js'
  ].every((name) => files.includes('/node_modules/' + name)),
  transitiveDependencies: unresolvedDependencies.length === 0,
  privateDataExcluded: !files.some((name) =>
    /^\/(?:research|tests|scripts)\/|\.capshare$/i.test(name)
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
