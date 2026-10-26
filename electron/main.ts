import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, shell } from 'electron'
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { completeStream, parseStreamArguments, trustedRendererUrl, type StreamArguments } from './ipc.ts'
import * as mise from './mise.ts'
import { getInstaller, installMise } from './bootstrap.ts'
import { readConfig, writeConfig } from './config.ts'
import { changeConnection } from './connections.ts'
import { setDisabledStore, withDisabled } from './disabled.ts'
import { clearEnvDir, getEnvDirs, primeEnvCache, setEnvDir, withReportedDirs, type EnvVarName } from './envdir.ts'
import {
  addManualPin,
  getManualPins,
  listPins,
  invalidate as invalidatePins,
  managedFiles,
  removeManualPin,
  resolvePinDir,
  resolvePinForWrite,
  setManualPins,
} from './pins.ts'
import type { RunEvent, RunResult } from '../src/types'

let win: BrowserWindow | null = null
const rendererEntry = process.env.VITE_DEV_SERVER_URL ?? pathToFileURL(join(__dirname, '../dist/index.html')).href

function handle<Args extends unknown[], Result>(channel: string, listener: (event: Electron.IpcMainInvokeEvent, ...args: Args) => Result) {
  ipcMain.handle(channel, (event, ...args: Args) => {
    if (!win || event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame ||
      !trustedRendererUrl(event.senderFrame.url, rendererEntry)) throw new Error('Untrusted IPC sender')
    return listener(event, ...args)
  })
}

// The "m" brand square, also used for the taskbar/Alt+Tab entry and the About box.
const APP_ICON = nativeImage.createFromPath(
  join(__dirname, '..', 'electron', 'resources', 'icon.ico'),
)

// The directory used when a command is not bound to a specific config file.
// Pin-selected pages (配置/任务/工具) pass the pin's own directory instead, so
// this is only the fallback for commands that have no pin context yet.
let workDir = process.cwd()

// Native menu language and the imported config files. Persisted next to
// localStorage prefs so the menu is correct, and the pins present, at startup;
// the renderer re-syncs the language whenever the setting changes.
type Lang = 'zh' | 'en'
let menuLang: Lang = 'zh'
let menuTheme: 'dark' | 'light' = 'dark'

function prefsPath(): string {
  return join(app.getPath('userData'), 'mise-gui-prefs.json')
}

function readPrefs(): { lang?: string; theme?: string; pins?: unknown } {
  try {
    return JSON.parse(readFileSync(prefsPath(), 'utf8')) as {
      lang?: string
      theme?: string
      pins?: unknown
    }
  } catch {
    return {}
  }
}

// Everything the prefs file holds is rewritten together, so a partial write
// never drops the other keys.
function savePrefs(): void {
  try {
    writeFileSync(
      prefsPath(),
      JSON.stringify({ lang: menuLang, theme: menuTheme, pins: getManualPins() }),
      'utf8',
    )
  } catch {
    /* non-critical */
  }
}

function loadPrefs(): void {
  const raw = readPrefs()
  if (raw.lang === 'en') menuLang = 'en'
  if (raw.theme === 'light') menuTheme = 'light'
  // A pin whose file has since been deleted is not recoverable by mise either,
  // so drop it instead of showing a permanently broken card.
  if (Array.isArray(raw.pins)) {
    const alive = (raw.pins as string[]).filter((p) => typeof p === 'string' && existsSync(p))
    setManualPins(alive)
  }
}

