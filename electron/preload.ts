import { contextBridge, ipcRenderer } from 'electron'
import type { EnvVarName, MiseApi, RunEvent, RunResult } from '../src/types'

let counter = 0
function nextReqId(): string {
  counter += 1
  return `req_${Date.now()}_${counter}`
}

// Invoke a streaming command, relaying each event to onEvent until it resolves.
function stream(
  channel: string,
  args: unknown,
  onEvent: (e: RunEvent) => void,
): Promise<RunResult> {
  const reqId = nextReqId()
  const eventChannel = `mise:event:${reqId}`
  let finish!: () => void
  const ended = new Promise<void>(resolve => { finish = resolve })
  const listener = (_e: unknown, payload: RunEvent) => {
    try { onEvent(payload) } finally {
      if (payload.type === 'exit') finish()
    }
  }
  ipcRenderer.on(eventChannel, listener)
  return ipcRenderer
    .invoke(channel, { reqId, args })
    // Invoke replies and streamed IPC messages travel separately. Wait for the
    // final event before detaching, including on immediate startup failures.
    .then(async (result: RunResult) => { await ended; return result })
    .finally(() => ipcRenderer.removeListener(eventChannel, listener))
}

const api: MiseApi = {
  detect: (force?: boolean) => ipcRenderer.invoke('mise:detect', !!force),
  getInstaller: () => ipcRenderer.invoke('mise:get-installer'),
  installMise: (onEvent) => stream('mise:install-mise', {}, onEvent),
  setLangPref: (lang: string, theme?: string) =>
    ipcRenderer.invoke('mise:set-lang-pref', lang, theme),
  getWorkDir: () => ipcRenderer.invoke('mise:get-workdir'),
  chooseWorkDir: () => ipcRenderer.invoke('mise:choose-workdir'),
  pickFolder: (title: string, defaultPath: string) =>
    ipcRenderer.invoke('mise:choose-folder', title, defaultPath),
  getEnvDirs: () => ipcRenderer.invoke('mise:get-env-dirs'),
  setEnvDir: (v: EnvVarName, path: string) => ipcRenderer.invoke('mise:set-env-dir', v, path),
  clearEnvDir: (v: EnvVarName) => ipcRenderer.invoke('mise:clear-env-dir', v),
  listInstalled: (configPath?: string) => ipcRenderer.invoke('mise:list-installed', configPath),
  listRemote: (tool: string) => ipcRenderer.invoke('mise:list-remote', tool),
  listRegistry: () => ipcRenderer.invoke('mise:list-registry'),
  listTasks: (configPath?: string) => ipcRenderer.invoke('mise:list-tasks', configPath),
  getDoctor: () => ipcRenderer.invoke('mise:get-doctor'),
  getSettings: () => ipcRenderer.invoke('mise:get-settings'),
  setSetting: (key: string, value: string) =>
    ipcRenderer.invoke('mise:set-setting', key, value),
  unsetSetting: (key: string) => ipcRenderer.invoke('mise:unset-setting', key),
  getPins: (force?: boolean) => ipcRenderer.invoke('mise:get-pins', !!force),
  pickPin: () => ipcRenderer.invoke('mise:pick-pin'),
  dropPin: (path: string) => ipcRenderer.invoke('mise:drop-pin', path),
  readConfig: (path: string) => ipcRenderer.invoke('mise:read-config', path),
  writeConfig: (path: string, content: string) =>
    ipcRenderer.invoke('mise:write-config', path, content),
  trustConfig: (path, onEvent) => stream('mise:trust-config', { path }, onEvent),
  install: (tool, version, opts, onEvent) =>
    stream('mise:install', { tool, version, opts }, onEvent),
  uninstall: (tool, version, onEvent) =>
    stream('mise:uninstall', { tool, version }, onEvent),
  unuse: (tool, version, configPath, onEvent) =>
    stream('mise:unuse', { tool, version, configPath }, onEvent),
  changeConnection: (change, onEvent) => stream('mise:change-connection', change, onEvent),
  link: (tool, version, path, force, onEvent) =>
    stream('mise:link', { tool, version, path, force }, onEvent),
  runTask: (task, opts, onEvent) => stream('mise:run-task', { task, opts }, onEvent),
  openFolder: (path: string) => ipcRenderer.invoke('mise:open-folder', path),
}

contextBridge.exposeInMainWorld('mise', api)

const windowControls = {
  minimize: () => ipcRenderer.invoke('win:minimize'),
  toggleMaximize: () => ipcRenderer.invoke('win:toggle-maximize'),
  close: () => ipcRenderer.invoke('win:close'),
  onMaximizedChanged: (cb: (maximized: boolean) => void) => {
    const listener = (_e: unknown, maximized: boolean) => cb(maximized)
    ipcRenderer.on('win:maximized', listener)
    return () => ipcRenderer.removeListener('win:maximized', listener)
  },
  onMenuAction: (cb: (action: 'docs') => void) => {
    const listener = (_e: unknown, action: 'docs') => cb(action)
    ipcRenderer.on('menu:action', listener)
    return () => ipcRenderer.removeListener('menu:action', listener)
  },
}

contextBridge.exposeInMainWorld('windowControls', windowControls)
