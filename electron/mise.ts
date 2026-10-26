import { spawn, execFile } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { StringDecoder } from 'node:string_decoder'
import type {
  DoctorInfo,
  InstalledTool,
  MiseStatus,
  MiseTask,
  RegistryTool,
  RemoteVersion,
  RunEvent,
  SettingsInfo,
  RunResult,
} from '../src/types'
import { parseLsJson, parseRegistryJson, parseRegistryText, parseRemote, parseTasksJson } from './parse.ts'
import { miseEnvOverrides } from './envdir.ts'

let cachedBinary: string | null = null

const DETECT_TTL = 30_000
let statusCache: { at: number; status: MiseStatus } | null = null

function tryWhere(): Promise<string | null> {
  return new Promise((resolve) => {
    const cmd = process.platform === 'win32' ? 'where' : 'which'
    execFile(cmd, ['mise'], { windowsHide: true, timeout: 5000 }, (err, stdout) => {
      if (err) return resolve(null)
      const first = stdout.split(/\r?\n/).map((l) => l.trim()).find(Boolean)
      resolve(first ?? null)
    })
  })
}

function wingetPackageCandidates(): string[] {
  const home = homedir()
  const local = process.env.LOCALAPPDATA ?? join(home, 'AppData', 'Local')
  const pkgRoot = join(local, 'Microsoft', 'WinGet', 'Packages')
  const out: string[] = []
  try {
    for (const entry of readdirSync(pkgRoot)) {
      if (!entry.toLowerCase().startsWith('jdx.mise')) continue
      for (const rel of [
        join(entry, 'mise', 'bin', 'mise.exe'),
        join(entry, 'mise', 'mise.exe'),
      ]) {
        const p = join(pkgRoot, rel)
        if (existsSync(p)) out.push(p)
      }
    }
  } catch {
    /* packages dir may not exist */
  }
  return out
}

function commonLocations(): string[] {
  const home = homedir()
  const local = process.env.LOCALAPPDATA ?? join(home, 'AppData', 'Local')
  return [
    join(local, 'Microsoft', 'WinGet', 'Links', 'mise.exe'),
    ...wingetPackageCandidates(),
    join(home, '.local', 'bin', 'mise.exe'),
    join(home, '.local', 'bin', 'mise'),
    '/usr/local/bin/mise',
  ]
}

export async function resolveMiseBinary(): Promise<string> {
  if (cachedBinary) return cachedBinary

  // Explicit override wins (useful when mise is not on the app's PATH).
  const override = process.env.MISE_BIN
  if (override && override.trim()) {
    cachedBinary = override.trim()
    return cachedBinary
  }

  const fromWhere = await tryWhere()
  if (fromWhere) {
    cachedBinary = fromWhere
    return fromWhere
  }
  for (const loc of commonLocations()) {
    if (existsSync(loc)) {
      cachedBinary = loc
      return loc
    }
  }
  // Last resort: assume it is on PATH under the bare name.
  cachedBinary = 'mise'
  return cachedBinary
}

// A mise child must see the directories the user saved, not the ones this
// process happened to inherit when it was launched.
function childEnv(): NodeJS.ProcessEnv {
  return { ...process.env, ...miseEnvOverrides() }
}

function runRaw(
  binary: string,
  args: string[],
  cwd?: string,
  timeout = 30_000,
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(binary, args, {
      cwd,
      env: childEnv(),
      windowsHide: true,
      timeout,
    })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (d) => (stdout += d.toString()))
    child.stderr.on('data', (d) => (stderr += d.toString()))
    child.on('error', (err) => {
      resolve({ code: -1, stdout, stderr: stderr || err.message })
    })
    child.on('close', (code, signal) => resolve({
      code: code ?? -1, stdout, stderr: stderr || (signal ? `mise terminated (${signal})` : ''),
    }))
  })
}

export function runStream(
  binary: string,
  args: string[],
  cwd: string | undefined,
  onEvent: (e: RunEvent) => void,
  timeout?: number,
): Promise<RunResult> {
  return new Promise((resolve) => {
    const child = spawn(binary, args, {
      cwd,
      env: childEnv(),
      windowsHide: true,
      timeout,
    })
    let stdout = ''
    let stderr = ''
    let finished = false
    const finish = (code: number) => {
      if (finished) return
      finished = true
      onEvent({ type: 'exit', data: '', code })
      resolve({ ok: code === 0, code, stdout, stderr })
    }

    const pipe = (stream: NodeJS.ReadableStream, type: 'stdout' | 'stderr') => {
      let buf = ''
      const decoder = new StringDecoder('utf8')
      stream.on('data', (chunk: Buffer) => {
        const text = decoder.write(chunk)
        if (type === 'stdout') stdout += text
        else stderr += text
        buf += text
        let idx: number
        // curl uses carriage returns for progress; waiting only for newlines
        // makes a live download look frozen until the process exits.
        while ((idx = buf.search(/[\r\n]/)) >= 0) {
          const line = buf.slice(0, idx)
          if (line) onEvent({ type, data: line })
          buf = buf.slice(idx + 1)
        }
      })
      stream.on('end', () => {
        const rest = decoder.end()
        buf += rest
        if (type === 'stdout') stdout += rest
        else stderr += rest
        if (buf) onEvent({ type, data: buf })
      })
    }

    pipe(child.stdout, 'stdout')
    pipe(child.stderr, 'stderr')

    child.on('error', (err) => {
      onEvent({ type: 'stderr', data: err.message })
      stderr += `${stderr && !stderr.endsWith('\n') ? '\n' : ''}${err.message}`
      finish(-1)
    })
    child.on('close', (code, signal) => {
      if (signal) {
        const message = `Process terminated (${signal}); the operation may have timed out. Check network/proxy settings and retry.`
        stderr += `${stderr && !stderr.endsWith('\n') ? '\n' : ''}${message}`
        onEvent({ type: 'stderr', data: message })
      }
      finish(code ?? -1)
    })
  })
}