function applyMenu(): void {
  const zh = menuLang === 'zh'
  const L = (zhText: string, enText: string) => (zh ? zhText : enText)

  const template: Electron.MenuItemConstructorOptions[] = [
    ...(process.platform === 'darwin'
      ? ([
          {
            label: 'Mise GUI',
            submenu: [
              { role: 'about' },
              { type: 'separator' },
              { role: 'services' },
              { type: 'separator' },
              { role: 'hide' },
              { role: 'hideOthers' },
              { role: 'unhide' },
              { type: 'separator' },
              { role: 'quit' },
            ],
          },
        ] as Electron.MenuItemConstructorOptions[])
      : []),
    {
      label: L('编辑', 'Edit'),
      submenu: [
        { role: 'undo', label: L('撤销', 'Undo') },
        { role: 'redo', label: L('重做', 'Redo') },
        { type: 'separator' },
        { role: 'cut', label: L('剪切', 'Cut') },
        { role: 'copy', label: L('复制', 'Copy') },
        { role: 'paste', label: L('粘贴', 'Paste') },
        { role: 'selectAll', label: L('全选', 'Select All') },
      ],
    },
    {
      label: L('查看', 'View'),
      submenu: [
        { role: 'reload', label: L('重新加载', 'Reload') },
        { role: 'forceReload', label: L('强制重新加载', 'Force Reload') },
        { role: 'toggleDevTools', label: L('开发者工具', 'Developer Tools') },
        { type: 'separator' },
        { role: 'togglefullscreen', label: L('全屏', 'Toggle Full Screen') },
      ],
    },
    {
      label: L('窗口', 'Window'),
      submenu: [
        { role: 'minimize', label: L('最小化', 'Minimize') },
        { role: 'zoom', label: L('缩放', 'Zoom') },
        ...(process.platform === 'win32'
          ? ([
              { type: 'separator' },
              {
                label: L('在文件管理器中打开工作目录', 'Open Working Directory'),
                click: () => void shell.openPath(workDir),
              },
            ] as Electron.MenuItemConstructorOptions[])
          : ([{ role: 'close', label: L('关闭', 'Close') }] as Electron.MenuItemConstructorOptions[])),
      ],
    },
    {
      label: L('帮助', 'Help'),
      submenu: [
        {
          label: L('文档中心', 'Documentation'),
          accelerator: 'F1',
          click: () => win?.webContents.send('menu:action', 'docs'),
        },
        {
          label: L('mise 官网', 'mise Website'),
          click: () => void shell.openExternal('https://mise.jdx.dev/'),
        },
        { type: 'separator' },
        {
          label: L('关于 Mise GUI', 'About Mise GUI'),
          click: () => {
            void dialog.showMessageBox({
              type: 'info',
              title: L('关于 Mise GUI', 'About Mise GUI'),
              message: 'Mise GUI',
              detail: L(
                `版本 ${app.getVersion()}\n\n为 mise 命令行工具提供图形界面的桌面应用。`,
                `Version ${app.getVersion()}\n\nA desktop GUI companion for the mise command-line tool.`,
              ),
              buttons: [L('好', 'OK')],
              icon: APP_ICON,
              noLink: true,
            })
          },
        },
      ],
    },
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

function createWindow() {
  win = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: menuTheme === 'light' ? '#f6f8fa' : '#0d1117',
    icon: APP_ICON,
    // Frameless: the renderer draws its own title bar with window controls.
    // The native menu stays available (Alt) for standard edit accelerators.
    frame: false,
    autoHideMenuBar: true,
    title: 'Mise GUI',
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (event, url) => {
    if (!trustedRendererUrl(url, rendererEntry)) event.preventDefault()
  })
  win.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
  win.webContents.session.setPermissionCheckHandler(() => false)

  const sendMaximized = () => {
    win?.webContents.send('win:maximized', win.isMaximized())
  }
  win.on('maximize', sendMaximized)
  win.on('unmaximize', sendMaximized)
  win.webContents.on('did-finish-load', sendMaximized)

  if (process.env.VITE_DEV_SERVER_URL) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL)
  } else {
    win.loadFile(join(__dirname, '../dist/index.html'))
  }
}

function focusedWindow(event: Electron.IpcMainInvokeEvent): BrowserWindow | null {
  const w = BrowserWindow.fromWebContents(event.sender)
  return w && !w.isDestroyed() ? w : null
}

handle('win:minimize', (e) => focusedWindow(e)?.minimize())
handle('win:toggle-maximize', (e) => {
  const w = focusedWindow(e)
  if (!w) return
  if (w.isMaximized()) w.unmaximize()
  else w.maximize()
})
handle('win:close', (e) => focusedWindow(e)?.close())

