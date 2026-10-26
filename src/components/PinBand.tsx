import type { ReactNode } from 'react'
import type { ConfigPin } from '../types'
import { pathKey } from '../paths'
import { usePrefs } from '../prefs'
import { useCmdHoverFactory, useTip } from '../cmdtip'

interface Props {
  pins: ConfigPin[]
  selected?: string
  onSelect: (path: string) => void
  onImport: () => void
  onReload: () => void
  onDrop: (path: string) => void
  busy: boolean
  dragging?: boolean
  dropTarget?: string
  renderNode?: (id: string, content: ReactNode) => ReactNode
  // Count of unrequested installed versions; graph connections to this bucket
  // are grouped once per tool even when several versions are idle.
  idleCount: number
}

function basename(p: string): string {
  const parts = p.split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] ?? p
}

// The lower band of the tool page: one card per managed config file. The rail on
// 配置文件/任务 lists the same files vertically; here they are targets for the
// links coming down from the tool cards, so they need to be boxes with an edge.
export default function PinBand(props: Props) {
  const { t } = usePrefs()
  const tip = useTip()
  const hover = useCmdHoverFactory()

  return (
    <div className="pin-strip">
      {props.pins.map((p) => {
        const card = (
        <div
          key={p.path}
          className={`pin-card ${props.selected === p.path ? 'active' : ''} ${p.exists ? '' : 'gone'} ${props.dragging ? p.exists || p.kind === 'global' ? 'cable-target' : 'cable-unavailable' : ''} ${props.dropTarget === p.path ? 'cable-over' : ''}`}
          data-pin={p.path}
        >
          <button className="pin-card-hit" onClick={() => props.onSelect(p.path)} {...tip(p.path, true)}>
            <div className="cfg-name-row">
              <span className="cfg-name">{basename(p.path)}</span>
              <span className={`pin-stamp ${p.kind}`}>
                {t(p.kind === 'global' ? 'config_kind_global' : 'config_kind_project')}
              </span>
            </div>
            <div className="cfg-path">{p.dir}</div>
            <div className="cfg-origin-row">
              {p.origin !== 'global' && (
                <span className="cfg-origin">
                  {t(p.origin === 'manual' ? 'config_pin_origin_manual' : 'config_pin_origin_tracked')}
                </span>
              )}
              {!p.exists && <span className="badge warn cfg-missing">{t('config_pin_missing')}</span>}
            </div>
          </button>
          {p.origin === 'manual' && (
            <button
              className="icon-btn cfg-drop"
              disabled={props.busy}
              onClick={() => props.onDrop(p.path)}
              aria-label={t('config_pin_drop_tip')}
            >
              ✕
            </button>
          )}
        </div>
        )
        return props.renderNode ? props.renderNode(`pin:${pathKey(p.path)}`, card) : card
      })}

      {/* Not a config file: the destination for installed versions nobody asks
          for, so 未启用 has an edge instead of being an absence of one. */}
      {(() => { const card = <div className="pin-card idle" data-bucket="1">
        <div className="cfg-name-row">
          <span className="cfg-name">{t('tools_idle_bucket')}</span>
          <span className="pin-stamp idle">{t('count_versions', { n: props.idleCount })}</span>
        </div>
        <div className="cfg-origin-row">
          <span className="cfg-origin">{t('tools_idle_desc')}</span>
        </div>
      </div>; return props.renderNode ? props.renderNode('idle', card) : card })()}

      {!props.renderNode && <><button className="pin-card add" onClick={props.onImport}>
        <span className="cfg-add-plus">＋</span>
        <span className="cfg-add-label">{t('config_pin_import')}</span>
      </button>
      <button
        className="pin-card rescan"
        onClick={props.onReload}
        {...hover('mise config ls --tracked-configs', t('config_pin_rescan_tip'))}
      >
        ⟳
      </button></>}
    </div>
  )
}
