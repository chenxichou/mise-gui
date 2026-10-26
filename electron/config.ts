import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import * as TOML from 'smol-toml'
import { envDir, savedEnvValue } from './envdir.ts'
import type { ConfigContent } from '../src/types'

const LOCAL_NAMES = [
  'mise.toml',
  '.mise.toml',
  'mise/config.toml',
  'mise/config.yml',
  'mise/config.yaml',
  '.config/mise/config.toml',
  'mise.local.toml',
  '.mise.local.toml',
  '.tool-versions',
]

function isToml(path: string): boolean {
  return path.toLowerCase().endsWith('.toml')
}

function globalConfigDir(): string {
  return resolve(envDir('MISE_CONFIG_DIR'))
}

// The files mise treats as its global config. `MISE_GLOBAL_CONFIG_FILE` was
// measured with `mise config ls --json`: pointing it elsewhere adds that file as
// a global source, but the standard one keeps being loaded too.
export function globalConfigFiles(): string[] {
  const standard = resolve(join(globalConfigDir(), 'config.toml'))
  const out = [standard]
  const override = savedEnvValue('MISE_GLOBAL_CONFIG_FILE')
  if (override && !samePath(override, standard)) out.push(resolve(override))
  return out
}

// mise itself walks up the directory tree, so a command run in the 工作目录 may
// still be governed by an ancestor's mise.toml; those files stay editable.
function ancestorDirs(workDir: string): string[] {
  const out: string[] = []
  let dir = resolve(workDir)
  for (;;) {
    const parent = resolve(dir, '..')
    if (parent === dir) break
    out.push(parent)
    dir = parent
  }
  return out
}

function samePath(a: string, b: string): boolean {
  const norm = (p: string): string => (process.platform === 'win32' ? p.toLowerCase() : p)
  return norm(resolve(a)) === norm(resolve(b))
}

// Confine reads/writes to files the app actually manages: the pins from the
// config registry, plus known mise config names in the working directory chain.
// Being inside a project does not make scripts or unrelated files editable.
function isAllowed(path: string, workDir: string, managed?: string[]): boolean {
  if (typeof path !== 'string' || path.includes('\0')) return false
  const abs = resolve(path)
  if (managed?.some((p) => samePath(p, abs))) return true
  if (globalConfigFiles().some(file => samePath(file, abs))) return true
  return [resolve(workDir), ...ancestorDirs(workDir)].some((dir) =>
    LOCAL_NAMES.some((name) => samePath(join(dir, name), abs)),
  )
}

export function readConfig(path: string, workDir: string, managed?: string[]): ConfigContent {
  if (!isAllowed(path, workDir, managed)) {
    return { path, content: '', parsed: null, error: '路径不在允许范围内' }
  }
  if (!existsSync(path)) {
    return { path, content: '', parsed: null, error: '文件不存在' }
  }
  let content: string
  try {
    content = readFileSync(path, 'utf8')
  } catch (err) {
    return { path, content: '', parsed: null, error: String(err) }
  }
  if (!isToml(path)) {
    // Non-TOML formats (.tool-versions, *.yml) are shown raw only.
    return { path, content, parsed: null }
  }
  try {
    return { path, content, parsed: TOML.parse(content) as Record<string, unknown> }
  } catch (err) {
    return { path, content, parsed: null, error: err instanceof Error ? err.message : String(err) }
  }
}

export function writeConfig(
  path: string,
  content: string,
  workDir: string,
  managed?: string[],
): { ok: boolean; error?: string } {
  if (!isAllowed(path, workDir, managed)) return { ok: false, error: '路径不在允许范围内' }
  if (isToml(path)) {
    try {
      TOML.parse(content)
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  }
  try {
    writeFileSync(path, content, 'utf8')
    return { ok: true }
  } catch (err) {
    return { ok: false, error: String(err) }
  }
}
