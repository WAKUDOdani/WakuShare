// Original geometric W icon. Uses only Node builtins; never modifies upstream images.
import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
const points = [
  [0.23, 0.31],
  [0.34, 0.69],
  [0.5, 0.43],
  [0.66, 0.69],
  [0.77, 0.31]
]
const crc = (bytes) => {
  let value = 0xffffffff
  for (const byte of bytes) {
    value ^= byte
    for (let i = 0; i < 8; i++) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0)
  }
  return (value ^ 0xffffffff) >>> 0
}
const chunk = (name, data) => {
  const type = Buffer.from(name),
    header = Buffer.alloc(4),
    tail = Buffer.alloc(4)
  header.writeUInt32BE(data.length)
  tail.writeUInt32BE(crc(Buffer.concat([type, data])))
  return Buffer.concat([header, type, data, tail])
}
function png(size) {
  const pixels = Buffer.alloc(size * (size * 4 + 1))
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) / size,
        v = (y + 0.5) / size
      const qx = Math.max(Math.abs(u - 0.5) - 0.28, 0),
        qy = Math.max(Math.abs(v - 0.5) - 0.28, 0)
      const alpha = Math.max(0, Math.min(1, (0.205 - Math.hypot(qx, qy)) * size + 0.5))
      let distance = 1
      for (let i = 1; i < points.length; i++) {
        const [ax, ay] = points[i - 1],
          [bx, by] = points[i],
          dx = bx - ax,
          dy = by - ay
        const t = Math.max(0, Math.min(1, ((u - ax) * dx + (v - ay) * dy) / (dx * dx + dy * dy)))
        distance = Math.min(distance, Math.hypot(u - ax - t * dx, v - ay - t * dy))
      }
      const mark = Math.max(0, Math.min(1, (0.039 - distance) * size + 0.5))
      const offset = y * (size * 4 + 1) + 1 + x * 4
      const bg = [16, 27, 44],
        fg = [72, 231, 198]
      for (let c = 0; c < 3; c++) pixels[offset + c] = Math.round(bg[c] * (1 - mark) + fg[c] * mark)
      pixels[offset + 3] = Math.round(255 * alpha)
    }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(size)
  header.writeUInt32BE(size, 4)
  header[8] = 8
  header[9] = 6
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(pixels)),
    chunk('IEND', Buffer.alloc(0))
  ])
}
for (const dir of ['build', 'resources', 'src/renderer/src/assets'])
  mkdirSync(dir, { recursive: true })
const large = png(1024),
  medium = png(512)
writeFileSync('build/icon-1024.png', large)
for (const file of ['build/icon.png', 'resources/icon.png', 'src/renderer/src/assets/logo.png'])
  writeFileSync(file, medium)
const sizes = [16, 24, 32, 48, 64, 128, 256],
  images = sizes.map(png)
const ico = Buffer.alloc(6 + sizes.length * 16)
ico.writeUInt16LE(1, 2)
ico.writeUInt16LE(sizes.length, 4)
let offset = ico.length
images.forEach((bytes, i) => {
  const p = 6 + i * 16
  ico[p] = sizes[i] % 256
  ico[p + 1] = sizes[i] % 256
  ico.writeUInt16LE(1, p + 4)
  ico.writeUInt16LE(32, p + 6)
  ico.writeUInt32LE(bytes.length, p + 8)
  ico.writeUInt32LE(offset, p + 12)
  offset += bytes.length
})
writeFileSync('build/icon.ico', Buffer.concat([ico, ...images]))
const icns = Buffer.alloc(8)
icns.write('icns')
icns.writeUInt32BE(16 + large.length, 4)
const imageHeader = Buffer.alloc(8)
imageHeader.write('ic10')
imageHeader.writeUInt32BE(8 + large.length, 4)
writeFileSync('build/icon.icns', Buffer.concat([icns, imageHeader, large]))
console.log('Generated original WakuShare icons')
