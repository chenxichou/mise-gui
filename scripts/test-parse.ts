import assert from 'node:assert/strict'
import { parseLsJson, parseRegistryJson, parseRegistryText, parseRemote, parseTasksJson } from '../electron/parse.ts'

// `mise ls --json` (measured on 2026.10.12): object keyed by tool -> version
// records. `source` is an OBJECT { type, path } when a config requests the
// version and absent when nothing does; a bare string path still parses.
const lsSample = JSON.parse(`{
  "node": [
    {
      "version": "22.12.0",
      "requested_version": "22.12.0",
      "install_path": "C:\\\\Users\\\\u\\\\mise\\\\installs\\\\node\\\\22.12.0",
      "source": { "type": "mise.toml", "path": "F:\\\\proj\\\\mise.toml" },
      "installed": false,
      "active": false
    },
    {
      "version": "20.11.0",
      "source": "/home/u/legacy.toml",
      "installed": true,
      "active": true
    }
  ],
  "python": [
    { "version": "3.12.1", "installed": true, "active": false }
  ]
}`)

const tools = parseLsJson(lsSample)
assert.equal(tools.length, 2)
assert.deepEqual(tools.map((t) => t.name), ['node', 'python'])
const node = tools.find((t) => t.name === 'node')!
assert.equal(node.versions.length, 2)
assert.equal(node.versions[0].version, '22.12.0')
assert.equal(node.versions[0].sources.length, 1)
assert.equal(node.versions[0].sources[0].path, 'F:\\proj\\mise.toml')
assert.equal(node.versions[0].sources[0].kind, 'mise.toml')
assert.equal(node.versions[0].installed, false)
assert.equal(node.versions[1].sources[0].path, '/home/u/legacy.toml')
assert.equal(node.versions[1].active, true)
// A version nothing requests has no source, so the tool page draws no link.
assert.deepEqual(tools.find((t) => t.name === 'python')!.versions[0].sources, [])

// `mise ls --json --all-sources` adds sources[] per version but omits the
// versions nobody requests, so it is merged onto the list rather than used alone.
const allSample = JSON.parse(`{
  "node": [
    {
      "version": "22.12.0",
      "installed": true,
      "active": true,
      "sources": [
        { "type": "mise.toml", "path": "F:\\\\proj\\\\mise.toml", "requested_version": "22" },
        { "type": ".tool-versions", "path": "C:\\\\Users\\\\u\\\\.tool-versions", "requested_version": "22.12" }
      ]
    }
  ],
  "rust": [ { "version": "1.90.0", "sources": [ { "path": "F:\\\\other\\\\mise.toml" } ] } ]
}`)
const merged = parseLsJson(lsSample, allSample)
const first = merged.find((t) => t.name === 'node')!.versions[0]
assert.equal(first.sources.length, 2)
// The duplicate path keeps one entry and gains the request as written.
assert.equal(first.sources[0].path, 'F:\\proj\\mise.toml')
assert.equal(first.sources[0].requestedVersion, '22')
assert.equal(first.sources[1].path, 'C:\\Users\\u\\.tool-versions')
// The scoped row's own flags win over the tracker's.
assert.equal(first.installed, false)
assert.equal(first.active, false)
// Requests from other projects must remain visible even without downloads.
const rust = merged.find((t) => t.name === 'rust')!
assert.equal(rust.versions[0].installed, false)
assert.equal(rust.versions[0].sources[0].path, 'F:\\other\\mise.toml')
const missing = parseLsJson({}, {
  jq: [{ version: '1.7.1', installed: false, active: true,
    sources: [{ path: 'F:\\project\\mise.toml', requested_version: '1.7.1' }] }],
})
assert.equal(missing[0].versions[0].version, '1.7.1')
assert.equal(missing[0].versions[0].installed, false)
assert.equal(missing[0].versions[0].active, false, 'another project must not mark it active in the current scope')
const extraVersion = parseLsJson({ jq: [{ version: '1.8.1', installed: true }] }, {
  jq: [{ version: '1.7.1', installed: false, sources: [{ path: 'F:\\project\\mise.toml' }] }],
})
assert.equal(extraVersion[0].versions.length, 2, 'a missing version can join an already installed tool')
// A source with no path is dropped, not drawn as a link to nowhere.
assert.deepEqual(
  parseLsJson(JSON.parse('{"node":[{"version":"1.2","source":{"type":"mise.toml"}}]}')).find(
    (t) => t.name === 'node',
  )!.versions[0].sources,
  [],
)