export async function detect(force = false): Promise<MiseStatus> {
  // Explicit refresh must also rediscover the binary after an install or move.
  if (force) {
    cachedBinary = null
    statusCache = null
  }
  if (!force && statusCache && Date.now() - statusCache.at < DETECT_TTL) return statusCache.status
  const binary = await resolveMiseBinary()
  let res: { code: number; stdout: string; stderr: string }
  try {
    res = await runRaw(binary, ['--version'], undefined, 8000)
  } catch (err) {
    // Windows can throw synchronously for a corrupt/non-executable override.
    cachedBinary = null
    statusCache = null
    return { installed: false, error: err instanceof Error ? err.message : String(err) }
  }
  let status: MiseStatus
  if (res.code !== 0 || !res.stdout.trim()) {
    status = { installed: false, error: res.stderr.trim() || 'failed to run mise' }
  } else {
    // `mise --version` prints e.g. "mise 2026.10.12 windows-x64 (2026-10-16)".
    // Keep only the version number — the arch and build date are noise here.
    const version = res.stdout.trim().replace(/^mise\s*/i, '').split(/\s+/)[0]
    status = { installed: true, version, path: binary }
  }
  // Never cache a miss: the common case is "install mise, then hit refresh".
  if (status.installed) statusCache = { at: Date.now(), status }
  else {
    cachedBinary = null
    statusCache = null
  }
  return status
}

export async function listInstalled(cwd?: string): Promise<InstalledTool[]> {
  const binary = await resolveMiseBinary()
  // Two invocations, merged by parseLsJson. Measured on 2026.10.12: `ls --json`
  // lists downloads and requests in the current chain, while `--all-sources`
  // adds requests from other tracked projects, including missing versions.
  const [res, all] = await Promise.all([
    runRaw(binary, ['ls', '--json'], cwd),
    runRaw(binary, ['ls', '--json', '--all-sources'], cwd),
  ])
  // Warnings (e.g. pending update) can make mise exit non-zero while still
  // printing valid JSON, so parse stdout first and only then check the code.
  if (!res.stdout.trim()) return []
  let tools: unknown
  try {
    tools = JSON.parse(res.stdout)
  } catch {
    return []
  }
  let sources: unknown
  try {
    sources = all.stdout.trim() ? JSON.parse(all.stdout) : null
  } catch {
    // The links are an addition to the list, not a condition for showing it.
    sources = null
  }
  return parseLsJson(tools, sources)
}

// mise remembers every config file it has loaded, in any project, so the list of
// projects the machine actually uses comes from mise rather than from a scan.
// `--json` is ignored with this flag (measured), so the output is one path per
// line and only lines that look like config files are kept.
export async function listTrackedConfigs(): Promise<string[]> {
  const binary = await resolveMiseBinary()
  const res = await runRaw(binary, ['config', 'ls', '--tracked-configs'])
  if (res.code !== 0) return []
  return res.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /(\.toml|\.ya?ml|\.tool-versions)$/i.test(line))
}

export async function listRemote(tool: string): Promise<RemoteVersion[]> {
  const binary = await resolveMiseBinary()
  const res = await runRaw(binary, ['ls-remote', tool], undefined, 120_000)
  if (res.code !== 0) throw new Error(res.stderr.trim() || `mise ls-remote failed (${res.code})`)
  return parseRemote(res.stdout).map((version) => ({ version }))
}

export async function listRegistry(): Promise<RegistryTool[]> {
  const binary = await resolveMiseBinary()

  const res = await runRaw(binary, ['registry', '--json'])
  if (res.code === 0 && res.stdout.trim()) {
    try {
      const fromJson = parseRegistryJson(JSON.parse(res.stdout))
      if (fromJson) return fromJson
    } catch {
      // fall through to plain-text parsing
    }
  }

  const res2 = await runRaw(binary, ['registry'])
  if (res2.code !== 0) return []
  return parseRegistryText(res2.stdout)
}

