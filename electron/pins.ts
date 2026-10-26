import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { globalConfigFiles } from './config.ts'
import { listTrackedConfigs } from './mise.ts'
import type { ConfigPin } from '../src/types'

// The config files the app manages. mise resolves everything from a directory
// chain, so a pin is always a real file plus the directory commands must run in
// to see it — that pair is what replaces the single 默认工作目录.
//
// Three sources, each measured against the real binary:
//  - the global file(s) mise loads, which follow MISE_CONFIG_DIR and
//    MISE_GLOBAL_CONFIG_FILE;
//  - `mise config ls --tracked-configs`, i.e. every file mise has already loaded
//    on this machine (mise forgets one as soon as the file is gone);
//  - what the user imported by hand, persisted by the main process.
//
// A pin may point at a file that does not exist yet — the global config is like
// that on a fresh machine — so the UI can tell 未创建 apart from 未管理.
let manualPins: string[] = []

export function setManualPins(paths: string[]): void {
  manualPins = paths.filter((p) => typeof p === 'string' && p)
  invalidate()
}

export function getManualPins(): string[] {
  return manualPins
}

// mise prints some paths with mixed separators
// (`C:\Users\example\.config/mise/config.toml`), so every comparison goes through a
// resolved, case-folded key.
function keyOf(path: string): string {
  const abs = resolve(path)
  return process.platform === 'win32' ? abs.toLowerCase().replace(/\//g, '\\') : abs
}

function isConfigFileName(path: string): boolean {
  return /(\.toml|\.ya?ml|\.tool-versions)$/i.test(path)
}

let lastPins: ConfigPin[] | null = null
let revision = 0

export async function listPins(force = false): Promise<ConfigPin[]> {
  if (!force && lastPins) return lastPins
  const startedAt = revision
  const seen = new Set<string>()
  const pins: ConfigPin[] = []
  const globalKeys = globalConfigFiles().map(keyOf)

  const add = (raw: string, kind: ConfigPin['kind'], origin: ConfigPin['origin']) => {
    const path = resolve(raw)
    const key = keyOf(path)
    if (seen.has(key)) return
    seen.add(key)
    pins.push({ path, dir: dirname(path), kind, origin, exists: existsSync(path) })
  }

  for (const path of globalConfigFiles()) add(path, 'global', 'global')
  for (const path of await listTrackedConfigs()) {
    if (globalKeys.includes(keyOf(path))) continue
    add(path, 'project', 'tracked')
  }
  for (const path of manualPins) add(path, 'project', 'manual')

  if (startedAt !== revision) return listPins(true)
  lastPins = pins
  return pins
}

export function invalidate(): void {
  lastPins = null
  revision++
}

// Importing needs a real file that looks like a mise config; a directory would
// be a guess about which file inside it should be edited. The result carries the
// pin so the renderer can select it without a second round trip.
export function addManualPin(path: string): { ok: boolean; error?: string; pin?: ConfigPin } {
  if (!path || !isConfigFileName(path)) return { ok: false, error: '只能引入 mise 的配置文件' }
  if (!existsSync(path)) return { ok: false, error: '文件不存在' }
  const abs = resolve(path)
  const key = keyOf(abs)
  if (!manualPins.some((p) => keyOf(p) === key)) manualPins = [...manualPins, abs]
  invalidate()
  return {
    ok: true,
    pin: { path: abs, dir: dirname(abs), kind: 'project', origin: 'manual', exists: true },
  }
}

export function removeManualPin(path: string): void {
  const key = keyOf(path)
  manualPins = manualPins.filter((p) => keyOf(p) !== key)
  invalidate()
}

// The directory mise has to run in for this file's chain to include it, or null
// when the app does not manage it. A pin whose file has since been deleted is
// deliberately rejected: running there would let `mise use` walk up and silently
// edit some ancestor's mise.toml.
export async function resolvePinDir(path?: string): Promise<string | null> {
  if (!path) return null
  const pin = (await listPins()).find((p) => keyOf(p.path) === keyOf(path))
  return pin && pin.exists ? pin.dir : null
}

// A new global file is a valid write target. Missing project files are not:
// their directory may now resolve to a different ancestor's configuration.
export async function resolvePinForWrite(path?: string): Promise<ConfigPin | null> {
  if (!path) return null
  const pin = (await listPins()).find((p) => keyOf(p.path) === keyOf(path))
  if (!pin) return null
  const exists = existsSync(pin.path)
  return exists || pin.kind === 'global' ? { ...pin, exists } : null
}

// Files the config editor may read and write: every managed pin.
export async function managedFiles(): Promise<string[]> {
  return (await listPins()).map((p) => p.path)
}
