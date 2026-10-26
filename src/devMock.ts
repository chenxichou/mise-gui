// DEV-ONLY mock of the Electron `window.mise` bridge so the UI can be previewed
// in a plain browser (vite dev) without a real mise install. Never bundled into
// production: main.tsx imports it only when import.meta.env.DEV is true.
import type {
  ConfigContent,
  ConfigPin,
  DoctorInfo,
  EnvDirInfo,
  EnvVarName,
  InstalledTool,
  MiseApi,
  MiseTask,
  RegistryTool,
  RunEvent,
  RunResult,
} from './types'

// Stand-ins for the four directory env vars, mirroring what `mise doctor` reports
// on Windows with nothing configured.
const ENV_DEFAULTS: Record<EnvVarName, string> = {
  MISE_DATA_DIR: '~/AppData/Local/mise',
  MISE_CONFIG_DIR: '~/.config/mise',
  MISE_CACHE_DIR: '~/AppData/Local/Temp/mise',
  MISE_SHIMS_DIR: '~/AppData/Local/mise/shims',
  MISE_STATE_DIR: '~/.local/state/mise',
}
const envVarNames = Object.keys(ENV_DEFAULTS) as EnvVarName[]

const sampleTools: InstalledTool[] = [
  {
    name: 'node',
    versions: [
      {
        version: '20.11.0',
        requestedVersion: '20',
        sources: [{ path: '~/proj/mise.toml', requestedVersion: '20' }],
        installed: true,
        active: true,
        installPath: '~/.local/share/mise/installs/node/20.11.0',
      },
      {
        version: '22.11.0',
        requestedVersion: '22',
        sources: [{ path: '~/mise.toml', requestedVersion: '22' }],
        installed: false,
        active: false,
      },
      { version: '18.19.0', sources: [], installed: true, active: false },
    ],
  },
  {
    name: 'python',
    versions: [
      {
        version: '3.12.1',
        sources: [{ path: '~/proj/mise.toml', requestedVersion: '3.12' }],
        installed: true,
        active: true,
      },
    ],
  },
  {
    name: 'terraform',
    versions: [
      {
        version: '1.7.0',
        sources: [{ path: '~/.config/mise/config.toml', requestedVersion: '1.7' }],
        installed: true,
        active: false,
      },
      { version: '1.5.7', sources: [], installed: true, active: false },
    ],
  },
]

const sampleRegistry: RegistryTool[] = [
  { name: 'node', backend: 'core', description: 'Node.js runtime' },
  { name: 'python', backend: 'core', description: 'Python interpreter' },
  { name: 'terraform', backend: 'ubi', description: 'Terraform CLI' },
  { name: 'go', backend: 'core', description: 'Go toolchain' },
  { name: 'rust', backend: 'core', description: 'Rust toolchain' },
  { name: 'deno', backend: 'core', description: 'Deno runtime' },
  { name: 'bun', backend: 'core', description: 'Bun runtime' },
  { name: 'java', backend: 'core', description: 'Java (JDK)' },
]

const sampleTasks: MiseTask[] = [
  { name: 'build', description: '构建项目产物', source: '~/proj/mise.toml' },
  { name: 'test', description: '运行单元与集成测试', source: '~/proj/mise.toml', depends: ['build'] },
  { name: 'lint', description: '代码风格检查', source: '~/proj/mise.toml', aliases: ['l'] },
  {
    name: 'deploy',
    description: '部署到预发布环境',
    source: '~/proj/tasks/deploy.toml',
    depends: ['test', 'lint'],
  },
  { name: 'dev', description: '启动本地开发服务器', source: '~/proj/mise.toml' },
]

const sampleMiseToml = `[tools]
node = "20"
python = "3.12"

[env]
PROJECT_NAME = "demo"

[tasks.build]
run = "npm run build"
description = "构建项目产物"
`

// The global file carries [settings] plus two tables the page keeps behind 更多,
// so the preview shows both kinds of partition.
const sampleGlobalToml = `[settings]
verbose = false

[tools]
rust = "stable"

[alias]
node = ["22"]

[watched_files]
config = [".envrc"]
`

