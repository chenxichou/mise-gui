import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { changeConnection } from '../electron/connections.ts'
import { connectionCommands } from '../src/connections.ts'
import { setDisabledStore, readDisabled, writeDisabled, withDisabled } from '../electron/disabled.ts'
import type { ConfigPin, InstalledTool, RunEvent, RunResult, ToolConnection } from '../src/types'

const dir = mkdtempSync(join(tmpdir(), 'mise-gui-connections-'))
const first = join(dir, 'mise.toml'), second = join(dir, 'config.toml')
const from: ToolConnection = { tool: 'jq', version: '1.7.1', requestedVersion: '1.7', configPath: first }
setDisabledStore(join(dir, 'disabled.json'))
const to = { tool: 'jq', version: '1.7.1', configPath: second }
const ok: RunResult = { ok: true, code: 0, stdout: '', stderr: '' }
const rejected: RunResult = { ok: false, code: 9, stdout: '', stderr: 'TEST_REMOVE_FAILED' }
let calls: string[] = [], events: RunEvent[] = [], failInstall = false, failRemove = false, external = false
let tools: InstalledTool[] = []
const reset = () => {
  writeDisabled([])
  writeFileSync(first, 'ORIGINAL'); writeFileSync(second, 'DESTINATION')
  calls = []; events = []; failInstall = false; failRemove = false; external = false
  tools = [{ name: 'jq', versions: [{ version: '1.7.1', installed: true, active: false,
    sources: [{ path: first, requestedVersion: '1.7' }] }] }]
}
const deps = {
  async resolvePinForWrite(path?: string): Promise<ConfigPin | null> {
    return path === first || path === second ? { path, dir: dirname(path), exists: existsSync(path), kind: 'global', origin: 'global' } : null
  },
  async listInstalled() { return tools },
  async install(tool: string, version: string, opts: { configPath?: string; additionalVersions?: string[] }, emit: (e: RunEvent) => void) {
    calls.push(`use ${tool}@${version}${opts.additionalVersions?.length ? ' ' + opts.additionalVersions.join(' ') : ''}`)
    if (failInstall) return rejected
    writeFileSync(opts.configPath!, 'NEW REQUEST')
    emit({ type: 'exit', data: '', code: 0 })
    return ok
  },
  async unuse(tool: string, version: string, _cwd: string | undefined, emit: (e: RunEvent) => void, path?: string) {
    calls.push(`unuse ${tool}@${version}`)
    if (external) writeFileSync(second, 'EXTERNAL EDIT')
    if (failRemove) return rejected
    writeFileSync(path!, 'REMOVED')
    emit({ type: 'exit', data: '', code: 0 })
    return ok
  },
}
const run = (to?: { tool: string; version: string; configPath: string }, origin = from) => changeConnection({ from: origin, to }, event => events.push(event), deps)
try {
  reset()
  assert.equal((await run()).ok, true)
  assert.deepEqual(calls, ['unuse jq@1.7'])
  assert.equal(readFileSync(second, 'utf8'), 'DESTINATION')
  assert.equal(events.filter(e => e.type === 'exit').length, 0, 'only the IPC wrapper emits the final exit')
  assert.match(connectionCommands({ from })[0], /unuse jq@1\.7 --no-prune --path/)

  reset()
  assert.equal((await run(to)).ok, true)
  assert.deepEqual(calls, ['use jq@1.7', 'unuse jq@1.7'])
  assert.equal(readFileSync(first, 'utf8'), 'REMOVED')
  assert.equal(readFileSync(second, 'utf8'), 'NEW REQUEST')

  reset(); failInstall = true
  assert.equal((await run(to)).ok, false)
  assert.deepEqual(calls, ['use jq@1.7'])
  assert.equal(readFileSync(first, 'utf8'), 'ORIGINAL')
  assert.equal(readFileSync(second, 'utf8'), 'DESTINATION')

  reset(); failRemove = true
  assert.equal((await run(to)).ok, false)
  assert.equal(readFileSync(first, 'utf8'), 'ORIGINAL')
  assert.equal(readFileSync(second, 'utf8'), 'DESTINATION')
  assert.match(events.at(-1)!.data, /restored/)

  reset(); failRemove = true; rmSync(second)
  assert.equal((await run(to)).ok, false)
  assert.equal(existsSync(second), false, 'a newly created global destination is removed on rollback')

  reset(); failRemove = true; external = true
  assert.equal((await run(to)).ok, false)
  assert.equal(readFileSync(second, 'utf8'), 'EXTERNAL EDIT', 'rollback never overwrites an intervening edit')

  reset()
  tools[0].versions[0].sources[0].requestedVersion = 'latest'
  assert.equal((await run(to)).ok, false)
  assert.deepEqual(calls, [], 'stale requests are rejected before commands run')

  reset()
  assert.equal((await run({ ...to, configPath: join(dir, 'unmanaged.toml') })).ok, false)
  assert.deepEqual(calls, [])
  assert.equal((await run({ ...to, configPath: first })).ok, false)

  reset()
  assert.equal((await run({ ...to, version: '1.8.1', configPath: first })).ok, true)
  assert.deepEqual(calls, ['use jq@1.8.1'], 'same-file switches must not unuse the replacement')

  reset()
  tools[0].versions.push({ version: '99.0.1', installed: true, active: false, sources: [{ path: first, requestedVersion: '99' }] })
  assert.equal((await run({ ...to, version: '1.8.1', configPath: first }, { ...from, otherRequests: ['99'] })).ok, true)
  assert.deepEqual(calls, ['use jq@1.8.1 99'], 'other version requests are retained')

  reset()
  const concurrent = await Promise.all([run(to), run(to)])
  assert.equal(concurrent.filter(result => result.ok).length, 1)
  assert.deepEqual(calls, ['use jq@1.7', 'unuse jq@1.7'])

  reset()
  assert.equal((await changeConnection({ from, action: 'disable' }, event => events.push(event), deps)).ok, true)
  assert.deepEqual(calls, ['unuse jq@1.7'])
  assert.equal(readDisabled()[0].requestedVersion, '1.7')
  assert.equal(readFileSync(second, 'utf8'), 'DESTINATION')
  tools[0].versions[0].sources = []
  const remembered = withDisabled(tools, [first])
  assert.equal(remembered[0].versions[0].disabledSources?.[0].requestedVersion, '1.7')
  assert.deepEqual(withDisabled(tools, []), tools, 'unmanaged configs are not shown')
  tools[0].versions.push({ version: '99', installed: true, active: true, sources: [{ path: first, requestedVersion: '99' }] })
  assert.equal((await changeConnection({ from: { ...from, disabled: true }, action: 'enable' }, () => {}, deps)).ok, true)
  assert.deepEqual(calls, ['unuse jq@1.7', 'use jq@1.7 99'])
  assert.deepEqual(readDisabled(), [])
  writeFileSync(join(dir, 'disabled.json'), '{broken')
  assert.throws(readDisabled, 'corrupt saved requests must not be overwritten')
  const preserved = structuredClone(tools)
  const warn = console.warn
  console.warn = () => {}
  try { assert.deepEqual(withDisabled(tools, [first]), preserved, 'corrupt UI metadata must not hide actual mise tools') }
  finally { console.warn = warn }

  reset(); failRemove = true
  assert.equal((await changeConnection({ from, action: 'disable' }, () => {}, deps)).ok, false)
  assert.deepEqual(readDisabled(), [], 'failed disable keeps the active connection')

  reset(); writeDisabled([{ ...from, disabled: true }]); tools[0].versions[0].sources = []; failInstall = true
  assert.equal((await changeConnection({ from: { ...from, disabled: true }, action: 'enable' }, () => {}, deps)).ok, false)
  assert.equal(readDisabled().length, 1, 'failed enable retains its disabled request for retry')
  calls = []
  assert.equal((await changeConnection({ from: { ...from, disabled: true } }, () => {}, deps)).ok, true)
  assert.deepEqual(calls, [], 'deleting a disabled cable only removes its saved request')
  assert.deepEqual(readDisabled(), [])
  console.log('Connection changes: deletion, moves, aliases, stale requests, rollback, external edits, multi-version retention and concurrency passed.')
} finally {
  assert.ok(dir.startsWith(join(tmpdir(), 'mise-gui-connections-')))
  rmSync(dir, { recursive: true, force: true })
}
