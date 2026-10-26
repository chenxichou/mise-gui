import { useEffect, useMemo, useRef, useState } from 'react'
import type { ConfigPin, InstalledTool, RegistryTool, RunResult, ToolConnection } from '../types'
import { connectionCommands } from '../connections'
import { pathKey } from '../paths'
import { usePrefs } from '../prefs'
import { useCmdHover } from '../cmdtip'

interface Props {
  configPath: string
  initialTool?: string
  initialVersion?: string
  from?: ToolConnection
  pins: ConfigPin[]
  tools: InstalledTool[]
  busy: boolean
  onClose: () => void
  onConnect: (tool: string, version: string, configPath: string) => Promise<RunResult | null>
}

export default function ToolConnectionDialog({ configPath, initialTool, initialVersion, from, pins, tools, busy, onClose, onConnect }: Props) {
  const { t } = usePrefs()
  const [target, setTarget] = useState(configPath)
  const [tool, setTool] = useState(initialTool ?? '')
  const [query, setQuery] = useState('')
  const [versionQuery, setVersionQuery] = useState('')
  const [version, setVersion] = useState(initialVersion ?? '')
  const [registry, setRegistry] = useState<RegistryTool[]>([])
  const [remote, setRemote] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [error, setError] = useState('')
  const [reload, setReload] = useState(0)
  const submitting = useRef(false)
  const trigger = useRef(document.activeElement as HTMLElement | null)
  const installed = useMemo(() => tools.find(item => item.name === tool)?.versions.filter(v => v.installed) ?? [], [tools, tool])
  const current = tools.find(item => item.name === tool)?.versions.find(v => v.sources.some(s => pathKey(s.path) === pathKey(target)))
  const targetPin = pins.find(p => pathKey(p.path) === pathKey(target))
  const validTarget = !!targetPin && (targetPin.exists || targetPin.kind === 'global')
  const unchanged = from ? !from.disabled && from.tool === tool && from.version === version && pathKey(from.configPath) === pathKey(target)
    : current?.installed && current.version === version
  const commands = tool && version && validTarget ? from
    ? connectionCommands({ from, to: { tool, version, configPath: target } }).join(' && ')
    : `mise use ${tool}@${version} --path "${target}"` : undefined
  const hover = useCmdHover(commands)
  const finishClose = () => {
    onClose()
    if (trigger.current?.isConnected) trigger.current.focus()
  }
  const close = () => { if (!busy && !submitting.current) finishClose() }

  useEffect(() => {
    if (tool) return
    let live = true
    setLoading(true)
    setLoadError('')
    window.mise.listRegistry().then(list => {
      if (live) { setRegistry(list); if (!list.length) setLoadError(t('connect_registry_error')) }
    })
      .catch(() => { if (live) setLoadError(t('connect_registry_error')) })
      .finally(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [tool, reload, t])

  useEffect(() => {
    if (!tool) return
    let live = true
    setRemote([])
    setLoading(true)
    setLoadError('')
    window.mise.listRemote(tool).then(list => {
      if (live) {
        setRemote(list.map(v => v.version).reverse())
        if (!list.length) setLoadError(t('connect_remote_error'))
      }
    }).catch(() => { if (live) setLoadError(t('connect_remote_error')) })
      .finally(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [tool, reload, t])

  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy && !submitting.current) {
        onClose()
        if (trigger.current?.isConnected) trigger.current.focus()
      }
    }
    window.addEventListener('keydown', escape)
    return () => window.removeEventListener('keydown', escape)
  }, [busy, onClose])

  const choices = useMemo(() => {
    const names = [...new Set([...tools.map(item => item.name), ...registry.map(item => item.name)])]
    return names.filter(name => name.toLowerCase().includes(query.trim().toLowerCase())).slice(0, 200)
  }, [tools, registry, query])
  const versions = useMemo(() => {
    const local = installed.map(v => v.version).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
    return [...new Set([...local, ...(initialVersion ? [initialVersion] : []), ...remote])]
      .filter(v => v.toLowerCase().includes(versionQuery.trim().toLowerCase())).slice(0, 300)
  }, [installed, remote, versionQuery, initialVersion])

  const submit = async () => {
    if (busy || submitting.current || !tool || !version || !validTarget || unchanged) return
    submitting.current = true
    setError('')
    try {
      const result = await onConnect(tool, version, target)
      if (result?.ok) finishClose()
      else setError((from ? result?.stderr.trim() : result?.stderr.trim().split(/[\r\n]+/).at(-1)) || t('connect_failed'))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      submitting.current = false
    }
  }

  return <div className="overlay" onClick={close}>
    <div className="modal connection-dialog" role="dialog" aria-modal="true" aria-labelledby="connection-title" onClick={event => event.stopPropagation()}>
      <div className="modal-head">
        <h2 id="connection-title">{from ? t('edge_reconnect') : tool ? t(current ? 'connect_switch_title' : 'connect_tool_title', { tool }) : t('connect_tool')}</h2>
        <div className="spacer" />
        <button className="icon-btn" onClick={close} disabled={busy} aria-label={t('cancel')}>✕</button>
      </div>
      <div className="modal-body">
        {from && <div className="edge-original"><span>{t('edge_original')}</span><strong>{from.tool}@{from.requestedVersion ?? from.version}</strong>
          <span className="mono">{from.configPath}</span><p className="hint">{t('edge_reconnect_hint')}</p></div>}
        <div className="connection-target">
          <label htmlFor="connection-config">{t('connect_target')}</label>
          <select id="connection-config" className="input" value={target} disabled={busy} onChange={event => {
            setTarget(event.target.value); if (!from) setVersion(''); setError('')
          }}>
            {pins.map(pin => <option key={pin.path} value={pin.path} disabled={!pin.exists && pin.kind !== 'global'}>
              {t(pin.kind === 'global' ? 'config_kind_global' : 'config_kind_project')} · {pin.path}
            </option>)}
          </select>
          <div className="mono connection-path">{target}</div>
        </div>
        {tool ? <>
          <div className="connection-preview" aria-live="polite">
            <span>{t('connect_current')}: <strong>{current?.version ?? t('connect_none')}</strong></span>
            <span aria-hidden="true">→</span>
            <span>{t('connect_next')}: <strong>{version || '—'}</strong></span>
          </div>
          <div className="field">
            <label htmlFor="connection-version">{t('filter_version_label')}</label>
            <input id="connection-version" className="input" autoFocus value={versionQuery} disabled={busy}
              placeholder={t('filter_version_ph')} onChange={event => setVersionQuery(event.target.value)} />
          </div>
          <div className="result-list connection-choices">
            {versions.map(value => <button type="button" key={value} data-version={value}
              className={`result-row ${version === value ? 'selected' : ''}`} aria-pressed={version === value}
              disabled={busy} onClick={() => { setVersion(value); setError('') }}>
              <span className="version-tag">{value}</span>
              <div className="spacer" />
              {current?.version === value && <span className="badge active">{t('connect_current')}</span>}
              {installed.some(v => v.version === value) && <span className="badge inactive">{t('badge_installed')}</span>}
              {version === value && <span className="badge active">{t('selected_badge')}</span>}
            </button>)}
            {!versions.length && !loading && <div className="result-row meta">{t('no_versions')}</div>}
          </div>
          {version && !installed.some(v => v.version === version) && <p className="hint">{t('connect_download_hint')}</p>}
        </> : <>
          <div className="field">
            <label htmlFor="connection-tool">{t('connect_choose_tool')}</label>
            <input id="connection-tool" className="input" autoFocus value={query} disabled={busy}
              placeholder={t('search_tool_ph')} onChange={event => setQuery(event.target.value)} />
          </div>
          <div className="result-list connection-choices">
            {choices.map(name => <button type="button" key={name} className="result-row" disabled={busy}
              onClick={() => { setTool(name); setVersion(''); setVersionQuery(''); setError('') }}>
              <strong>{name}</strong><div className="spacer" />
              {tools.some(item => item.name === name && item.versions.some(v => v.installed)) && <span className="badge inactive">{t('badge_installed')}</span>}
            </button>)}
            {!choices.length && !loading && <div className="result-row meta">{t('no_tools_match')}</div>}
          </div>
        </>}
        {loading && <div className="connection-loading" role="status"><span className="spinner" />{t('connect_loading')}</div>}
        {loadError && <div className="connection-load-error" role="status">
          <span>{loadError}</span><button className="btn tiny" onClick={() => setReload(n => n + 1)} disabled={busy}>{t('connect_retry')}</button>
        </div>}
        {error && <div className="config-error" role="alert">{error}</div>}
      </div>
      <div className="modal-foot">
        {tool && !initialTool && <button className="btn" onClick={() => { setTool(''); setVersion(''); setError('') }} disabled={busy}>{t('back')}</button>}
        <div className="spacer" />
        <button className="btn" onClick={close} disabled={busy}>{t('cancel')}</button>
        {tool && <button className="btn primary" disabled={busy || !version || !validTarget || !!unchanged} onClick={() => void submit()} {...hover}>
          {t(busy ? 'connect_working' : from ? 'edge_reconnect' : current ? 'connect_switch' : 'connect_tool')}
        </button>}
      </div>
    </div>
  </div>
}
