// Format conversion of the transparent W/document master, preserving its silhouette.
import { createRequire } from 'node:module'
import { mkdirSync, writeFileSync } from 'node:fs'
const require = createRequire(import.meta.url)
const sharp = require(process.env['WAKUSHARE_SHARP_MODULE'] || 'sharp')
const source = 'build/icon-mark-source.png'
const { data, info } = await sharp(source).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
let left = info.width,
  top = info.height,
  right = -1,
  bottom = -1
// Measure export padding without counting imperceptible alpha noise.
for (let y = 0; y < info.height; y++)
  for (let x = 0; x < info.width; x++) {
    if (data[(y * info.width + x) * 4 + 3] > 16) {
      left = Math.min(left, x)
      right = Math.max(right, x)
      top = Math.min(top, y)
      bottom = Math.max(bottom, y)
    }
  }
if (right < left || bottom < top) throw new Error('The icon master is empty')
const crop = {
  left: Math.max(0, left - 2),
  top: Math.max(0, top - 2),
  width: right - left + 5,
  height: bottom - top + 5
}
const transparent = { r: 0, g: 0, b: 0, alpha: 0 }
const png = async (size, windows = false) => {
  const padding = windows ? 0 : Math.max(1, Math.round(size * 0.025))
  return sharp(source)
    .extract(crop)
    .resize(size - 2 * padding, size - 2 * padding, { fit: 'contain', background: transparent })
    .extend({
      top: padding,
      bottom: padding,
      left: padding,
      right: padding,
      background: transparent
    })
    .png()
    .toBuffer()
}
for (const folder of ['build', 'resources', 'src/renderer/src/assets'])
  mkdirSync(folder, { recursive: true })
const large = await png(1024),
  medium = await png(512)
writeFileSync('build/icon-1024.png', large)
for (const file of ['build/icon.png', 'src/renderer/src/assets/logo.png'])
  writeFileSync(file, medium)
// Windows shell/window icons fill their canvas; app UI and ICNS keep their own padding.
writeFileSync('resources/icon.png', await png(512, true))
const sizes = [16, 20, 24, 28, 32, 36, 40, 48, 60, 64, 72, 96, 128, 256],
  images = await Promise.all(sizes.map((size) => png(size, true)))
const directory = Buffer.alloc(6 + sizes.length * 16)
directory.writeUInt16LE(1, 2)
directory.writeUInt16LE(sizes.length, 4)
let offset = directory.length
images.forEach((bytes, index) => {
  const entry = 6 + index * 16
  directory[entry] = sizes[index] % 256
  directory[entry + 1] = sizes[index] % 256
  directory.writeUInt16LE(1, entry + 4)
  directory.writeUInt16LE(32, entry + 6)
  directory.writeUInt32LE(bytes.length, entry + 8)
  directory.writeUInt32LE(offset, entry + 12)
  offset += bytes.length
})
writeFileSync('build/icon.ico', Buffer.concat([directory, ...images]))
const header = Buffer.alloc(16)
header.write('icns')
header.writeUInt32BE(16 + large.length, 4)
header.write('ic10', 8)
header.writeUInt32BE(8 + large.length, 12)
writeFileSync('build/icon.icns', Buffer.concat([header, large]))
console.log('Generated transparent WakuShare PNG, multi-size ICO and ICNS assets')
