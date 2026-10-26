import assert from 'node:assert'
import { defaultDir, effectiveDir, parseRegExport, withReportedDirs, getEnvDirs } from '../electron/envdir.ts'
import { join } from 'node:path'

// reg.exe writes UTF-16LE .reg text: REG_SZ is quoted with doubled backslashes,
// REG_EXPAND_SZ is `hex(2):` byte pairs ending in a null terminator, and a long
// value wraps onto the next line behind a trailing backslash.
function hex(value: string): string {
  const bytes = [...Buffer.from(value, 'utf16le'), 0, 0]
  return bytes.map((b) => b.toString(16).padStart(2, '0')).join(',')
}

// Splitting must keep byte pairs whole, so cut between commas.
const long = 'C:\\Users\\example\\AppData\\Local\\mise;'.repeat(4) + 'D:\\tools'
const pairs = hex(long).split(',')
const cut = Math.floor(pairs.length / 2)
const text = [
  'Windows Registry Editor Version 5.00',
  '',
  '[HKEY_CURRENT_USER\\Environment]',
  '"MISE_DATA_DIR"="D:\\\\mise"',
  `"MISE_CACHE_DIR"=hex(2):${pairs.slice(0, cut).join(',')},\\`,
  `${pairs.slice(cut).join(',')}`,
  `"TEMP"=hex(2):${hex('%USERPROFILE%\\AppData\\Local\\Temp')}`,
  '"EMPTY_DIR"=hex(2):00,00',
  '',
].join('\r\n')

// The BOM is stripped by the caller, so feed the body straight in.
const parsed = parseRegExport(text)
assert.equal(parsed.MISE_DATA_DIR, 'D:\\mise')
assert.equal(parsed.MISE_CACHE_DIR, long)
assert.equal(parsed.TEMP, '%USERPROFILE%\\AppData\\Local\\Temp')
assert.equal(parsed.EMPTY_DIR, undefined)
assert.equal(parsed.MISE_SHIMS_DIR, undefined)

// Directory resolution: whatever the caller's lookup returns is used as-is, and
// shims has no default of its own — it hangs off whichever data directory the
// lookup gives back.
const only = (map: Record<string, string>) => (v: string) => map[v] ?? null
assert.equal(effectiveDir('MISE_DATA_DIR', only({ MISE_DATA_DIR: 'E:\\mise\\AppData' })), 'E:\\mise\\AppData')
assert.match(
  effectiveDir('MISE_DATA_DIR', only({})),
  /mise$/,
  'an unset data directory falls back to the built-in default',
)
assert.equal(
  effectiveDir('MISE_SHIMS_DIR', only({ MISE_DATA_DIR: 'E:\\mise\\AppData' })),
  'E:\\mise\\AppData\\shims',
)
assert.equal(
  effectiveDir('MISE_SHIMS_DIR', only({ MISE_DATA_DIR: 'E:\\mise\\AppData', MISE_SHIMS_DIR: 'D:\\myshims' })),
  'D:\\myshims',
)

const xdgRoot = process.platform === 'win32' ? 'Z:\\xdg' : '/tmp/xdg'
for (const [v, key] of [
  ['MISE_DATA_DIR', 'XDG_DATA_HOME'], ['MISE_CONFIG_DIR', 'XDG_CONFIG_HOME'],
  ['MISE_CACHE_DIR', 'XDG_CACHE_HOME'], ['MISE_STATE_DIR', 'XDG_STATE_HOME'],
] as const) {
  assert.equal(effectiveDir(v, only({ [key]: xdgRoot })), join(xdgRoot, 'mise'))
}
assert.equal(effectiveDir('MISE_SHIMS_DIR', only({ XDG_DATA_HOME: xdgRoot })), join(xdgRoot, 'mise', 'shims'))
assert.equal(defaultDir('MISE_CACHE_DIR', { HOME: '/test/home' }, 'darwin'), join('/test/home', 'Library', 'Caches', 'mise'))
const info = await getEnvDirs()
const reported = process.platform === 'win32' ? 'Z:\\global-shims' : '/tmp/global-shims'
withReportedDirs(info, { shims: reported, config: ['invalid'] })
assert.equal(info.MISE_SHIMS_DIR.current, reported)
assert.equal(info.MISE_SHIMS_DIR.verified, true)
assert.equal(info.MISE_SHIMS_DIR.source, 'detected')
assert.equal(info.MISE_CONFIG_DIR.verified, false)
withReportedDirs(info, { shims: '~/.test-shims' })
assert.equal(info.MISE_SHIMS_DIR.verified, true)
assert.equal(info.MISE_SHIMS_DIR.current, join(process.env.USERPROFILE || process.env.HOME || '~', '.test-shims'))

console.log('✓ all envdir tests passed')