handle('mise:detect', (_e, force?: boolean) => mise.detect(!!force))
handle('mise:get-installer', () => getInstaller())
handle(
  'mise:set-lang-pref',
  (_e, lang: Lang, theme?: 'dark' | 'light') => {
    if (lang !== 'zh' && lang !== 'en') return
    menuLang = lang
    if (theme === 'dark' || theme === 'light') menuTheme = theme
    savePrefs()
    applyMenu()
  },
)
handle('mise:get-workdir', () => workDir)
async function pickFolder(title: string, defaultPath: string): Promise<string | null> {
  if (!win) return null
  const res = await dialog.showOpenDialog(win, {
    title,
    defaultPath,
    properties: ['openDirectory', 'createDirectory'],
  })
  if (res.canceled || res.filePaths.length === 0) return null
  return res.filePaths[0]
}
handle('mise:choose-workdir', async () => {
  const next = await pickFolder(
    menuLang === 'zh' ? '选择项目目录' : 'Choose a project directory',
    workDir,
  )
  if (next) workDir = next
  return next
})
handle('mise:choose-folder', (_e, title: string, defaultPath: string) =>
  pickFolder(title, defaultPath),
)
// Where a pin-scoped command runs: the pin's own directory when the app manages
// that file, otherwise the fallback 工作目录. Write commands additionally pass
// --path: several configs can share one directory, including global config.toml.
// The tool list deliberately takes the fallback: `ls --json` there is the complete
// list and the link layer reads `--all-sources`, which already spans the machine.
async function cwdFor(configPath?: string): Promise<string> {
  const dir = await resolvePinDir(configPath)
  if (configPath && !dir) throw new Error('Selected config is missing or no longer managed')
  return dir ?? workDir
}
handle('mise:list-installed', async (_e, configPath?: string) =>
  withDisabled(await mise.listInstalled(await cwdFor(configPath)), await managedFiles()),
)
handle('mise:list-remote', (_e, tool: string) => mise.listRemote(tool))
handle('mise:list-registry', () => mise.listRegistry())
handle('mise:list-tasks', async (_e, configPath?: string) =>
  mise.listTasks(await cwdFor(configPath)),
)
handle('mise:get-doctor', () => mise.getDoctor())
handle('mise:get-settings', () => mise.getSettings())
handle('mise:set-setting', (_e, key: string, value: string) =>
  mise.setSetting(key, value),
)
handle('mise:unset-setting', (_e, key: string) => mise.unsetSetting(key))
handle('mise:get-env-dirs', async () => {
  const envs = await getEnvDirs()
  if (!(await mise.detect()).installed) return envs
  try {
    const doctor = await mise.getDoctor()
    return withReportedDirs(envs, doctor.dirs)
  } catch { return envs }
})
handle('mise:set-env-dir', async (_e, v: EnvVarName, path: string) => {
  const result = await setEnvDir(v, path)
  if (result.ok) invalidatePins()
  return result
})
handle('mise:clear-env-dir', async (_e, v: EnvVarName) => {
  const result = await clearEnvDir(v)
  if (result.ok) invalidatePins()
  return result
})

