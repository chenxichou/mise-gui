// Validate the actual distributable, then reuse the missing-mise desktop suite.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const { resolve, join } = require('node:path')
const { execFileSync } = require('node:child_process')
const asar = require('@electron/asar')

const root = resolve('release/win-unpacked')
const executable = join(root, 'Mise GUI.exe')
assert.ok(fs.existsSync(executable), 'Run npm run dist:win before testing the package')
const archive = join(root, 'resources/app.asar')
const entries = asar.listPackage(archive).map(file => file.replaceAll('\\', '/').replace(/^\//, ''))
for (const file of ['dist/index.html', 'dist-electron/main.cjs', 'dist-electron/preload.cjs',
  'electron/resources/icon.ico', 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'dist/THIRD_PARTY_NOTICES.txt']) {
  assert.ok(entries.includes(file), `Missing packaged file: ${file}`)
}
assert.ok(!entries.some(file => /(^|\/)(src|scripts|test-results|\.git|node_modules)(\/|$)/.test(file)),
  'Development files or unnecessary dependencies leaked into the package')
for (const file of ['LICENSE.electron.txt', 'LICENSES.chromium.html']) {
  assert.ok(fs.existsSync(join(root, file)), `Missing runtime license: ${file}`)
}
const pkg = JSON.parse(asar.extractFile(archive, 'package.json').toString('utf8'))
assert.equal(pkg.main, 'dist-electron/main.cjs')
console.log('Packaged entries, icon, file allowlist and runtime licenses passed.')
execFileSync(process.execPath, [resolve('scripts/test-desktop.cjs')], {
  env: { ...process.env, MISE_GUI_TEST_EXECUTABLE: executable },
  stdio: 'inherit',
  timeout: 180000,
})
