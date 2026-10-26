import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  ConfigContent,
  ConfigPin,
  EnvVarName,
  InstalledTool,
  InstalledVersion,
  MiseStatus,
  MiseTask,
  RunEvent,
  RunResult,
  SettingsInfo,
  ConnectionChange,
  ToolConnection,
} from './types'
import { usePrefs } from './prefs'
import { useCmdHover } from './cmdtip'
import TitleBar from './TitleBar'
import SidebarActions from './components/SidebarActions'
import ToolsPane from './components/ToolsPane'
import TasksView from './components/TasksView'
import AddToolDialog from './components/AddToolDialog'
import ToolConnectionDialog from './components/ToolConnectionDialog'
import ConnectionDeleteDialog from './components/ConnectionDeleteDialog'
import { connectionCommands } from './connections'
import UninstallDialog from './components/UninstallDialog'
import ConfigView from './components/ConfigView'
import DoctorView from './components/DoctorView'
import DocsView from './components/DocsView'
import SettingsView from './components/SettingsView'
import SettingsPage from './components/SettingsPage'
import Console from './components/Console'
import NotInstalled from './components/NotInstalled'
import {
  ToolsIcon,
  TasksIcon,
  ConfigIcon,
  DoctorIcon,
  DocsIcon,
  RotateIcon,
  AddIcon,
  TasksIcon as TerminalIcon,
} from './components/icons'

export interface ConsoleLine {
  id: number
  kind: 'cmd' | 'stdout' | 'stderr' | 'exit-ok' | 'exit-err'
  text: string
}

type View = 'tools' | 'tasks' | 'config' | 'doctor' | 'docs'

// Which docs section each view links to.
const VIEW_DOCS: Record<Exclude<View, 'docs'>, string> = {
  tools: 'switch',
  tasks: 'cando',
  config: 'control',
  doctor: 'env',
}

// Views whose data comes from a mise invocation and can be cached in memory.
type DataView = 'tools' | 'tasks' | 'config'

// Why a view's rows are stale: 'load' was asked for by the header (boot, refresh,
// work dir) and deserves the spinning icon; 'row' is a quiet refetch after a
// mutation, where only the affected rows need to refresh.
// null means the cached rows are current.
type Stale = 'load' | 'row' | null

// Always a fresh object: reusing one constant would let React bail out of the
// state update and skip the reload the reset is meant to trigger.
function staleAll(reason: Exclude<Stale, null>): Record<DataView, Stale> {
  return { tools: reason, tasks: reason, config: reason }
}

function baseName(p: string): string {
  const parts = p.split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] ?? p
}

let lineSeq = 0
function makeLine(kind: ConsoleLine['kind'], text: string): ConsoleLine {
  lineSeq += 1
  return { id: lineSeq, kind, text }
}

