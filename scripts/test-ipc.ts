import assert from 'node:assert/strict'
import { completeStream, parseConnection, parseStreamArguments, trustedRendererUrl } from '../electron/ipc.ts'
import type { RunEvent } from '../src/types'

const entry = 'file:///C:/app/dist/index.html'
assert.equal(trustedRendererUrl(`${entry}#tools`, entry), true)
for (const url of ['https://example.com/', 'file:///C:/app/dist/other.html', 'javascript:alert(1)', 'broken']) {
  assert.equal(trustedRendererUrl(url, entry), false)
}
assert.equal(trustedRendererUrl('http://localhost:5173/', 'http://localhost:5173/'), true)
assert.equal(trustedRendererUrl('http://localhost:5174/', 'http://localhost:5173/'), false)

const connection = { tool: 'jq', version: '1.7.1', configPath: 'C:/project/mise.toml', requestedVersion: '1.7' }
assert.deepEqual(parseConnection(connection), connection)
assert.throws(() => parseConnection({ ...connection, otherRequests: '99' }))
assert.throws(() => parseConnection({ ...connection, tool: '--help' }))
assert.throws(() => parseConnection({ ...connection, requestedVersion: {} }))
assert.throws(() => parseStreamArguments('mise:change-connection', { from: connection, action: 'disable', to: connection }))
assert.throws(() => parseStreamArguments('mise:install', { tool: 'jq', version: '1', opts: { pin: 'yes' } }))
assert.throws(() => parseStreamArguments('mise:run-task', { task: '--help', opts: {} }))
assert.deepEqual(parseStreamArguments('mise:install', { tool: 'jq', version: '1.7.1', opts: { pin: true, configPath: connection.configPath, unexpected: 'ignored' } }),
  { tool: 'jq', version: '1.7.1', opts: { pin: true, configPath: connection.configPath } })

for (const mode of ['success', 'duplicate-exit', 'rejection']) {
  const events: RunEvent[] = []
  const result = await completeStream(async emit => {
    if (mode === 'rejection') throw new Error('START_FAILED')
    emit({ type: 'stdout', data: '工具输出' })
    if (mode === 'duplicate-exit') {
      emit({ type: 'exit', data: '', code: 0 }); emit({ type: 'exit', data: '', code: 0 })
    }
    return { ok: true, code: 0, stdout: '工具输出', stderr: '' }
  }, event => events.push(event))
  assert.equal(events.filter(event => event.type === 'exit').length, 1)
  assert.equal(events.at(-1)?.code, mode === 'rejection' ? -1 : 0)
  assert.equal(result.ok, mode !== 'rejection')
  if (mode === 'rejection') assert.equal(events[0].data, 'START_FAILED')
}
console.log('IPC validation, renderer URL trust and exactly-once stream completion passed.')