// The managed config files. Every page that works against one file — 配置, 任务,
// and the 工具 graph — selects from this list and passes the path back on its
// commands, which is what replaces the single 默认工作目录.
handle('mise:get-pins', (_e, force?: boolean) => listPins(!!force))
handle('mise:pick-pin', async () => {
  if (!win) return { ok: false, error: '窗口未就绪' }
  const res = await dialog.showOpenDialog(win, {
    title: menuLang === 'zh' ? '引入 mise 配置文件' : 'Import a mise config file',
    defaultPath: workDir,
    properties: ['openFile'],
    filters: [{ name: 'mise', extensions: ['toml', 'yaml', 'yml', 'tool-versions'] }],
  })
  // Cancelling is not an error: the renderer only reports failures that carry a
  // reason, so a closed dialog answers ok with no pin.
  if (res.canceled || !res.filePaths[0]) return { ok: true }
  const added = addManualPin(res.filePaths[0])
  if (!added.ok) return added
  savePrefs()
  return added
})
handle('mise:drop-pin', async (_e, path: string) => {
  removeManualPin(path)
  savePrefs()
  return listPins(true)
})
handle('mise:read-config', async (_e, path: string) =>
  readConfig(path, workDir, await managedFiles()),
)
handle('mise:write-config', async (_e, path: string, content: string) =>
  writeConfig(path, content, workDir, await managedFiles()),
)
handle('mise:open-folder', (_e, path: string) => {
  if (typeof path !== 'string' || path.includes('\0') || !isAbsolute(path) || !existsSync(path)) return 'Folder does not exist'
  // Passing a file to shell.openPath launches its editor; every 打开文件夹 button
  // means "show me where this lives", so reveal files in their parent instead.
  if (existsSync(path) && statSync(path).isFile()) {
    shell.showItemInFolder(path)
    return ''
  }
  return shell.openPath(path)
})

// Streaming commands forward each output line back to the renderer under a
// per-request channel so long installs can show live progress.
function streamHandler<K extends keyof StreamArguments>(
  channel: K,
  fn: (args: StreamArguments[K], emit: (e: RunEvent) => void) => Promise<RunResult>,
) {
  handle(channel, async (event, payload: { reqId: string; args: unknown }) => {
    if (!payload || typeof payload.reqId !== 'string' || !/^req_\d+_\d+$/.test(payload.reqId)) throw new Error('Invalid stream request')
    return completeStream(emit => fn(parseStreamArguments(channel, payload.args), emit), e => {
      if (!event.sender.isDestroyed()) {
        event.sender.send(`mise:event:${payload.reqId}`, e)
      }
    })
  })
}

streamHandler('mise:install-mise', (_args, emit) => installMise(emit))
streamHandler('mise:install', async (args, emit) => {
  const path = args.opts?.configPath
  const target = path ? await resolvePinForWrite(path) : null
  if (path && !target) return { ok: false, code: -1, stdout: '', stderr: 'Selected config is missing or no longer managed' }
  return mise.install(
    args.tool,
    args.version,
    {
      pin: !!args.opts?.pin,
      configPath: target?.path,
      cwd: target && existsSync(target.dir) ? target.dir : workDir,
    },
    emit,
  )
})
streamHandler('mise:uninstall', (args, emit) =>
  mise.uninstall(args.tool, args.version, emit),
)
streamHandler('mise:unuse', async (args, emit) => {
  const target = args.configPath ? await resolvePinForWrite(args.configPath) : null
  if (args.configPath && !target) return { ok: false, code: -1, stdout: '', stderr: 'Selected config is missing or no longer managed' }
  return mise.unuse(args.tool, args.version, await cwdFor(args.configPath), emit, target?.path)
})
streamHandler('mise:change-connection', (args, emit) => changeConnection(args, emit))
streamHandler('mise:link', (args, emit) =>
  mise.link(args.tool, args.version, args.path, args.force, emit),
)
streamHandler('mise:run-task', async (args, emit) =>
  mise.runTask(args.task, { ...args.opts, cwd: await cwdFor(args.opts?.configPath) }, emit),
)
streamHandler('mise:trust-config', async (args, emit) => {
  const target = await resolvePinForWrite(args.path)
  if (!target?.exists) return { ok: false, code: -1, stdout: '', stderr: 'Selected config is missing or no longer managed' }
  return mise.trustConfig(target.path, emit, target.dir)
})

app.whenReady().then(async () => {
  // Windows derives the taskbar / Alt+Tab icon from the app id, so the process
  // needs its own before the window icon is honoured.
  if (process.platform === 'win32') app.setAppUserModelId('dev.jdx.mise-gui')
  loadPrefs()
  setDisabledStore(join(app.getPath('userData'), 'disabled-connections.json'))
  applyMenu()
  // The saved directory values have to be in hand before the window starts
  // asking mise to list or install anything; the read is one registry export.
  await primeEnvCache()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
