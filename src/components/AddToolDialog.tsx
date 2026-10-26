import { useEffect, useMemo, useState } from 'react'
import type { RegistryTool, RemoteVersion } from '../types'
import { usePrefs } from '../prefs'
import { useCmdTip } from '../cmdtip'

interface Props {
  busy: boolean
  configPath?: string
  onClose: () => void
  onInstall: (tool: string, version: string, pin: boolean) => void
  onLink: (tool: string, version: string, path: string, force: boolean) => void
}

// `link` is the import path: mise never downloads anything there, it points at a
// directory the user already has.
type Step = 'pick-tool' | 'pick-version' | 'link'

export default function AddToolDialog({ busy, configPath, onClose, onInstall, onLink }: Props) {
  const { t } = usePrefs()
  const { show, hide } = useCmdTip()
  const hover = (cmd: string | undefined) =>
    cmd
      ? {
          onMouseEnter: (e: React.MouseEvent<HTMLElement>) => show(cmd, e.currentTarget),
          onMouseLeave: hide,
          onFocus: (e: React.FocusEvent<HTMLElement>) => show(cmd, e.currentTarget),
          onBlur: hide,
        }
      : {}
  const [step, setStep] = useState<Step>('pick-tool')
  const [registry, setRegistry] = useState<RegistryTool[]>([])
  const [loadingRegistry, setLoadingRegistry] = useState(true)
  const [query, setQuery] = useState('')
  const [selectedTool, setSelectedTool] = useState<string | null>(null)

  const [versions, setVersions] = useState<RemoteVersion[]>([])
  const [loadingVersions, setLoadingVersions] = useState(false)
  const [versionQuery, setVersionQuery] = useState('')
  const [selectedVersion, setSelectedVersion] = useState<string | null>(null)
  const [pin, setPin] = useState(true)

  const [linkTool, setLinkTool] = useState('')
  const [linkVersion, setLinkVersion] = useState('')
  const [linkPath, setLinkPath] = useState('')
  const [linkForce, setLinkForce] = useState(false)

  async function chooseLinkDir() {
    const picked = await window.mise.pickFolder(t('link_pick'), linkPath)
    if (picked) setLinkPath(picked)
  }

  useEffect(() => {
    let alive = true
    window.mise
      .listRegistry()
      .then((list) => {
        if (alive) setRegistry(list)
      })
      .catch(() => {
        if (alive) setRegistry([])
      })
      .finally(() => {
        if (alive) setLoadingRegistry(false)
      })
    return () => {
      alive = false
    }
  }, [])

  const filteredTools = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return registry.slice(0, 200)
    return registry.filter((tool) => tool.name.toLowerCase().includes(q)).slice(0, 200)
  }, [registry, query])

  const filteredVersions = useMemo(() => {
    // Show newest first; mise ls-remote returns ascending order.
    const all = [...versions].reverse()
    const q = versionQuery.trim().toLowerCase()
    if (!q) return all.slice(0, 300)
    return all.filter((v) => v.version.toLowerCase().includes(q)).slice(0, 300)
  }, [versions, versionQuery])

  async function chooseTool(name: string) {
    setSelectedTool(name)
    setStep('pick-version')
    setSelectedVersion(null)
    setLoadingVersions(true)
    try {
      const list = await window.mise.listRemote(name)
      setVersions(list)
      const latest = list.length ? list[list.length - 1].version : null
      setSelectedVersion(latest)
    } catch {
      setVersions([])
    } finally {
      setLoadingVersions(false)
    }
  }

  return (
    <div className="overlay" onClick={busy ? undefined : onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>
            {step === 'link'
              ? t('link_title')
              : step === 'pick-tool'
                ? t('add_dialog_title')
                : t('pick_version_title', { tool: selectedTool ?? '' })}
          </h2>
          <div className="spacer" />
          <button className="icon-btn" onClick={onClose} disabled={busy}>
            ✕
          </button>
        </div>

        <div className="modal-body">
          {step === 'link' ? (
            <>
              <p className="hint">{t('link_desc')}</p>
              <div className="field">
                <label>{t('link_tool_label')}</label>
                <input
                  className="input"
                  autoFocus
                  placeholder={t('link_tool_ph')}
                  value={linkTool}
                  onChange={(e) => setLinkTool(e.target.value)}
                />
              </div>
              <div className="field">
                <label>{t('link_version_label')}</label>
                <input
                  className="input"
                  placeholder={t('link_version_ph')}
                  value={linkVersion}
                  onChange={(e) => setLinkVersion(e.target.value)}
                />
                <p className="hint">{t('link_version_hint')}</p>
              </div>
              <div className="field">
                <label>{t('link_path_label')}</label>
                <div className="path-row">
                  <input
                    className="input"
                    placeholder={t('link_path_ph')}
                    value={linkPath}
                    onChange={(e) => setLinkPath(e.target.value)}
                  />
                  <button className="btn" onClick={chooseLinkDir} disabled={busy}>
                    {t('link_pick')}
                  </button>
                </div>
              </div>
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={linkForce}
                  onChange={(e) => setLinkForce(e.target.checked)}
                />
                {t('link_force')}
              </label>
            </>
          ) : step === 'pick-tool' ? (
            <>
              <div className="field">
                <label>{t('search_tool_label', { n: registry.length })}</label>
                <input
                  className="input"
                  autoFocus
                  placeholder={t('search_tool_ph')}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>
              <div className="result-list">
                {loadingRegistry ? (
                  <div className="result-row" style={{ justifyContent: 'center' }}>
                    <div className="spinner" />
                  </div>
                ) : filteredTools.length === 0 ? (
                  <div className="result-row">
                    <span className="meta">{t('no_tools_match')}</span>
                  </div>
                ) : (
                  filteredTools.map((r) => (
                    <div
                      key={r.name}
                      className="result-row"
                      onClick={() => chooseTool(r.name)}
                      {...hover(`mise ls-remote ${r.name}`)}
                    >
                      <strong>{r.name}</strong>
                      <div className="spacer" />
                      {r.backend && <span className="meta">{r.backend}</span>}
                    </div>
                  ))
                )}
              </div>
            </>
          ) : (
            <>
              <div className="field">
                <label>{t('filter_version_label')}</label>
                <input
                  className="input"
                  autoFocus
                  placeholder={t('filter_version_ph')}
                  value={versionQuery}
                  onChange={(e) => setVersionQuery(e.target.value)}
                />
              </div>
              <div className="result-list">
                {loadingVersions ? (
                  <div className="result-row" style={{ justifyContent: 'center' }}>
                    <div className="spinner" />
                  </div>
                ) : filteredVersions.length === 0 ? (
                  <div className="result-row">
                    <span className="meta">{t('no_versions')}</span>
                  </div>
                ) : (
                  filteredVersions.map((v) => (
                    <div
                      key={v.version}
                      className={`result-row ${selectedVersion === v.version ? 'selected' : ''}`}
                      onClick={() => setSelectedVersion(v.version)}
                    >
                      <span className="version-tag">{v.version}</span>
                      <div className="spacer" />
                      {selectedVersion === v.version && (
                        <span className="badge active">{t('selected_badge')}</span>
                      )}
                    </div>
                  ))
                )}
              </div>
              <label className="checkbox">
                <input type="checkbox" checked={pin} onChange={(e) => setPin(e.target.checked)} />
                {t('pin_checkbox')}
              </label>
            </>
          )}
        </div>

        <div className="modal-foot">
          {step !== 'pick-tool' && (
            <button
              className="btn"
              onClick={() => setStep('pick-tool')}
              disabled={busy}
              style={{ marginRight: 'auto' }}
            >
              {t('back')}
            </button>
          )}
          {step === 'pick-tool' && (
            <button
              className="btn"
              disabled={busy}
              onClick={() => {
                if (query.trim()) setLinkTool(query.trim())
                setStep('link')
              }}
              style={{ marginRight: 'auto' }}
            >
              {t('link_entry')}
            </button>
          )}
          <button className="btn" onClick={onClose} disabled={busy}>
            {t('cancel')}
          </button>
          {step === 'pick-version' && (
            <button
              className="btn primary"
              disabled={busy || !selectedTool || !selectedVersion}
              onClick={() =>
                selectedTool && selectedVersion && onInstall(selectedTool, selectedVersion, pin)
              }
              {...hover(
                selectedTool && selectedVersion
                  ? `mise ${pin ? 'use' : 'install'} ${selectedTool}@${selectedVersion}${pin && configPath ? ` --path "${configPath}"` : ''}`
                  : undefined,
              )}
            >
              {busy ? t('installing') : pin ? t('install_and_set') : t('install_only')}
            </button>
          )}
          {step === 'link' && (
            <button
              className="btn primary"
              disabled={busy || !linkTool.trim() || !linkVersion.trim() || !linkPath.trim()}
              onClick={() => onLink(linkTool.trim(), linkVersion.trim(), linkPath.trim(), linkForce)}
              {...hover(
                `mise link ${linkTool || 'TOOL'}@${linkVersion || 'VERSION'} ${
                  linkPath ? `"${linkPath}"` : '<PATH>'
                }${linkForce ? ' --force' : ''}`,
              )}
            >
              {busy ? t('installing') : t('link_submit')}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