const samplePins: ConfigPin[] = [
  {
    path: '~/.config/mise/config.toml',
    dir: '~/.config/mise',
    kind: 'global',
    origin: 'global',
    exists: true,
  },
  { path: '~/proj/mise.toml', dir: '~/proj', kind: 'project', origin: 'tracked', exists: true },
  { path: '~/mise.toml', dir: '~', kind: 'project', origin: 'manual', exists: true },
]

const sampleConfigContents: Record<string, ConfigContent> = {
  '~/proj/mise.toml': {
    path: '~/proj/mise.toml',
    content: sampleMiseToml,
    parsed: {
      tools: { node: '20', python: '3.12' },
      env: { PROJECT_NAME: 'demo' },
      tasks: { build: { run: 'npm run build', description: '构建项目产物' } },
    },
  },
  '~/mise.toml': {
    path: '~/mise.toml',
    content: '[tools]\nnode = "22"\n',
    parsed: { tools: { node: '22' } },
  },
  '~/.config/mise/config.toml': {
    path: '~/.config/mise/config.toml',
    content: sampleGlobalToml,
    parsed: {
      settings: { verbose: false },
      tools: { rust: 'stable' },
      alias: { node: { latest: '22' } },
      plugins: { node: 'core' },
    },
  },
}

let pinsList: ConfigPin[] = samplePins.map((p) => ({ ...p }))
let importCount = 0

const sampleDoctor: DoctorInfo = {
  activated: true,
  self_update_available: false,
  shims_on_path: true,
  version: '2026.10.15 (mock)',
  warnings: ['mock 环境：以下数据为演示样本'],
  build_info: { target: 'x86_64-pc-windows-msvc', profile: 'release' },
  dirs: {
    cache: '~/.cache/mise',
    config: '~/.config/mise',
    data: '~/.local/share/mise',
    shims: '~/.local/share/mise/shims',
    system_shims: '/usr/local/share/mise/shims',
    state: '~/.local/state/mise',
  },
  shell: { name: 'powershell', path: 'pwsh.exe', parent_pid: 1234 },
  config_files: [
    { path: '~/proj/mise.toml', trusted: true },
    { path: '~/.config/mise/config.toml', trusted: true },
  ],
  env_files: [],
  env_vars: { MISE_HOME: '~/.local/share/mise', MISE_DISABLE_TOOLS: '' },
  settings: { color: true, verbose: false, cd: true, shell: { unix: 'bash' } },
}

function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

function clone(): InstalledTool[] {
  return JSON.parse(JSON.stringify(sampleTools))
}

let tools = clone()

// Values copied from a real `mise settings ls --all --json` run.
const sampleSettings: Record<string, unknown> = {
  activate_shims: true,
  always_keep_download: false,
  always_keep_install: false,
  auto_install: true,
  cache_prune_age: '30d',
  color: true,
  disable_update_warning: false,
  download_cache: true,
  download_cache_max_size: '2GiB',
  experimental: false,
  fetch_remote_versions_timeout: '20s',
  http_retries: 3,
  http_timeout: '30s',
  jobs: 8,
  legacy_version_file: true,
  offline: false,
  pin: false,
  quiet: false,
  trusted_config_paths: [],
  use_versions_host: true,
  verbose: false,
  windows_default_inline_shell_args: 'cmd /c',
  windows_shim_mode: 'exe',
}
const settingsOverrides: Record<string, unknown> = {}
const envDirOverrides: Partial<Record<EnvVarName, string>> = {}

function mockValue(raw: string): unknown {
  if (raw === 'true') return true
  if (raw === 'false') return false
  if (/^-?\d+$/.test(raw)) return Number(raw)
  return raw
}

