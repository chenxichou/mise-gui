import assert from 'node:assert'
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readConfig, writeConfig } from '../electron/config.ts'

const dir = mkdtempSync(join(tmpdir(), 'mise-gui-test-'))
try {
  writeFileSync(join(dir, 'mise.toml'), '[tools]\nnode = "20"\n')

  const c = readConfig(join(dir, 'mise.toml'), dir)
  assert.equal(c.error, undefined)
  assert.deepEqual(c.parsed, { tools: { node: '20' } })

  const bad = writeConfig(join(dir, 'mise.toml'), '[tools\noops', dir)
  assert.equal(bad.ok, false)

  const ok = writeConfig(join(dir, 'mise.toml'), '[tools]\npython = "3.12"\n', dir)
  assert.equal(ok.ok, true)
  assert.deepEqual(readConfig(join(dir, 'mise.toml'), dir).parsed, { tools: { python: '3.12' } })

  const outside = writeConfig(join(tmpdir(), 'evil.toml'), 'x=1', dir)
  assert.equal(outside.ok, false, 'must refuse paths outside workDir')
  const script = join(dir, 'startup.ps1')
  writeFileSync(script, '# original')
  assert.equal(writeConfig(script, 'unexpected code', dir).ok, false, 'project scripts are never config write targets')
  assert.ok(readConfig(script, dir).error, 'project scripts are not config read targets')

  // mise walks up the directory tree, so an ancestor's mise.toml stays editable
  // while any other file in that ancestor does not.
  const sub = join(dir, 'apps', 'web')
  mkdirSync(sub, { recursive: true })
  writeFileSync(join(dir, 'apps', 'mise.toml'), '[tools]\nnode = "22"\n')
  writeFileSync(join(dir, 'apps', 'notes.toml'), 'secret = 1\n')
  assert.equal(readConfig(join(dir, 'apps', 'mise.toml'), sub).error, undefined)
  assert.equal(
    writeConfig(join(dir, 'apps', 'notes.toml'), 'secret = 2\n', sub).ok,
    false,
    'must refuse non-config files in ancestors',
  )

  const rich = '[tools]\nnode = ["20", "22"]\n[env]\nUNICODE = "项目路径"\n[tasks.build]\nrun = """echo first\necho second"""\n'
  assert.equal(writeConfig(join(dir, 'mise.toml'), rich, dir).ok, true)
  assert.equal(readConfig(join(dir, 'mise.toml'), dir).parsed?.env &&
    (readConfig(join(dir, 'mise.toml'), dir).parsed?.env as Record<string, unknown>).UNICODE, '项目路径')

  // A config file from another project is editable only because the registry
  // lists it as a managed pin — the 工作目录 no longer decides what can be read.
  const elsewhere = mkdtempSync(join(tmpdir(), 'mise-gui-pin-'))
  try {
    const pinFile = join(elsewhere, 'mise.toml')
    writeFileSync(pinFile, '[tools]\ngo = "1.23"\n')
    assert.equal(writeConfig(pinFile, '[tools]\ngo = "1.24"\n', dir).ok, false)
    assert.equal(writeConfig(pinFile, '[tools]\ngo = "1.24"\n', dir, [pinFile]).ok, true)
    assert.deepEqual(readConfig(pinFile, dir, [pinFile]).parsed, { tools: { go: '1.24' } })
  } finally {
    rmSync(elsewhere, { recursive: true, force: true })
  }

  console.log('✓ all config tests passed')
} finally {
  rmSync(dir, { recursive: true, force: true })
}
