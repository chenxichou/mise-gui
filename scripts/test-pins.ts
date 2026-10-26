import assert from 'node:assert'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import {
  addManualPin,
  getManualPins,
  listPins,
  managedFiles,
  removeManualPin,
  resolvePinDir,
  resolvePinForWrite,
  setManualPins,
} from '../electron/pins.ts'

const dir = mkdtempSync(join(tmpdir(), 'mise-gui-pins-'))
try {
  const pinFile = join(dir, 'mise.toml')
  writeFileSync(pinFile, '[tools]\nnode = "20"\n')

  assert.equal(addManualPin(join(dir, 'notes.txt')).ok, false, 'a plain file is not a mise config')
  assert.equal(addManualPin(join(dir, 'missing.toml')).ok, false, 'an absent file cannot be imported')

  const added = addManualPin(pinFile)
  assert.equal(added.ok, true)
  assert.equal(added.pin?.path, pinFile)
  assert.equal(added.pin?.dir, dir, 'commands must run next to the pinned file')

  const pins = await listPins(true)
  assert.equal(pins[0].kind, 'global', 'the global file is always managed first')
  const mine = pins.filter((p) => p.path === pinFile)
  assert.equal(mine.length, 1)
  assert.equal(mine[0].origin, 'manual')
  assert.equal(mine[0].exists, true)

  // The same file under a different spelling must not appear twice.
  const slashed = pinFile.replace(/\\/g, '/')
  addManualPin(slashed)
  assert.equal(getManualPins().length, 1, 'duplicate imports are dropped')
  assert.equal((await listPins(true)).filter((p) => p.path === pinFile).length, 1)

  // The cwd lookup answers to any spelling the renderer sends back.
  assert.equal(await resolvePinDir(slashed), dir)
  assert.equal((await resolvePinForWrite(slashed))?.path, pinFile)
  assert.equal((await resolvePinForWrite(pins[0].path))?.kind, 'global', 'the global file is a valid target before creation too')
  assert.equal(await resolvePinForWrite(join(dir, 'unknown.toml')), null)
  assert.ok((await managedFiles()).includes(pinFile))

  removeManualPin(pinFile)
  assert.equal(getManualPins().length, 0)
  assert.equal(await resolvePinDir(pinFile), null, 'an unmanaged file has no cwd')

  // A file deleted after being imported stays unmanaged: handing mise its old
  // directory would let `mise use` walk up and edit an ancestor's config.
  setManualPins([pinFile])
  await listPins(true)
  rmSync(pinFile)
  assert.equal(await resolvePinForWrite(pinFile), null, 'a deletion must be checked even when the pin list is cached')
  const gone = (await listPins(true)).find((p) => p.path === pinFile)
  assert.ok(gone && !gone.exists)
  assert.equal(await resolvePinDir(pinFile), null)

  const other = join(dir, 'nested')
  mkdirSync(other)
  assert.equal(await resolvePinDir(join(other, 'mise.toml')), null)

  console.log('✓ all pins tests passed')
} finally {
  rmSync(dir, { recursive: true, force: true })
}