const api: MiseApi = {
  async getInstaller() {
    return { supported: false, command: '', method: 'unavailable' }
  },
  async installMise() {
    return { ok: false, code: -1, stdout: '', stderr: 'Installation is only available in the desktop app' }
  },
  async detect() {
    await delay(150)
    return { installed: true, version: '2026.10.15 (mock)', path: 'mise' }
  },
  async setLangPref() {
    /* no native menu in browser dev */
  },
  async listInstalled() {
    await delay(150)
    return JSON.parse(JSON.stringify(tools))
  },
  async listRemote(tool) {
    await delay(300)
    if (tool === 'node')
      return ['16.20.2', '18.19.0', '20.11.0', '21.6.0', '22.0.0'].map((version) => ({ version }))
    if (tool === 'python')
      return ['3.10.13', '3.11.7', '3.12.1', '3.13.0'].map((version) => ({ version }))
    return ['1.0.0', '1.1.0', '2.0.0'].map((version) => ({ version }))
  },
  async listRegistry() {
    await delay(200)
    return sampleRegistry
  },
  async listTasks(configPath?: string) {
    await delay(200)
    // Mirrors the real main process, which runs `mise tasks ls` inside the
    // selected file's directory: switching the selection must change the rows.
    const pin = pinsList.find((p) => p.path === configPath)
    if (!pin) return []
    const clone = JSON.parse(JSON.stringify(sampleTasks)) as MiseTask[]
    return clone.map((task) => ({
      ...task,
      source: task.source ? `${pin.dir}/${task.source.split('/').pop()}` : task.source,
    }))
  },
  async install(tool, version, opts, onEvent) {
    onEvent({ type: 'stdout', data: `mise: installing ${tool}@${version}…` } as RunEvent)
    await delay(700)
    onEvent({ type: 'stdout', data: `mise: ${tool}@${version} installed` } as RunEvent)
    // The pinned request lands in the selected file, mirroring the real
    // `mise use` run inside that file's directory.
    const file = opts.configPath ?? '~/proj/mise.toml'
    const existing = tools.find((t) => t.name === tool)
    if (existing) {
      if (!existing.versions.some((v) => v.version === version)) {
        existing.versions.push({ version, sources: [], installed: true, active: false })
      }
      existing.versions.forEach((v) => {
        if (v.version === version) {
          v.installed = true
          v.installPath = `~/.local/share/mise/installs/${tool}/${version}`
          if (opts.pin) {
            // `mise use` both activates and declares the version in the config.
            v.active = true
            v.requestedVersion = v.version
            v.sources = [...v.sources.filter(source => source.path !== file), { path: file, requestedVersion: v.version }]
          }
        }
      })
      if (opts.pin) {
        // One key per tool in a config file: re-pinning moves the request, it
        // does not add a second row.
        for (const v of existing.versions) {
          if (v.version === version) continue
          v.active = false
          v.sources = v.sources.filter((s) => s.path !== file)
        }
      }
    } else {
      tools.push({
        name: tool,
        versions: [
          {
            version,
            requestedVersion: opts.pin ? version : undefined,
            sources: opts.pin ? [{ path: file, requestedVersion: version }] : [],
            installed: true,
            active: opts.pin,
          },
        ],
      })
    }
    onEvent({ type: 'exit', data: '', code: 0 } as RunEvent)
    return { ok: true, code: 0, stdout: '', stderr: '' } as RunResult
  },
  async changeConnection(change, onEvent) {
    const { from, to } = change
    const old = tools.find(tool => tool.name === from.tool)?.versions.find(v => v.version === from.version)
    if (old && (change.action || from.disabled)) {
      if (change.action === 'disable' && !from.disabled) {
        const source = old.sources.find(s => s.path === from.configPath)
        if (!source) return { ok: false, code: -1, stdout: '', stderr: 'Connection changed' }
        old.disabledSources = [...(old.disabledSources ?? []), source]
        old.sources = old.sources.filter(s => s.path !== from.configPath)
        old.active = old.sources.length > 0
      } else if (from.disabled) {
        const source = old.disabledSources?.find(s => s.path === from.configPath)
        if (!source) return { ok: false, code: -1, stdout: '', stderr: 'Disabled connection changed' }
        if (change.action === 'enable' || to) {
          const target = to ? tools.find(t => t.name === to.tool)?.versions.find(v => v.version === to.version) : old
          if (!target) return { ok: false, code: -1, stdout: '', stderr: 'Target version not found' }
          target.installed = true; target.active = true
          target.sources.push(to && to.version !== from.version ? { path: from.configPath, requestedVersion: to.version } : source)
        }
        old.disabledSources = old.disabledSources?.filter(s => s.path !== from.configPath)
      }
      onEvent({ type: 'exit', data: '', code: 0 })
      return { ok: true, code: 0, stdout: '', stderr: '' }
    }
    const siblings = to?.tool === from.tool && to.configPath === from.configPath
      ? tools.find(tool => tool.name === from.tool)?.versions.filter(v => v !== old).map(v => ({ v, source: v.sources.find(s => s.path === from.configPath) })) ?? [] : []
    if (!old?.sources.some(s => s.path === from.configPath)) {
      onEvent({ type: 'exit', data: '', code: -1 })
      return { ok: false, code: -1, stdout: '', stderr: 'Connection changed. Refresh and try again.' }
    }
    const forward = (event: RunEvent) => { if (event.type !== 'exit') onEvent(event) }
    if (to) {
      const result = await api.install(to.tool, to.version, { pin: true, configPath: to.configPath }, forward)
      if (!result.ok) { onEvent({ type: 'exit', data: '', code: result.code }); return result }
      for (const { v, source } of siblings) if (source && v.version !== to.version) v.sources.push(source)
    }
    if (!to || to.tool !== from.tool || to.configPath !== from.configPath) {
      old.sources = old.sources.filter(s => s.path !== from.configPath)
      if (!old.sources.length) old.active = false
    }
    onEvent({ type: 'stdout', data: 'mise: connection updated (mock)' })
    onEvent({ type: 'exit', data: '', code: 0 })
    return { ok: true, code: 0, stdout: '', stderr: '' }
  },
  async uninstall(tool, version, onEvent) {
    onEvent({ type: 'stdout', data: `mise: uninstalling ${tool}@${version}…` } as RunEvent)
    await delay(600)
    const t = tools.find((x) => x.name === tool)
    if (t) {
      t.versions = t.versions.filter((v) => v.version !== version)
      if (t.versions.length === 0) tools = tools.filter((x) => x.name !== tool)
    }
    onEvent({ type: 'exit', data: '', code: 0 } as RunEvent)
    return { ok: true, code: 0, stdout: '', stderr: '' } as RunResult
  },
  async unuse(tool, version, configPath, onEvent) {
    const file = configPath ?? '~/proj/mise.toml'
    onEvent({ type: 'stdout', data: `mise removed: ${tool}@${version} from ${file}` } as RunEvent)
    await delay(400)
    const t = tools.find((x) => x.name === tool)
    if (t) {
      for (const v of t.versions) {
        if (v.sources.some((s) => s.path === file)) {
          v.sources = v.sources.filter((s) => s.path !== file)
          if (v.sources.length === 0) {
            v.requestedVersion = undefined
            v.active = false
          }
        }
      }
    }
    onEvent({ type: 'exit', data: '', code: 0 } as RunEvent)
    return { ok: true, code: 0, stdout: '', stderr: '' } as RunResult
  },
  async link(tool, version, path, force, onEvent) {
    onEvent({
      type: 'stdout',
      data: `mise: linking ${tool}@${version} -> ${path}${force ? ' (force)' : ''}`,
    } as RunEvent)
    await delay(400)
    // `mise link` only registers the directory; unlike `mise use` it writes no
    // config, so the new version has no sources and lands in the 未启用 bucket.
    const t = tools.find((x) => x.name === tool)
    const v = { version, sources: [], installed: true, active: false, installPath: path }
    if (t) {
      const i = t.versions.findIndex((x) => x.version === version)
      if (i >= 0) t.versions[i] = { ...t.versions[i], ...v }
      else t.versions.push(v)
    } else {
      tools.push({ name: tool, versions: [v] })
    }
    onEvent({ type: 'exit', data: '', code: 0 } as RunEvent)
    return { ok: true, code: 0, stdout: '', stderr: '' } as RunResult
  },
  async runTask(task, _opts, onEvent) {
    onEvent({ type: 'stdout', data: `[task ${task}] 开始执行…` } as RunEvent)
    await delay(400)
    onEvent({ type: 'stdout', data: `[task ${task}] 步骤 1/2 完成` } as RunEvent)
    await delay(400)
    onEvent({ type: 'stdout', data: `[task ${task}] 步骤 2/2 完成` } as RunEvent)
    await delay(200)
    onEvent({ type: 'exit', data: '', code: 0 } as RunEvent)
    return { ok: true, code: 0, stdout: '', stderr: '' } as RunResult
  },
  async getDoctor() {
    await delay(200)
    return JSON.parse(JSON.stringify(sampleDoctor)) as DoctorInfo
  },
  async getSettings() {
    await delay(200)
    return {
      all: { ...sampleSettings, ...settingsOverrides },
      configured: { ...settingsOverrides },
    }
  },
  async setSetting(key, value) {
    await delay(150)
    settingsOverrides[key] = mockValue(value)
    return { ok: true, code: 0, stdout: '', stderr: '' } as RunResult
  },
  async unsetSetting(key) {
    await delay(150)
    delete settingsOverrides[key]
    return { ok: true, code: 0, stdout: '', stderr: '' } as RunResult
  },
  async getWorkDir() {
    return '~/proj'
  },
  async chooseWorkDir() {
    await delay(100)
    return '~/proj'
  },
  async pickFolder() {
    await delay(100)
    return null
  },
  async getEnvDirs() {
    await delay(120)
    const out = {} as Record<EnvVarName, EnvDirInfo>
    const data = envDirOverrides.MISE_DATA_DIR ?? ENV_DEFAULTS.MISE_DATA_DIR
    for (const v of envVarNames) {
      const persisted = envDirOverrides[v] ?? null
      out[v] = {
        variable: v,
        current: persisted ?? (v === 'MISE_SHIMS_DIR' ? `${data}/shims` : ENV_DEFAULTS[v]),
        persisted,
        fallback: ENV_DEFAULTS[v],
        source: persisted ? 'user' : v === 'MISE_SHIMS_DIR' ? 'data' : 'default',
        verified: false,
        exists: true,
        editable: true,
      }
    }
    return out
  },
  async setEnvDir(v, path) {
    await delay(200)
    envDirOverrides[v] = path
    return { ok: true }
  },
  async clearEnvDir(v) {
    await delay(200)
    delete envDirOverrides[v]
    return { ok: true }
  },
  async getPins() {
    await delay(150)
    return pinsList.map((p) => ({ ...p }))
  },
  async pickPin() {
    await delay(200)
    // A browser preview has no file dialog, so 引入 invents an imported file and
    // gives it sample content.
    importCount += 1
    const path = `~/imported/demo-${importCount}/mise.toml`
    const dir = path.slice(0, path.lastIndexOf('/'))
    const pin: ConfigPin = { path, dir, kind: 'project', origin: 'manual', exists: true }
    if (!pinsList.some((p) => p.path === path)) {
      pinsList = [...pinsList, pin]
      sampleConfigContents[path] = {
        path,
        content: '[tools]\nbun = "latest"\n',
        parsed: { tools: { bun: 'latest' } },
      }
    }
    return { ok: true, pin }
  },
  async dropPin(path) {
    await delay(150)
    // Only imported files can be forgotten; mise keeps saying the rest are loaded.
    pinsList = pinsList.filter((p) => !(p.path === path && p.origin === 'manual'))
    return pinsList.map((p) => ({ ...p }))
  },
  async readConfig(path) {
    await delay(120)
    const c = sampleConfigContents[path]
    if (!c) return { path, content: '', parsed: null, error: '文件不存在（mock）' }
    return { ...c, parsed: c.parsed ? ({ ...c.parsed } as Record<string, unknown>) : null }
  },
  async writeConfig(path, content) {
    await delay(250)
    if (content.includes('[bad]')) {
      return { ok: false, error: 'TOML 解析失败（mock）' } as { ok: boolean; error?: string }
    }
    sampleConfigContents[path] = {
      path,
      content,
      parsed: { note: 'mock 解析结果', saved_at: new Date().toISOString() },
    }
    return { ok: true } as { ok: boolean }
  },
  async trustConfig(_path, onEvent) {
    onEvent({ type: 'stdout', data: 'mise: 配置已信任 (mock)' } as RunEvent)
    await delay(300)
    onEvent({ type: 'exit', data: '', code: 0 } as RunEvent)
    return { ok: true, code: 0, stdout: '', stderr: '' } as RunResult
  },
  async openFolder() {
    // No file manager in the browser preview; the UI toast is the feedback.
    return ''
  },
}

export function installDevMock() {
  ;(window as unknown as { mise: MiseApi }).mise = api
  console.info('[mise-gui] dev mock installed (no real mise detected)')
}
