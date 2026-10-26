import { execFile } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import type { EnvDirInfo, EnvVarName } from '../src/types'

export type { EnvDirInfo, EnvVarName }

// The five directory overrides exposed by the settings page.
export const ENV_VARS: EnvVarName[] = [
  'MISE_DATA_DIR',
  'MISE_CONFIG_DIR',
  'MISE_CACHE_DIR',
  'MISE_SHIMS_DIR',
  'MISE_STATE_DIR',
]

function homeDir(): string {
  return process.env.USERPROFILE || process.env.HOME || '~'
}

function tempDir(): string {
  return process.env.TEMP || join(homeDir(), 'AppData', 'Local', 'Temp')
}

const XDG_VAR: Partial<Record<EnvVarName, string>> = {
  MISE_DATA_DIR: 'XDG_DATA_HOME', MISE_CONFIG_DIR: 'XDG_CONFIG_HOME',
  MISE_CACHE_DIR: 'XDG_CACHE_HOME', MISE_STATE_DIR: 'XDG_STATE_HOME',
}

export function defaultDir(v: EnvVarName, env: NodeJS.ProcessEnv = process.env, platform = process.platform): string {
  const home = env.USERPROFILE || env.HOME || homeDir()
  const win = platform === 'win32'
  const xdg = XDG_VAR[v]
  if (xdg && env[xdg]) return join(env[xdg]!, 'mise')
  switch (v) {
    case 'MISE_DATA_DIR': {
      if (!win) return join(home, '.local', 'share', 'mise')
      const local = env.LOCALAPPDATA || join(home, 'AppData', 'Local')
      return join(local, 'mise')
    }
    case 'MISE_CONFIG_DIR':
      return join(home, '.config', 'mise')
    case 'MISE_CACHE_DIR':
      return win ? join(env.TEMP || tempDir(), 'mise') : platform === 'darwin'
        ? join(home, 'Library', 'Caches', 'mise') : join(home, '.cache', 'mise')
    case 'MISE_SHIMS_DIR':
      return join(defaultDir('MISE_DATA_DIR', env, platform), 'shims')
    case 'MISE_STATE_DIR':
      // mise uses the same XDG-style path on Windows as on unix, as measured by
      // `mise doctor` printing `state: ~\.local\state\mise`.
      return join(home, '.local', 'state', 'mise')
  }
}

// The order mise resolves one directory in: the value saved in the user
// environment first, then this process's inherited copy, then the built-in
// default. shims has no default of its own — it hangs off the data directory.
export function effectiveDir(
  v: EnvVarName,
  read: (name: string) => string | null,
): string {
  const set = read(v)
  if (set) return set
  if (v === 'MISE_SHIMS_DIR') {
    return join(effectiveDir('MISE_DATA_DIR', read), 'shims')
  }
  const xdg = XDG_VAR[v]
  return defaultDir(v, xdg ? { ...process.env, [xdg]: read(xdg) ?? undefined } : process.env)
}

// Windows builds a process's environment block when the process is created and
// never updates it again, so `setx` cannot reach an app that is already running
// — and an app launched from a terminal opened before the change inherits that
// terminal's stale copy too. The saved registry value is therefore the freshest
// statement of intent, which is why it outranks process.env here and why the
// main process hands it to every mise child itself.
let savedCache: Record<string, string> | null = null

function fromSources(v: string): string | null {
  return savedCache?.[v] ?? process.env[v] ?? null
}

function liveValue(v: EnvVarName): string {
  return effectiveDir(v, fromSources)
}

// Values that are not one of the five directories but still decide where mise
// looks. `MISE_GLOBAL_CONFIG_FILE` was measured against `mise config ls --json`:
// pointing it at another file makes mise read tool requests from there while it
// still loads the standard global config.
const PASSTHROUGH_VARS = ['MISE_GLOBAL_CONFIG_FILE', ...Object.values(XDG_VAR)]

// The directory overrides a mise child needs on top of this process's block.
// Empty until the first read lands; the main process primes it at startup.
export function miseEnvOverrides(): Record<string, string> {
  const out: Record<string, string> = {}
  for (const name of [...ENV_VARS, ...PASSTHROUGH_VARS]) {
    const value = savedCache?.[name] ?? process.env[name] ?? null
    if (value) out[name] = value
  }
  return out
}

// A single value resolved the same way mise would see it: saved first, then this
// process's inherited copy. Empty string when neither has it.
export function savedEnvValue(name: string): string {
  return savedCache?.[name] ?? process.env[name] ?? ''
}

// Where one of the managed directories points right now, defaults included.
export function envDir(v: EnvVarName): string {
  return liveValue(v)
}

export async function primeEnvCache(): Promise<void> {
  try { await loadSavedEnv() } catch { /* Keep startup usable; settings offers retry. */ }
}

async function loadSavedEnv(): Promise<Record<string, string>> {
  savedCache = await readPersistedEnv()
  return savedCache
}

function exec(cmd: string, args: string[]): Promise<{ ok: boolean; out: string; err: string }> {
  return new Promise((resolve) => {
    // No shell: execFile quotes the argument list itself, so a path with spaces
    // or quotes cannot break out into a command line.
    execFile(cmd, args, { windowsHide: true, timeout: 10000 }, (error, stdout, stderr) =>
      resolve({
        ok: !error,
        out: stdout,
        err: (stderr || String(error?.message || '')).trim(),
      }),
    )
  })
}

