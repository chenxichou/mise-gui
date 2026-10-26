const assert = require('node:assert/strict')
const fs = require('node:fs')
const { execFileSync } = require('node:child_process')
const { resolve, join } = require('node:path')

const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'))
for (const file of [pkg.main, 'dist-electron/preload.cjs']) {
  assert.equal(file.endsWith('.cjs'), true, 'Electron bundles must explicitly use CommonJS')
  assert.ok(fs.existsSync(file), `Missing Electron entry: ${file}`)
  execFileSync(process.execPath, ['--check', resolve(file)], { stdio: 'inherit' })
}
const html = fs.readFileSync('dist/index.html', 'utf8')
assert.ok(html.includes("script-src 'self';"), 'Production script policy must stay strict')
assert.ok(!html.includes("script-src 'self' 'unsafe-inline'"), 'Development CSP leaked into production')
assert.match(html, /src="\.\/assets\//, 'Renderer assets must load through file://')
for (const file of fs.readdirSync('dist/assets').filter(file => file.endsWith('.js'))) {
  assert.ok(!fs.readFileSync(join('dist/assets', file), 'utf8').includes('2026.10.15 (mock)'), 'Development mock leaked into production')
}
assert.ok(fs.readFileSync('dist/THIRD_PARTY_NOTICES.txt', 'utf8').includes('BSD-3-Clause'), 'Dependency notices are missing')
console.log('Production entries, CommonJS syntax, CSP, asset paths, mock exclusion and license notices passed.')
