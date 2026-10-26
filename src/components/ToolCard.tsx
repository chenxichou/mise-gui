import { memo } from 'react'
import type { PointerEvent } from 'react'
import type { InstalledTool, InstalledVersion } from '../types'
import { usePrefs } from '../prefs'
import { useCmdTip, useTip } from '../cmdtip'
import { FolderOpenIcon, TrashIcon } from './icons'

interface Props {
  tool: InstalledTool
  busy: boolean
  // The tool page's selected config file asks for this tool, so the card is
  // marked and the page draws a link into it.
  linked: boolean
  configPath?: string
  onConnect: (configPath: string, tool?: string, version?: string) => void
  onCableStart: (event: PointerEvent<HTMLButtonElement>, tool: string, version?: string, dashed?: boolean) => void
  dropKey?: string
  onOpenFolder: (path: string) => void
  onInstall: (tool: string, version: string, pin: boolean) => void
  onAskUninstall: (tool: string, v: InstalledVersion) => void
}

// Memoised so a console line or a toast elsewhere in the app does not re-render
// every card; App keeps the callbacks and tool list referentially stable.
function ToolCard({
  tool,
  busy,
  linked,
  configPath,
  onConnect,
  onCableStart,
  dropKey,
  onOpenFolder,
  onInstall,
  onAskUninstall,
}: Props) {
  const { t } = usePrefs()
  const { show, hide } = useCmdTip()
  const tip = useTip()

  const active = tool.versions.find((v) => v.active)
  const installPath = active?.installPath ?? tool.versions.find((v) => v.installPath)?.installPath

  const hover = (cmd: string, label?: string) => ({
    onMouseEnter: (e: React.MouseEvent<HTMLElement>) => show(cmd, e.currentTarget, label),
    onMouseLeave: hide,
    onFocus: (e: React.FocusEvent<HTMLElement>) => show(cmd, e.currentTarget, label),
    onBlur: hide,
  })

  return (
    <div className={`tool-card ${linked ? 'linked' : ''} ${dropKey === tool.name ? 'cable-over' : ''}`} data-tool={tool.name}>
      <div className="tool-head">
        <span className="tool-name">{tool.name}</span>
        <span className="tool-count">
          {t('count_versions', { n: tool.versions.length })}
          {active ? ` ${t('current_label', { v: active.version })}` : ''}
        </span>
      </div>

      <div className="version-list">
        {tool.versions.map((v) => {
          return (
            <div
              key={v.version}
              data-vkey={`${tool.name}@${v.version}`}
              className={`version-row ${v.active ? 'active' : !v.installed ? 'missing' : ''} ${dropKey === `${tool.name}@${v.version}` ? 'cable-over' : ''}`}
            >
              <button className="cable-handle version-handle" data-cable-version={v.version}
                aria-label={t('tools_drag_version', { tool: tool.name, version: v.version })}
                aria-describedby="tools-drag-help" disabled={busy || !configPath}
                onPointerDown={event => onCableStart(event, tool.name, v.version, !v.installed)}
                onClick={event => { if (event.detail === 0 && configPath) onConnect(configPath, tool.name, v.version) }} />
              <span className="version-tag">{v.version}</span>
              <span
                className={`badge ${v.active ? 'active' : v.installed ? 'inactive' : 'missing'}`}
              >
                {t(v.active ? 'badge_current' : v.installed ? v.sources.length ? 'legend_on' : 'badge_installed' : 'badge_missing')}
              </span>
              <div className="spacer" />
              {!v.installed && (
                <button
                  className="icon-btn"
                  disabled={busy}
                  onClick={() => onInstall(tool.name, v.version, false)}
                  {...hover(`mise install ${tool.name}@${v.version}`, t('install_btn'))}
                >
                  {t('install_btn')}
                </button>
              )}
              {v.installed && (
                <button
                  className="row-btn danger"
                  disabled={busy}
                  aria-label={t('uninstall')}
                  onClick={() => onAskUninstall(tool.name, v)}
                  {...hover(`mise uninstall ${tool.name}@${v.version}`, t('tip_uninstall'))}
                >
                  <TrashIcon size={15} />
                </button>
              )}
            </div>
          )
        })}
      </div>

      {installPath && <div className="tool-foot">
          <div className="tool-location-row">
            <span className="tool-location" {...tip(installPath, true)}>
              {t('install_path_prefix', { s: installPath })}
            </span>
            <button
              className="row-btn"
              aria-label={t('open_folder')}
              onClick={() => onOpenFolder(installPath)}
            >
              <FolderOpenIcon size={15} />
            </button>
          </div>
      </div>}
      <button className="cable-handle tool-handle" data-cable-tool={tool.name}
        aria-label={t('tools_drag_tool', { tool: tool.name })} aria-describedby="tools-drag-help"
        disabled={busy || !configPath} onPointerDown={event => onCableStart(event, tool.name)}
        onClick={event => { if (event.detail === 0 && configPath) onConnect(configPath, tool.name) }} />
    </div>
  )
}

export default memo(ToolCard)