export async function listTasks(cwd?: string): Promise<MiseTask[]> {
  const binary = await resolveMiseBinary()
  const res = await runRaw(binary, ['tasks', 'ls', '--json'], cwd)
  if (!res.stdout.trim()) return []
  try {
    return parseTasksJson(JSON.parse(res.stdout))
  } catch {
    return []
  }
}

export function install(
  tool: string,
  version: string,
  opts: { pin: boolean; cwd?: string; configPath?: string; additionalVersions?: string[] },
  onEvent: (e: RunEvent) => void,
): Promise<RunResult> {
  const spec = version ? `${tool}@${version}` : tool
  const args = opts.pin ? ['use', spec] : ['install', spec]
  if (opts.pin && opts.additionalVersions) args.push(...[...new Set(opts.additionalVersions)].filter(v => v !== version).map(v => `${tool}@${v}`))
  // cwd alone cannot identify config.toml or a non-default project file.
  // An explicit file also lets mise create the selected global config safely.
  if (opts.pin && opts.configPath) args.push('--path', opts.configPath)
  return resolveMiseBinary().then((binary) => runStream(binary, args, opts.cwd, onEvent))
}

export function uninstall(
  tool: string,
  version: string,
  onEvent: (e: RunEvent) => void,
): Promise<RunResult> {
  const spec = version ? `${tool}@${version}` : tool
  return resolveMiseBinary().then((binary) =>
    runStream(binary, ['uninstall', spec], undefined, onEvent),
  )
}

export function unuse(
  tool: string,
  version: string,
  cwd: string | undefined,
  onEvent: (e: RunEvent) => void,
  configPath?: string,
): Promise<RunResult> {
  const spec = version ? `${tool}@${version}` : tool
  // --no-prune keeps the downloaded version: 不启用 only drops it from the config.
  const args = ['unuse', spec, '--no-prune']
  if (configPath) args.push('--path', configPath)
  return resolveMiseBinary().then((binary) => runStream(binary, args, cwd, onEvent))
}

// Imports an installation the user made themselves — compiled by hand, or put
// there by another tool. mise symlinks the directory instead of downloading, so
// nothing is copied and the original stays where it is. Measured on 2026.10.12:
// the version is used exactly as written and `latest`/aliases/channels are
// rejected, and an existing entry only goes in with --force.
export function link(
  tool: string,
  version: string,
  path: string,
  force: boolean,
  onEvent: (e: RunEvent) => void,
): Promise<RunResult> {
  const args = ['link', `${tool}@${version}`, path]
  if (force) args.push('--force')
  return resolveMiseBinary().then((binary) => runStream(binary, args, undefined, onEvent))
}

export function runTask(
  task: string,
  opts: { cwd?: string },
  onEvent: (e: RunEvent) => void,
): Promise<RunResult> {
  return resolveMiseBinary().then((binary) =>
    runStream(binary, ['run', task], opts.cwd, onEvent),
  )
}

export async function getDoctor(): Promise<DoctorInfo> {
  const binary = await resolveMiseBinary()
  const res = await runRaw(binary, ['doctor', '--json'], undefined, 8000)
  // mise doctor exits non-zero whenever warnings exist (e.g. an available
  // update) but still prints the full JSON report — parse it regardless.
  if (res.stdout.trim()) {
    try {
      return JSON.parse(res.stdout) as DoctorInfo
    } catch {
      return { warnings: ['无法解析 mise doctor --json 输出'] }
    }
  }
  return { warnings: [res.stderr.trim() || `mise doctor 失败（退出码 ${res.code}）`] }
}

export function trustConfig(
  path: string,
  onEvent: (e: RunEvent) => void,
  cwd?: string,
): Promise<RunResult> {
  return resolveMiseBinary().then((binary) => runStream(binary, ['trust', path], cwd, onEvent))
}

function parseSettingsJson(res: { stdout: string }): Record<string, unknown> {
  try {
    const v: unknown = JSON.parse(res.stdout)
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

// `settings ls --all --json` is the flat key -> effective value map; the same
// call without --all lists only what the user actually wrote to a config file.
// Two spawns (~150ms each) beat guessing, and the UI needs both to mark a row
// as configured.
export async function getSettings(): Promise<SettingsInfo> {
  const binary = await resolveMiseBinary()
  const [all, configured] = await Promise.all([
    runRaw(binary, ['settings', 'ls', '--all', '--json']),
    runRaw(binary, ['settings', 'ls', '--json']),
  ])
  return { all: parseSettingsJson(all), configured: parseSettingsJson(configured) }
}

// `mise settings set` always writes the global config, so no cwd is passed.
function settingRun(args: string[]): Promise<RunResult> {
  return resolveMiseBinary().then(async (binary) => {
    const res = await runRaw(binary, args)
    return { ok: res.code === 0, code: res.code, stdout: res.stdout, stderr: res.stderr }
  })
}

export function setSetting(key: string, value: string): Promise<RunResult> {
  return settingRun(['settings', 'set', key, value])
}

export function unsetSetting(key: string): Promise<RunResult> {
  return settingRun(['settings', 'unset', key])
}
