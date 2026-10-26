// Shared types between Electron main process and the React renderer.

export type MiseStatus =
  | { installed: true; version: string; path: string }
  | { installed: false; error: string }

export interface InstalledVersion {
  version: string
  requestedVersion?: string
  // Empty when no config requests this version. Unrequested downloads share
  // one idle connection on the tool node instead of individual version links.
  sources: ToolSource[]
  disabledSources?: ToolSource[]
  installed: boolean
  active: boolean
  installPath?: string
}

export interface InstalledTool {
  name: string
  versions: InstalledVersion[]
}

export interface ToolConnection {
  tool: string
  version: string
  requestedVersion?: string
  configPath: string
  otherRequests?: string[]
  disabled?: boolean
}

export interface ConnectionChange {
  from: ToolConnection
  action?: 'disable' | 'enable'
  // Omitting the destination disconnects the request and keeps the download.
  to?: { tool: string; version: string; configPath: string }
}

export interface RemoteVersion {
  version: string
}

export interface RegistryTool {
  name: string
  description?: string
  backend?: string
  backends?: string[]
  bins?: string[]
  aliases?: string[]
}

export interface MiseTask {
  name: string
  description?: string
  source?: string
  aliases?: string[]
  depends?: string[]
  hide?: boolean
}

// A single line of output produced while running a mise command.
export interface RunEvent {
  type: 'stdout' | 'stderr' | 'exit'
  data: string
  code?: number
}

export interface RunResult {
  ok: boolean
  code: number
  stdout: string
  stderr: string
}

export interface MiseInstaller {
  supported: boolean
  command: string
  method: 'powershell' | 'shell' | 'unavailable'
}

// `mise doctor --json` is a structured object; kept loose so the UI can render
// every section generically while highlighting a few known fields.
export interface DoctorInfo {
  activated?: boolean
  self_update_available?: boolean
  shims_on_path?: boolean
  version?: string
  warnings?: string[]
  build_info?: Record<string, unknown>
  dirs?: Record<string, unknown>
  shell?: Record<string, unknown>
  config_files?: unknown[]
  env_files?: unknown[]
  env_vars?: Record<string, unknown>
  settings?: Record<string, unknown>
  paths?: unknown[]
  [key: string]: unknown
}

export interface ConfigContent {
  path: string
  content: string
  parsed: Record<string, unknown> | null
  error?: string
}

// A config file the app manages. `dir` is the directory mise has to run in for
// this file's chain to include it, so the pair replaces the single 默认工作目录.
// `origin` says where it came from: the global file, mise's own tracked list, or
// something the user imported.
export interface ConfigPin {
  path: string
  dir: string
  kind: 'global' | 'project'
  origin: 'global' | 'tracked' | 'manual'
  exists: boolean
}

// A config file that asks for a tool version. `mise ls --json` names one in
// `source` for the loaded chain and, with `--all-sources`, a `sources` array per
// version covering every file mise has seen; both shapes are measured and
// normalised to this in electron/parse.ts.
export interface ToolSource {
  path: string
  requestedVersion?: string
  // mise's own `type` field, e.g. "mise.toml" or ".tool-versions".
  kind?: string
}

export interface SettingsInfo {
  all: Record<string, unknown>
  configured: Record<string, unknown>
}

// Directory overrides. shims also supports the global shims_dir setting.
export type EnvVarName =
  | 'MISE_DATA_DIR'
  | 'MISE_CONFIG_DIR'
  | 'MISE_CACHE_DIR'
  | 'MISE_SHIMS_DIR'
  | 'MISE_STATE_DIR'

export interface EnvDirInfo {
  variable: EnvVarName
  current: string
  persisted: string | null
  fallback: string
  source: 'user' | 'environment' | 'xdg' | 'data' | 'default' | 'detected'
  verified: boolean
  exists: boolean
  editable: boolean
}