// reg.exe wraps a long value across lines with a trailing backslash; the newline
// itself is not part of the value, so only the backslash and break are dropped.
export function parseRegExport(text: string): Record<string, string> {
  const unwrapped = text.replace(/\\\r?\n/g, '')
  const found: Record<string, string> = {}
  for (const line of unwrapped.split(/\r?\n/)) {
    const m = /^"([^"]+)"=(.*)$/.exec(line.trim())
    if (!m) continue
    const raw = m[2].trim()
    let value: string | null = null
    if (raw.startsWith('hex')) {
      const [, body] = raw.split(':')
      if (body) {
        const bytes = Buffer.from(
          body
            .split(',')
            .map((t) => parseInt(t.trim(), 16))
            .filter((n) => Number.isFinite(n)),
        )
        value = bytes.toString('utf16le').replace(/\0+$/, '') || null
      }
    } else {
      // REG_SZ: quoted, with backslashes doubled.
      value = raw.replace(/^"|"$/g, '').replace(/\\\\/g, '\\') || null
    }
    if (value) found[m[1]] = value
  }
  return found
}

// reg.exe prints its query output in the console code page (GBK on a Chinese
// Windows), which mangles non-ASCII paths. `reg export` always writes UTF-16LE,
// so read through a temporary .reg file instead.
async function readPersistedEnv(): Promise<Record<string, string>> {
  if (process.platform !== 'win32') {
    return {}
  }
  const dir = mkdtempSync(join(tmpdir(), 'mise-env-'))
  const file = join(dir, 'environment.reg')
  try {
    const res = await exec('reg', ['export', 'HKCU\\Environment', file, '/y'])
    if (!res.ok) throw new Error(res.err || 'Cannot read user environment')
    const text = readFileSync(file).toString('utf16le').replace(/^\uFEFF/, '')
    return parseRegExport(text)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

export async function getEnvDirs(): Promise<Record<EnvVarName, EnvDirInfo>> {
  const persistedEnv = await loadSavedEnv()
  const out = {} as Record<EnvVarName, EnvDirInfo>
  for (const v of ENV_VARS) {
    out[v] = {
      variable: v,
      current: liveValue(v),
      persisted: persistedEnv[v] ?? null,
      fallback: effectiveDir(v, name => name === v ? null : fromSources(name)),
      source: persistedEnv[v] ? 'user' : process.env[v] ? 'environment'
        : v === 'MISE_SHIMS_DIR' ? 'data' : XDG_VAR[v] && fromSources(XDG_VAR[v]!) ? 'xdg' : 'default',
      verified: false,
      exists: existsSync(liveValue(v)),
      editable: process.platform === 'win32',
    }
  }
  return out
}

// An installed mise is the authority on paths coming from global config too.
export function withReportedDirs(envs: Record<EnvVarName, EnvDirInfo>, dirs?: Record<string, unknown>) {
  const keys: Record<EnvVarName, string> = {
    MISE_DATA_DIR: 'data', MISE_CONFIG_DIR: 'config', MISE_CACHE_DIR: 'cache',
    MISE_STATE_DIR: 'state', MISE_SHIMS_DIR: 'shims',
  }
  for (const v of ENV_VARS) {
    const reported = dirs?.[keys[v]]
    if (typeof reported !== 'string') continue
    const actual = /^~[\\/]/.test(reported) ? join(homeDir(), reported.slice(2)) : reported
    if (!isAbsolute(actual)) continue
    const same = process.platform === 'win32'
      ? actual.replace(/\//g, '\\').toLowerCase() === envs[v].current.replace(/\//g, '\\').toLowerCase()
      : actual === envs[v].current
    envs[v] = { ...envs[v], current: actual, verified: true, exists: existsSync(actual),
      source: same ? envs[v].source : 'detected' }
  }
  return envs
}

// setx both writes the value and broadcasts WM_SETTINGCHANGE, so Explorer and
// any terminal opened afterwards pick it up without a sign-out.
export async function setEnvDir(
  v: EnvVarName,
  path: string,
): Promise<{ ok: boolean; error?: string }> {
  if (process.platform !== 'win32') return { ok: false, error: '仅支持 Windows' }
  if (!ENV_VARS.includes(v) || !isAbsolute(path) || path.length > 1024) {
    return { ok: false, error: '请选择有效的绝对目录路径（不超过 1024 个字符）' }
  }
  const res = await exec('setx', [v, path])
  if (!res.ok) return { ok: false, error: res.err || 'setx 退出码非 0' }
  process.env[v] = path
  await loadSavedEnv()
  return { ok: true }
}

export async function clearEnvDir(v: EnvVarName): Promise<{ ok: boolean; error?: string }> {
  if (process.platform !== 'win32') return { ok: false, error: '仅支持 Windows' }
  if (!ENV_VARS.includes(v)) return { ok: false, error: '无效的环境变量' }
  const res = await exec('reg', ['delete', 'HKCU\\Environment', '/v', v, '/f'])
  if (!res.ok) return { ok: false, error: res.err || 'reg delete 失败' }
  delete process.env[v]
  await loadSavedEnv()
  return { ok: true }
}