export default function App() {
  const { t } = usePrefs()
  const [view, setView] = useState<View>('tools')
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem('mise-gui.sidebar') === 'collapsed'
    } catch {
      return false
    }
  })
  const applySidebar = useCallback((next: boolean) => {
    setCollapsed(next)
    try {
      localStorage.setItem('mise-gui.sidebar', next ? 'collapsed' : 'expanded')
    } catch {
      /* ignore */
    }
  }, [])
  const toggleSidebar = useCallback(() => applySidebar(!collapsed), [applySidebar, collapsed])
  const [docsNav, setDocsNav] = useState<{ section: string | null; token: number }>({
    section: null,
    token: 0,
  })
  const openDocs = useCallback((section: string | null) => {
    setDocsNav((prev) => ({ section, token: prev.token + 1 }))
    setView('docs')
  }, [])
  useEffect(() => {
    const unsub = window.windowControls?.onMenuAction((action) => {
      if (action === 'docs') openDocs(null)
    })
    return () => unsub?.()
  }, [openDocs])
  const [status, setStatus] = useState<MiseStatus | null>(null)
  const [tools, setTools] = useState<InstalledTool[]>([])
  const [toolsToolbar, setToolsToolbar] = useState<HTMLDivElement | null>(null)
  const [uninstallTarget, setUninstallTarget] = useState<{
    tool: string
    version: string
    installPath?: string
    source?: string
  } | null>(null)
  const [tasks, setTasks] = useState<MiseTask[]>([])
  const [settings, setSettings] = useState<SettingsInfo | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsSection, setSettingsSection] = useState<'general' | 'env'>('general')
  const [loading, setLoading] = useState(true)
  const [viewError, setViewError] = useState<string | null>(null)
  useEffect(() => setViewError(null), [view])
  const [probing, setProbing] = useState(false)
  const [stale, setStale] = useState<Record<DataView, Stale>>(staleAll('load'))
  // One mise invocation at a time. Only the control that started it — the row
  // row action or dialog button — shows this; the topbar stays steady.
  const [busy, setBusy] = useState(false)
  const [installingMise, setInstallingMise] = useState(false)
  const [miseInstallError, setMiseInstallError] = useState('')
  const miseInstallInFlight = useRef(false)
  const [lines, setLines] = useState<ConsoleLine[]>([])
  const [consoleOpen, setConsoleOpen] = useState(() => {
    try { return localStorage.getItem('mise-gui.console') !== 'collapsed' } catch { return true }
  })
  const [addOpen, setAddOpen] = useState(false)
  const [connection, setConnection] = useState<{ configPath: string; tool?: string; version?: string; from?: ToolConnection } | null>(null)
  const [disconnect, setDisconnect] = useState<ToolConnection | null>(null)
  const connectionChangeInFlight = useRef(false)
  const [toast, setToast] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const toastTimer = useRef<number | null>(null)
  const probeInFlight = useRef(false)

  const [reloadSignal, setReloadSignal] = useState(0)

  // Config view state (kept in App so console streaming + toast are shared).
  // The rows are the managed config files — global first — not a 工作目录 scan,
  // so the page works across projects and never depends on the picked directory.
  const [pins, setPins] = useState<ConfigPin[]>([])
  const [cfgSelected, setCfgSelected] = useState<string | undefined>(undefined)
  const [cfgContent, setCfgContent] = useState<ConfigContent | null>(null)
  const [cfgText, setCfgText] = useState('')
  const [cfgSaving, setCfgSaving] = useState(false)
  const [trustedPaths, setTrustedPaths] = useState<Set<string>>(new Set())
  const [cfgLoadedAt, setCfgLoadedAt] = useState(0)
  // Bumped to re-read the file already on screen — after a save, or when the
  // ⟳ button forces the pin list (and with it the disk content) fresh.
  const [cfgRev, setCfgRev] = useState(0)

  const applyConfigContent = useCallback((c: ConfigContent) => {
    setCfgContent(c)
    setCfgText(c.content)
    setCfgLoadedAt(Date.now())
  }, [])

  const api = typeof window !== 'undefined' ? window.mise : undefined

  // One read per file on screen. Doing it here instead of at each call site is
  // what keeps 引入/移出/保存 from racing: two in-flight reads of different files
  // used to land in arbitrary order and show the wrong content.
  useEffect(() => {
    if (!api) return
    if (!cfgSelected) {
      setCfgContent(null)
      setCfgText('')
      return
    }
    let live = true
    api.readConfig(cfgSelected).then((c) => {
      if (live) applyConfigContent(c)
    }).catch(error => {
      if (live) applyConfigContent({ path: cfgSelected, content: '', parsed: null, error: String(error) })
    })
    return () => {
      live = false
    }
  }, [api, cfgSelected, cfgRev, applyConfigContent])

  const notify = useCallback((kind: 'ok' | 'err', text: string) => {
    setToast({ kind, text })
    if (toastTimer.current) window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(null), 3500)
  }, [])
  useEffect(() => () => { if (toastTimer.current) window.clearTimeout(toastTimer.current) }, [])

  const pushLine = useCallback((line: ConsoleLine) => {
    setLines((prev) => [...prev.slice(-500), line])
  }, [])

  const loadPins = useCallback(
    async (force = false, prefer?: string) => {
      if (!api) return
      const list = await api.getPins(force)
      setPins(list)
      // The global file is the one mise always reads, so it is the default view;
      // a file the user already picked keeps its place across reloads.
      const alive = (p?: string) => !!p && list.some((pin) => pin.path === p)
      const next = alive(prefer)
        ? prefer
        : alive(cfgSelected)
          ? cfgSelected
          : list.find((p) => p.kind === 'global')?.path
      if (next === cfgSelected && force) setCfgRev((r) => r + 1)
      setCfgSelected(next)
    },
    [api, cfgSelected],
  )

  // 引入: the main process opens the file dialog, validates the choice is a mise
  // config, and remembers it in its own prefs file. Cancelling answers ok with no
  // pin, so the page stays exactly where it was.
  const importPin = useCallback(async () => {
    if (!api) return
    try {
      const res = await api.pickPin()
      if (!res.pin) {
        if (!res.ok && res.error) notify('err', res.error)
        return
      }
      await loadPins(true, res.pin.path)
      notify('ok', t('ok_pin_imported'))
    } catch (error) { notify('err', String(error)) }
  }, [api, loadPins, notify, t])

  // 移出 only forgets an imported file; a tracked or global file stays listed
  // because mise itself says it is loaded, and forgetting it would be a lie.
  const dropPin = useCallback(
    async (path: string) => {
      if (!api) return
      try {
        const list = await api.dropPin(path)
        setPins(list)
        // The global file is the one pin that can never leave the list.
        if (cfgSelected === path) setCfgSelected(list.find((p) => p.kind === 'global')?.path)
      } catch (error) { notify('err', String(error)) }
    },
    [api, cfgSelected, notify],
  )

  const openSettings = useCallback(() => {
    setSettingsSection('general')
    setSettingsOpen(true)
  }, [])

  // ⟳ on the rail drops the main process's cache and re-reads what mise loads.
  // The selection itself may not move, so the tasks page is marked stale here too:
  // the file behind it can have changed either way.
  const reloadPins = useCallback(() => {
    void loadPins(true).catch(error => notify('err', String(error)))
    setStale((prev) => ({ ...prev, tasks: 'load' }))
  }, [loadPins, notify])

  const installed = status?.installed ?? false

  // 配置, 任务 and the settings page all read the pin list, so load it as soon as
  // mise is installed instead of waiting for whichever page asks first.
  useEffect(() => {
    if (api && installed && pins.length === 0) void loadPins().catch(error => notify('err', String(error)))
  }, [api, installed, pins.length, loadPins, notify])

  // Boot is the only place that probes the environment. `mise --version` and
  // `mise ls --json` each cost ~150ms of process spawn on Windows, so this runs
  // once and the refresh button opts back into it explicitly.
  const boot = useCallback(
    async (background = false) => {
      if (probeInFlight.current || miseInstallInFlight.current) return
      if (!api) {
        setLoading(false)
        return
      }
      probeInFlight.current = true
      if (background) setProbing(true)
      else setLoading(true)
      try {
        const s = await api.detect(true)
        setStatus(s)
        if (!s.installed) {
          setTools([])
          setTasks([])
          setPins([])
          setCfgSelected(undefined)
          setSettings(null)
          setAddOpen(false)
          setConnection(null)
          setDisconnect(null)
          setUninstallTarget(null)
        }
      } catch (err) {
        setStatus({ installed: false, error: String(err) })
      } finally {
        probeInFlight.current = false
        setLoading(false)
        setProbing(false)
      }
      setStale(staleAll('load'))
    },
    [api],
  )

  useEffect(() => {
    boot()
  }, [boot])

  useEffect(() => {
    if (reloadSignal === 0) return
    boot(true)
  }, [reloadSignal, boot])

  // A mutation makes every view's cached rows stale, but only the one on screen
  // is worth refetching now — the others reload the moment they are opened.
  const invalidate = useCallback(
    (fromHeader: boolean) => setStale(staleAll(fromHeader ? 'load' : 'row')),
    [],
  )

  const dataView: DataView | null =
    view === 'tools' || view === 'tasks' || view === 'config' ? view : null
  const viewStale = dataView ? stale[dataView] : null
  const taskConfig = dataView === 'tasks' ? cfgSelected : undefined

  useEffect(() => {
    if (!api || !installed || !dataView || viewStale === null) return
    let live = true
    setViewError(null)
    const load = async () => {
      try {
        if (dataView === 'tools') {
          const [rows] = await Promise.all([api.listInstalled(), loadPins()])
          if (live) setTools(rows)
        } else if (dataView === 'tasks') {
          const rows = await api.listTasks(taskConfig)
          if (live) setTasks(rows)
        } else {
          const [, rows] = await Promise.all([loadPins(), api.getSettings()])
          if (live) setSettings(rows)
        }
      } catch (error) { if (live) setViewError(String(error)) }
      finally { if (live) setStale(previous => ({ ...previous, [dataView]: null })) }
    }
    void load()
    return () => { live = false }
  }, [api, installed, dataView, viewStale, taskConfig, loadPins])

  // Moving the selection — from either page, or from 引入/移出 — means the task
  // rows on screen belong to the previous file.
  useEffect(() => {
    setStale((prev) => (prev.tasks === null ? { ...prev, tasks: 'load' } : prev))
  }, [cfgSelected])

  const onEvent = useCallback(
    (cmdLabel: string) => (e: RunEvent) => {
      if (e.type === 'stdout') {
        if (e.data.trim()) pushLine(makeLine('stdout', e.data))
      } else if (e.type === 'stderr') {
        if (e.data.trim()) pushLine(makeLine('stderr', e.data))
      } else if (e.type === 'exit') {
        pushLine(
          makeLine(
            e.code === 0 ? 'exit-ok' : 'exit-err',
            t('exit_code', { label: cmdLabel, code: e.code ?? '?' }),
          ),
        )
      }
    },
    [pushLine, t],
  )

  const runMiseInstall = useCallback(async () => {
    if (!api || busy || miseInstallInFlight.current) return
    miseInstallInFlight.current = true
    setInstallingMise(true)
    setBusy(true)
    setMiseInstallError('')
    setConsoleOpen(true)
    try {
      const plan = await api.getInstaller()
      if (!plan.supported) throw new Error(t('ni_install_unavailable'))
      pushLine(makeLine('cmd', `$ ${plan.command}`))
      const result = await api.installMise(onEvent('mise installer'))
      if (!result.ok) {
        // Installer progress is also written to stderr. Keep the full history
        // in the console; show the final reason next to the retry action.
        const reason = result.stderr.trim().split(/[\r\n]+/).filter(Boolean).at(-1)
        throw new Error([t('ni_install_failed', { code: result.code }), reason].filter(Boolean).join('\n'))
      }
      const detected = await api.detect(true)
      setStatus(detected)
      if (!detected.installed) throw new Error(t('ni_install_not_detected'))
      await loadPins(true)
      setStale(staleAll('load'))
      notify('ok', t('ni_install_success'))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setMiseInstallError(message)
      pushLine(makeLine('stderr', message))
      notify('err', message)
    } finally {
      miseInstallInFlight.current = false
      setInstallingMise(false)
      setBusy(false)
    }
  }, [api, busy, loadPins, notify, onEvent, pushLine, t])

  const executeOperation = useCallback(async (label: string, operation: () => Promise<RunResult>, streamed = true): Promise<RunResult> => {
    setBusy(true)
    try {
      const result = await operation()
      if (!streamed) onEvent(label)({ type: 'exit', data: '', code: result.code })
      return result
    } catch (error) {
      const stderr = error instanceof Error ? error.message : String(error)
      pushLine(makeLine('stderr', stderr))
      onEvent(label)({ type: 'exit', data: '', code: -1 })
      return { ok: false, code: -1, stdout: '', stderr }
    } finally { setBusy(false) }
  }, [onEvent, pushLine])

  const runInstall = useCallback(
    async (tool: string, version: string, pin: boolean, configPath = cfgSelected): Promise<RunResult | null> => {
      if (!api || busy) return null
      setBusy(true)
      const label = `${pin ? 'use' : 'install'} ${tool}@${version}${pin && configPath ? ` --path "${configPath}"` : ''}`
      pushLine(makeLine('cmd', `$ mise ${label}`))
      // The main process validates this file and passes it explicitly to mise;
      // its directory also supplies the environment for installing the tool.
      try {
        const res = await api.install(tool, version, { pin, configPath }, onEvent(label))
        if (res.ok) {
          invalidate(false)
          try {
            if (pin) await loadPins(true, configPath)
            notify('ok', t(pin ? 'ok_use' : 'ok_install', { tool, version }))
          } catch (reason) {
            pushLine(makeLine('stderr', String(reason)))
            notify('err', t('connect_refresh_failed'))
          }
        } else {
          notify('err', t('fail_op', { tool, code: res.code }))
        }
        return res
      } catch (reason) {
        const stderr = reason instanceof Error ? reason.message : String(reason)
        pushLine(makeLine('stderr', stderr))
        notify('err', stderr)
        return { ok: false, code: -1, stdout: '', stderr }
      } finally {
        setBusy(false)
      }
    },
    [api, busy, cfgSelected, loadPins, invalidate, notify, onEvent, pushLine, t],
  )

  const runConnectionChange = useCallback(async (change: ConnectionChange): Promise<RunResult | null> => {
    if (!api || busy || connectionChangeInFlight.current) return null
    connectionChangeInFlight.current = true
    setBusy(true)
    const label = connectionCommands(change).join(' && ')
    if (label) pushLine(makeLine('cmd', `$ ${label}`))
    try {
      const result = await api.changeConnection(change, onEvent(label))
      notify(result.ok ? 'ok' : 'err', t(result.ok ? change.action === 'disable' ? 'edge_disabled' : change.action === 'enable' ? 'edge_enabled' : change.to ? 'edge_changed' : 'edge_deleted' : 'connect_failed'))
      return result
    } catch (error) {
      const stderr = String(error)
      pushLine(makeLine('stderr', stderr)); notify('err', t('connect_failed'))
      return { ok: false, code: -1, stdout: '', stderr }
    } finally {
      invalidate(false)
      try { await loadPins(true, change.to?.configPath ?? change.from.configPath) }
      catch (error) { pushLine(makeLine('stderr', String(error))) }
      connectionChangeInFlight.current = false
      setBusy(false)
    }
  }, [api, busy, onEvent, pushLine, notify, t, invalidate, loadPins])
  const dropVersion = useCallback((from: ToolConnection, tool: string, version: string) => {
    void runConnectionChange({ from, to: { tool, version, configPath: from.configPath } })
  }, [runConnectionChange])
  const toggleConnection = useCallback((from: ToolConnection, enabled: boolean) => {
    void runConnectionChange({ from, action: enabled ? 'enable' : 'disable' })
  }, [runConnectionChange])

  const openConnection = useCallback((configPath: string, tool?: string, version?: string, from?: ToolConnection) => {
    if (busy) return
    setAddOpen(false)
    setDisconnect(null)
    setConnection({ configPath, tool, version, from })
  }, [busy])
  const closeConnection = useCallback(() => setConnection(null), [])
  const openDisconnect = useCallback((from: ToolConnection) => {
    if (busy) return
    setAddOpen(false); setConnection(null); setDisconnect(from)
  }, [busy])
  const closeDisconnect = useCallback(() => setDisconnect(null), [])

  const runUninstall = useCallback(
    async (tool: string, version: string) => {
      if (!api || busy) return
      const label = `uninstall ${tool}@${version}`
      pushLine(makeLine('cmd', `$ mise ${label}`))
      const res = await executeOperation(label, () => api.uninstall(tool, version, onEvent(label)))
      if (res.ok) {
        notify('ok', t('ok_uninstall', { tool, version }))
        invalidate(false)
      } else {
        notify('err', t('fail_uninstall', { tool, code: res.code }))
      }
    },
    [api, busy, executeOperation, invalidate, notify, onEvent, pushLine, t],
  )

  // `mise link` registers a directory the user installed by hand. mise writes no
  // config for it, so an imported version stays unrequested until a config
  // selects it (or 添加工具 writes it with 安装并设为当前).
  const runLink = useCallback(
    async (tool: string, version: string, path: string, force: boolean) => {
      if (!api || busy) return
      const label = `link ${tool}@${version} "${path}"${force ? ' --force' : ''}`
      pushLine(makeLine('cmd', `$ mise ${label}`))
      const res = await executeOperation(label, () => api.link(tool, version, path, force, onEvent(label)))
      if (res.ok) {
        notify('ok', t('ok_link', { tool, version }))
        invalidate(false)
      } else {
        notify('err', t('fail_link', { tool, code: res.code }))
      }
    },
    [api, busy, executeOperation, invalidate, notify, onEvent, pushLine, t],
  )

  // Settings writes go straight into mise's global config. They are real mise
  // commands, so they are echoed to the output panel like everything else, and
  // the view reloads so the next paint shows the effective value.
  const runSetSetting = useCallback(
    async (key: string, value: string) => {
      if (!api || busy) return
      const label = `settings set ${key} ${value}`
      pushLine(makeLine('cmd', `$ mise ${label}`))
      const res = await executeOperation(label, () => api.setSetting(key, value), false)
      if (res.ok) invalidate(false)
      else notify('err', t('fail_setting', { key, e: res.stderr.trim() || res.code }))
    },
    [api, busy, executeOperation, invalidate, notify, pushLine, t],
  )

  const runUnsetSetting = useCallback(
    async (key: string) => {
      if (!api || busy) return
      const label = `settings unset ${key}`
      pushLine(makeLine('cmd', `$ mise ${label}`))
      const res = await executeOperation(label, () => api.unsetSetting(key), false)
      if (res.ok) invalidate(false)
      else notify('err', t('fail_setting', { key, e: res.stderr.trim() || res.code }))
    },
    [api, busy, executeOperation, invalidate, notify, pushLine, t],
  )

  // Each directory is an environment write, not a mise command, but it still
  // belongs in the output panel: that is where the user checks what really ran.
  // Every view reloads afterwards because listings now resolve against a
  // different data/config directory.
  const runSetEnvDir = useCallback(
    async (v: EnvVarName, next: string | null) => {
      if (!api) return { ok: false, error: 'No desktop API' }
      setBusy(true)
      const label =
        next === null ? `reg delete HKCU\\Environment /v ${v} /f` : `setx ${v} "${next}"`
      pushLine(makeLine('cmd', `$ ${label}`))
      try {
        const res = next === null ? await api.clearEnvDir(v) : await api.setEnvDir(v, next)
        pushLine(
          makeLine(
            res.ok ? 'exit-ok' : 'exit-err',
            res.ok
              ? t(next === null ? 'sp_dir_cleared' : 'sp_dir_saved')
              : res.error || t('sp_dir_fail'),
          ),
        )
        setBusy(false)
        if (!res.ok) {
          notify('err', res.error || t('sp_dir_fail'))
          return { ok: false, error: res.error || t('sp_dir_fail') }
        }
        invalidate(true)
        // The main process invalidated its registry; keep an unchanged editor's
        // unsaved text while refreshing the list and selecting any new global file.
        void loadPins().catch(err => notify('err', String(err)))
        return { ok: true }
      } catch (err) {
        notify('err', String(err))
        return { ok: false, error: String(err) }
      } finally {
        setBusy(false)
      }
    },
    [api, invalidate, loadPins, notify, pushLine, t],
  )

  const runTask = useCallback(
    async (task: string) => {
      if (!api || busy) return
      const label = `run ${task}`
      pushLine(makeLine('cmd', `$ mise ${label}`))
      // Same scope as the list on screen: the run happens in the selected file's
      // directory, so the task that was listed is the task that runs.
      const res = await executeOperation(label, () => api.runTask(task, { configPath: cfgSelected }, onEvent(label)))
      if (res.ok) notify('ok', t('ok_task', { task }))
      else notify('err', t('fail_task', { task, code: res.code }))
    },
    [api, busy, cfgSelected, executeOperation, notify, onEvent, pushLine, t],
  )

  const selectConfigFile = useCallback((path: string) => {
    // The read effect owns fetching; selecting is only a state change.
    setCfgSelected(path)
  }, [])

  const saveConfig = useCallback(async () => {
    if (!api || !cfgSelected || cfgSaving) return
    setCfgSaving(true)
    try {
      const res = await api.writeConfig(cfgSelected, cfgText)
      if (res.ok) {
        setCfgRev((r) => r + 1)
        invalidate(false)
        notify('ok', t('ok_config_saved'))
      } else {
        notify('err', t('fail_config_save'))
        setCfgContent((prev) => (prev ? { ...prev, error: res.error } : prev))
      }
    } catch (error) {
      notify('err', t('fail_config_save'))
      setCfgContent(previous => previous ? { ...previous, error: String(error) } : previous)
    } finally { setCfgSaving(false) }
  }, [api, cfgSelected, cfgText, cfgSaving, invalidate, notify, t])

  const trustConfigFile = useCallback(
    async (path: string) => {
      if (!api) return { ok: false, code: -1, stdout: '', stderr: 'no api' }
      const label = `trust ${baseName(path)}`
      pushLine(makeLine('cmd', `$ mise trust ${path}`))
      const res = await executeOperation(label, () => api.trustConfig(path, onEvent(label)))
      if (res.ok) {
        setTrustedPaths((prev) => new Set(prev).add(path))
        notify('ok', t('ok_config_trusted'))
      } else {
        notify('err', t('fail_config_trust', { code: res.code }))
      }
      return res
    },
    [api, executeOperation, notify, onEvent, pushLine, t],
  )

  // Stable identities: ToolCard and Console are memoised, so an inline arrow
  // here would defeat the memo on every render.
  const askUninstall = useCallback(
    (name: string, v: InstalledVersion) =>
      setUninstallTarget({
        tool: name,
        version: v.version,
        installPath: v.installPath,
        source: [...new Set(v.sources.map((s) => s.path))].join(', ') || undefined,
      }),
    [],
  )
  const setConsoleVisible = useCallback((open: boolean) => {
    setConsoleOpen(open)
    try { localStorage.setItem('mise-gui.console', open ? 'expanded' : 'collapsed') } catch { /* optional preference */ }
  }, [])
  const closeConsole = useCallback(() => setConsoleVisible(false), [setConsoleVisible])
  const clearConsole = useCallback(() => setLines([]), [])

  // The install dir is a real folder on disk; hand it to the OS file manager.
  const openFolder = useCallback(
    async (path: string) => {
      if (!api) return
      try {
        const err = await api.openFolder(path)
        if (err) notify('err', t('fail_open_folder', { e: err }))
      } catch (error) { notify('err', t('fail_open_folder', { e: String(error) })) }
    },
    [api, notify, t],
  )

  // All known versions stay visible; refresh queries downloads and requests
  // from every tracked project.
  const refreshCmd =
    !installed ? 'mise --version' : view === 'tools'
      ? 'mise ls --json && mise ls --json --all-sources'
      : view === 'tasks'
        ? 'mise tasks ls --json'
        : view === 'config'
          ? 'mise config ls --tracked-configs && mise settings ls --all --json && mise settings ls --json'
          : view === 'doctor'
            ? 'mise doctor --json'
            : undefined
  const refreshHover = useCmdHover(
    refreshCmd,
    !installed ? t('sp_probe_again') : t('refresh_title'),
  )
  const addHover = useCmdHover('mise registry --json', t('add_tool'))

  // Blank the content area only when there is genuinely nothing to draw yet;
  // a background reload keeps the previous rows on screen.
  const viewPending = installed && dataView !== null && stale[dataView] !== null
  const viewHasRows =
    dataView === 'tools'
      ? tools.length > 0
      : dataView === 'tasks'
        ? tasks.length > 0
        : dataView === 'config'
          ? pins.length > 0
          : true
  const showSpinner = loading || (viewPending && !viewHasRows)
  // The header only spins for reloads it was asked to do; a row mutation refetches
  // with stale='row' and the toolbar stays completely still. probing covers the
  // detect/getWorkDir leg so the spin never starts mid-way with a stutter.
  const reloading =
    loading ||
    probing ||
    (installed && dataView !== null && stale[dataView] === 'load')

  return (
    <div className="app">
      <TitleBar collapsed={collapsed} onToggleSidebar={toggleSidebar} />
      <div className="body">
      <aside
        className={`sidebar ${collapsed ? 'collapsed' : ''}`}
        style={{ width: collapsed ? 56 : 220 }}
      >
        <nav className="nav">
          <button
            className={`nav-item ${view === 'config' ? 'active' : ''}`}
            aria-label={t('nav_config')}
            onClick={() => setView('config')}
          >
            <span className="nav-ico">
              <ConfigIcon size={17} />
            </span>
            <span className="nav-label">{t('nav_config')}</span>
          </button>
          <button
            className={`nav-item ${view === 'tools' ? 'active' : ''}`}
            aria-label={t('nav_tools')}
            onClick={() => setView('tools')}
          >
            <span className="nav-ico">
              <ToolsIcon size={17} />
            </span>
            <span className="nav-label">{t('nav_tools')}</span>
          </button>
          <button
            className={`nav-item ${view === 'tasks' ? 'active' : ''}`}
            aria-label={t('nav_tasks')}
            onClick={() => setView('tasks')}
          >
            <span className="nav-ico">
              <TasksIcon size={17} />
            </span>
            <span className="nav-label">{t('nav_tasks')}</span>
          </button>
          <button
            className={`nav-item ${view === 'doctor' ? 'active' : ''}`}
            aria-label={t('nav_doctor')}
            onClick={() => setView('doctor')}
          >
            <span className="nav-ico">
              <DoctorIcon size={17} />
            </span>
            <span className="nav-label">{t('nav_doctor')}</span>
          </button>
        </nav>

        <div className="sidebar-foot">
          <div className="sidebar-status">
            {status === null ? (
              <>
                <span className="status-dot" />
                <span className="status-text">{t('detecting')}</span>
              </>
            ) : status.installed ? (
              <>
                <span className="status-dot ok" />
                <span className="status-text">
                  mise {status.version}
                </span>
              </>
            ) : (
              <>
                <span className="status-dot err" />
                <span className="status-text">{t('not_installed_short')}</span>
              </>
            )}
          </div>
          <SidebarActions collapsed={collapsed} docsActive={view === 'docs'}
            onDocs={() => openDocs(null)} onSettings={openSettings} />
        </div>
      </aside>

      <div className="workspace">
      <div className="main">
        <div className={`topbar ${view === 'tools' && installed ? 'tools-topbar' : ''}`}>
          <h1>
            {view === 'tools'
              ? t('nav_tools')
              : view === 'tasks'
                ? t('nav_tasks')
                : view === 'config'
                  ? t('nav_config')
                  : view === 'docs'
                    ? t('nav_docs')
                    : t('nav_doctor')}
          </h1>
          {view === 'tools' && installed ? <div className="canvas-toolbar-slot" ref={setToolsToolbar} /> : <div className="spacer" />}
          {view !== 'docs' && (
            <button
              className={`btn icon-only ${reloading ? 'busy' : ''}`}
              onClick={() => setReloadSignal((n) => n + 1)}
              disabled={loading || probing || installingMise}
              aria-label={t('refresh')}
              aria-busy={reloading}
              {...refreshHover}
            >
              <RotateIcon size={15} />
            </button>
          )}
          {view !== 'docs' && (
            <button
              className="btn ghost icon-only"
              aria-label={t('view_docs')}
              onClick={() => openDocs(VIEW_DOCS[view])}
            >
              <DocsIcon size={15} />
            </button>
          )}
          {view === 'tools' && installed && (
            <button
              className="btn primary icon-only"
              aria-label={t('add_tool')}
              onClick={() => setAddOpen(true)}
              disabled={!installed}
              {...addHover}
            >
              <AddIcon size={17} />
            </button>
          )}
        </div>

        <div className="content">
          {view === 'docs' ? (
            <DocsView targetSection={docsNav.section} navToken={docsNav.token} />
          ) : showSpinner ? (
            <div className="empty">
              <div className="spinner" />
            </div>
          ) : !installed ? (
            <NotInstalled
              error={status && !status.installed ? status.error : ''}
              probing={probing}
              installing={installingMise}
              installError={miseInstallError}
              onInstall={runMiseInstall}
              onRetry={() => setReloadSignal((n) => n + 1)}
              onDocs={() => openDocs(null)}
              onSettings={() => { setSettingsSection('env'); setSettingsOpen(true) }}
            />
          ) : viewError && dataView ? (
            <div className="empty"><h2>{t('load_failed')}</h2><p role="alert">{viewError}</p>
              <button className="btn" onClick={() => invalidate(true)}>{t('refresh')}</button></div>
          ) : view === 'doctor' ? (
            <DoctorView reloadSignal={reloadSignal} />
          ) : view === 'config' ? (
            <ConfigView
              pins={pins}
              onReloadPins={reloadPins}
              onImportPin={importPin}
              onDropPin={dropPin}
              onSelectPin={selectConfigFile}
              selectedPath={cfgSelected}
              content={cfgContent}
              text={cfgText}
              onEditorText={setCfgText}
              onSave={saveConfig}
              saving={cfgSaving}
              onTrust={trustConfigFile}
              trusted={trustedPaths}
              loadedAt={cfgLoadedAt}
              settingsSlot={
                <SettingsView
                  settings={settings}
                  busy={busy}
                  onSet={runSetSetting}
                  onUnset={runUnsetSetting}
                />
              }
            />
          ) : view === 'tasks' ? (
            <TasksView
              tasks={tasks}
              busy={busy}
              onRun={runTask}
              pins={pins}
              selectedPath={cfgSelected}
              onSelectPin={selectConfigFile}
              onImportPin={importPin}
              onReloadPins={reloadPins}
              onDropPin={dropPin}
            />
          ) : (
            <ToolsPane
              toolbarHost={toolsToolbar}
              onToggleConnection={toggleConnection}
              tools={tools}
              pins={pins}
              selectedPath={cfgSelected}
              busy={busy}
              onSelectPin={selectConfigFile}
              onImportPin={importPin}
              onReloadPins={reloadPins}
              onDropPin={dropPin}
              onOpenFolder={openFolder}
              onConnect={openConnection}
              onDisconnect={openDisconnect}
              onVersionDrop={dropVersion}
              onInstall={runInstall}
              onAskUninstall={askUninstall}
            />
          )}
        </div>

      </div>
        {consoleOpen && (
          <Console lines={lines} busy={busy} onClose={closeConsole} onClear={clearConsole} />
        )}
        {!consoleOpen && (
          <button
            className="console-head console-rail"
            aria-expanded="false" aria-controls="command-output"
            onClick={() => setConsoleVisible(true)}
          >
            <TerminalIcon size={17} />
            <span>{t('console_show')}</span>
            <span style={{ color: 'var(--text-faint)' }}>
              {busy
                ? t('console_busy')
                : lines.length > 0
                  ? t('console_lines', { n: lines.length })
                  : `· ${t('console_idle')}`}
            </span>
          </button>
        )}
      </div>
      </div>

      {addOpen && installed && view === 'tools' && (
        <AddToolDialog
          busy={busy}
          configPath={cfgSelected}
          onClose={() => setAddOpen(false)}
          onInstall={async (tool, version, pin) => {
            await runInstall(tool, version, pin)
            setAddOpen(false)
          }}
          onLink={async (tool, version, path, force) => {
            await runLink(tool, version, path, force)
            setAddOpen(false)
          }}
        />
      )}

      {connection && installed && view === 'tools' && <ToolConnectionDialog
        configPath={connection.configPath} initialTool={connection.tool} initialVersion={connection.version}
        from={connection.from}
        pins={pins} tools={tools} busy={busy} onClose={closeConnection}
        onConnect={(tool, version, path) => connection.from
          ? runConnectionChange({ from: connection.from, to: { tool, version, configPath: path } })
          : runInstall(tool, version, true, path)}
      />}

      {disconnect && installed && view === 'tools' && <ConnectionDeleteDialog connection={disconnect} busy={busy}
        onClose={closeDisconnect} onConfirm={() => runConnectionChange({ from: disconnect })} />}

      {uninstallTarget && (
        <UninstallDialog
          target={uninstallTarget}
          busy={busy}
          onCancel={() => setUninstallTarget(null)}
          onConfirm={async () => {
            const { tool, version } = uninstallTarget
            setUninstallTarget(null)
            await runUninstall(tool, version)
          }}
        />
      )}

      {settingsOpen && (
        <SettingsPage
          onBack={() => setSettingsOpen(false)}
          status={status}
          probing={loading || probing || installingMise}
          initialSection={settingsSection}
          onReprobe={() => setReloadSignal((n) => n + 1)}
          onApplyEnvDir={runSetEnvDir}
          onOpenFolder={openFolder}
          busy={busy}
        />
      )}

      {toast && <div className={`toast ${toast.kind}`}>{toast.text}</div>}
    </div>
  )
}