export interface MiseApi {
  detect(force?: boolean): Promise<MiseStatus>
  getInstaller(): Promise<MiseInstaller>
  installMise(onEvent: (e: RunEvent) => void): Promise<RunResult>
  setLangPref(lang: string, theme?: string): Promise<void>
  getWorkDir(): Promise<string>
  chooseWorkDir(): Promise<string | null>
  // Generic folder picker used by the settings page.
  pickFolder(title: string, defaultPath: string): Promise<string | null>
  getEnvDirs(): Promise<Record<EnvVarName, EnvDirInfo>>
  setEnvDir(v: EnvVarName, path: string): Promise<{ ok: boolean; error?: string }>
  clearEnvDir(v: EnvVarName): Promise<{ ok: boolean; error?: string }>
  listInstalled(configPath?: string): Promise<InstalledTool[]>
  listRemote(tool: string): Promise<RemoteVersion[]>
  listRegistry(): Promise<RegistryTool[]>
  listTasks(configPath?: string): Promise<MiseTask[]>
  // The config files the app manages, across projects: global first, then mise's
  // tracked list, then whatever the user imported.
  getPins(force?: boolean): Promise<ConfigPin[]>
  // Opens the main process's file picker and adds the chosen config file.
  // Cancelling answers { ok: true } with no pin; a rejected path answers with the
  // reason, because only an existing mise config can be managed.
  pickPin(): Promise<{ ok: boolean; pin?: ConfigPin; error?: string }>
  // Drops an imported pin; tracked and global pins stay because mise says so.
  dropPin(path: string): Promise<ConfigPin[]>
  readConfig(path: string): Promise<ConfigContent>
  writeConfig(path: string, content: string): Promise<{ ok: boolean; error?: string }>
  trustConfig(
    path: string,
    onEvent: (e: RunEvent) => void,
  ): Promise<RunResult>
  // `configPath` is the managed config file the write should land in; the main
  // process runs mise in that file's directory. Omit it for the fallback 工作目录.
  install(
    tool: string,
    version: string,
    opts: { pin: boolean; configPath?: string },
    onEvent: (e: RunEvent) => void,
  ): Promise<RunResult>
  uninstall(
    tool: string,
    version: string,
    onEvent: (e: RunEvent) => void,
  ): Promise<RunResult>
  // Stops using a version: `mise unuse <tool>@<requested version as written in
  // the config>` — the installed files are kept.
  unuse(
    tool: string,
    version: string,
    configPath: string | undefined,
    onEvent: (e: RunEvent) => void,
  ): Promise<RunResult>
  changeConnection(change: ConnectionChange, onEvent: (e: RunEvent) => void): Promise<RunResult>
  // Imports an installation the user made themselves: `mise link <tool>@<exact
  // version> <path>` symlinks that directory, it never copies or downloads.
  link(
    tool: string,
    version: string,
    path: string,
    force: boolean,
    onEvent: (e: RunEvent) => void,
  ): Promise<RunResult>
  runTask(
    task: string,
    opts: { configPath?: string },
    onEvent: (e: RunEvent) => void,
  ): Promise<RunResult>
  getDoctor(): Promise<DoctorInfo>
  // Global mise settings: every effective value plus the subset the user wrote
  // into a config file themselves.
  getSettings(): Promise<SettingsInfo>
  // Both write mise's global config, i.e. the file under MISE_CONFIG_DIR.
  setSetting(key: string, value: string): Promise<RunResult>
  unsetSetting(key: string): Promise<RunResult>
  // Reveals a directory in the OS file manager. Resolves to '' on success,
  // otherwise the platform error text.
  openFolder(path: string): Promise<string>
}

declare global {
  interface Window {
    mise: MiseApi
    windowControls?: {
      minimize(): Promise<void>
      toggleMaximize(): Promise<void>
      close(): Promise<void>
      onMaximizedChanged(cb: (maximized: boolean) => void): () => void
      onMenuAction(cb: (action: 'docs') => void): () => void
    }
  }
}

export {}
