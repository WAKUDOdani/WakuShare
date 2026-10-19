// Local resource editing, before packaging the installer and portable executable.
// This does not sign the executable or require signing credentials.
const { readFileSync, writeFileSync, renameSync } = require('node:fs')
const { join } = require('node:path')
const { createHash } = require('node:crypto')
const { NtExecutable, NtExecutableResource, Data, Resource } = require('resedit')

module.exports = async function windowsAfterPack(context) {
  if (context.electronPlatformName !== 'win32') return
  const appInfo = context.packager.appInfo
  const executableName =
    context.packager.platformSpecificBuildOptions.executableName || appInfo.productFilename
  const file = join(context.appOutDir, `${executableName}.exe`)
  const before = readFileSync(file)
  const executable = NtExecutable.from(before, { ignoreCert: true })
  const codeSections = executable
    .getAllSections()
    .filter((section) => section.info.name !== '.rsrc')
    .map((section) => ({
      name: section.info.name,
      hash: createHash('sha256')
        .update(Buffer.from(section.data || new ArrayBuffer(0)))
        .digest('hex')
    }))
  const resources = NtExecutableResource.from(executable)
  const unaffected = resources.entries
    .filter((entry) => ![3, 14, 16].includes(entry.type))
    .map((entry) => ({
      type: entry.type,
      id: entry.id,
      lang: entry.lang,
      hash: createHash('sha256').update(Buffer.from(entry.bin)).digest('hex')
    }))
  const icon = Data.IconFile.from(readFileSync(join(context.packager.projectDir, 'build/icon.ico')))
  const groups = Resource.IconGroupEntry.fromEntries(resources.entries)
  // Replace every old app icon group, keeping each resource ID and language.
  for (const group of groups.length ? groups : [{ id: 1, lang: 1033 }]) {
    Resource.IconGroupEntry.replaceIconsForResource(
      resources.entries,
      group.id,
      group.lang,
      icon.icons.map((item) => item.data)
    )
  }
  const versions = Resource.VersionInfo.fromEntries(resources.entries)
  for (const version of versions.length ? versions : [Resource.VersionInfo.createEmpty()]) {
    version.setFileVersion(appInfo.version.replace(/-.*/, '') + '.0', 1033)
    version.setProductVersion(appInfo.version.replace(/-.*/, '') + '.0', 1033)
    for (const language of version.getAllLanguagesForStringValues()) {
      version.setStringValues(language, {
        FileDescription: appInfo.productName,
        ProductName: appInfo.productName,
        CompanyName: 'WAKUDO Dani',
        InternalName: executableName,
        OriginalFilename: `${executableName}.exe`,
        LegalCopyright: 'Copyright 2026 WAKUDO Dani; based on CapShare by Ilyasse Salama (MIT)',
        ProductVersion: appInfo.version,
        FileVersion: appInfo.version
      })
    }
    version.outputToResourceEntries(resources.entries)
  }
  resources.outputResource(executable)
  const output = Buffer.from(executable.generate())
  const verified = NtExecutableResource.from(NtExecutable.from(output))
  const generated = NtExecutable.from(output)
  for (const saved of codeSections) {
    const section = generated.getAllSections().find((item) => item.info.name === saved.name)
    if (
      !section ||
      createHash('sha256')
        .update(Buffer.from(section.data || new ArrayBuffer(0)))
        .digest('hex') !== saved.hash
    )
      throw new Error('An executable code section changed during branding')
  }
  for (const saved of unaffected) {
    const found = verified.entries.find(
      (entry) => entry.type === saved.type && entry.id === saved.id && entry.lang === saved.lang
    )
    if (!found || createHash('sha256').update(Buffer.from(found.bin)).digest('hex') !== saved.hash)
      throw new Error('An unrelated PE resource changed during branding')
  }
  const temporary = `${file}.branding.tmp`
  writeFileSync(temporary, output)
  renameSync(temporary, file)
  console.log(`Embedded WakuShare icon and version resources: ${executableName}`)
}
