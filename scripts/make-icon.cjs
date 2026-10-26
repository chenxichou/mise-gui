// Builds electron/resources/icon.ico from a master PNG. Run with Electron, not node:
//   npx electron scripts/make-icon.cjs path/to/master-256.png
// Delete this file once the icon no longer needs regenerating.
const { app, nativeImage } = require('electron')
const fs = require('fs')
const path = require('path')

const SIZES = [16, 24, 32, 48, 64, 128, 256]

function pngSize(buf) {
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) }
}

function ico(entries) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(entries.length, 4)
  const dirSize = 16 * entries.length
  let offset = 6 + dirSize
  const dir = Buffer.alloc(dirSize)
  entries.forEach((png, i) => {
    const { w, h } = pngSize(png)
    const at = i * 16
    dir.writeUInt8(w === 256 ? 0 : w, at)
    dir.writeUInt8(h === 256 ? 0 : h, at + 1)
    dir.writeUInt8(0, at + 2)
    dir.writeUInt8(0, at + 3)
    dir.writeUInt16LE(1, at + 4)
    dir.writeUInt16LE(32, at + 6)
    dir.writeUInt32LE(png.length, at + 8)
    dir.writeUInt32LE(offset, at + 12)
    offset += png.length
  })
  return Buffer.concat([header, dir, ...entries])
}

app.whenReady().then(() => {
  const master = process.argv[2]
  if (!master || !fs.existsSync(master)) {
    console.error('master png not found:', master)
    app.exit(1)
    return
  }
  const src = nativeImage.createFromPath(master)
  const { width, height } = src.getSize()
  if (width !== 256 || height !== 256) {
    console.error(`master must be 256x256, got ${width}x${height}`)
    app.exit(1)
    return
  }
  const entries = SIZES.map((s) =>
    s === 256 ? src.toPNG() : src.resize({ width: s, height: s, quality: 'best' }).toPNG(),
  )
  const out = path.join(__dirname, '..', 'electron', 'resources', 'icon.ico')
  fs.writeFileSync(out, ico(entries))
  console.log('wrote', out, fs.statSync(out).size, 'bytes')
  app.exit(0)
})