// Non-array / malformed values are ignored, not thrown.
assert.deepEqual(parseLsJson(null), [])
assert.deepEqual(parseLsJson({ foo: 'bar' }), [])
assert.deepEqual(parseLsJson([1, 2, 3]), [])
// Garbage in the second argument must not lose the list.
assert.equal(parseLsJson(lsSample, 'not json').length, 2)

// `mise registry --json`: an ARRAY of { short, backends[], bins[], description, aliases[] }.
const regJson = parseRegistryJson(
  JSON.parse(`[
    { "short": "node", "backends": ["core:node", "aqua:nodejs/node"], "bins": ["node"], "description": "Node.js runtime", "aliases": ["iojs"] },
    { "short": "python", "backends": ["core:python"], "bins": ["python", "python3"] }
  ]`),
)
assert.ok(regJson)
assert.deepEqual(regJson!.map((r) => r.name), ['node', 'python'])
const nodeReg = regJson!.find((r) => r.name === 'node')!
assert.equal(nodeReg.backend, 'core:node')
assert.equal(nodeReg.description, 'Node.js runtime')
assert.deepEqual(nodeReg.bins, ['node'])
assert.deepEqual(nodeReg.aliases, ['iojs'])
// legacy map shape still works
assert.ok(parseRegistryJson(JSON.parse(`{ "node": { "backend": "core" } }`)))
assert.equal(parseRegistryJson(JSON.parse('[]')), null)
assert.equal(parseRegistryJson(JSON.parse('{}')), null)

// `mise registry` plain text fallback
const regText = parseRegistryText('Tool   Backend\nnode   core\npython core\nterraform ubi\n')
assert.deepEqual(regText.map((r) => r.name), ['node', 'python', 'terraform'])
assert.equal(regText.find((r) => r.name === 'node')!.backend, 'core')

// `mise ls-remote <tool>`
assert.deepEqual(parseRemote('18.0.0\n18.19.0\n20.11.0\n'), ['18.0.0', '18.19.0', '20.11.0'])
assert.deepEqual(parseRemote(''), [])

// `mise tasks ls --json`: array of task objects; hidden tasks filtered out.
const tasksArray = parseTasksJson(
  JSON.parse(`[
    { "name": "test", "depends": ["build"], "source": "mise.toml", "hide": false },
    { "name": "build", "description": "构建产物", "aliases": ["b"], "source": "mise.toml" },
    { "name": "_internal", "hide": true, "source": "mise.toml" }
  ]`),
)
assert.deepEqual(tasksArray.map((t) => t.name), ['build', 'test'])
const build = tasksArray.find((t) => t.name === 'build')!
assert.equal(build.description, '构建产物')
assert.deepEqual(build.aliases, ['b'])
const test = tasksArray.find((t) => t.name === 'test')!
assert.deepEqual(test.depends, ['build'])
assert.equal(test.description, undefined)

// Object-keyed map fallback.
const tasksMap = parseTasksJson(JSON.parse(`{ "deploy": { "depends": ["build"] }, "lint": {} }`))
assert.deepEqual(tasksMap.map((t) => t.name), ['deploy', 'lint'])
assert.deepEqual(tasksMap.find((t) => t.name === 'deploy')!.depends, ['build'])

// Malformed input is tolerated.
assert.deepEqual(parseTasksJson(null), [])
assert.deepEqual(parseTasksJson('nope'), [])
assert.deepEqual(parseTasksJson([1, 2, 3]), [])

console.log('✓ all parse tests passed')
