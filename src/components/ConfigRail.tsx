import type { ConfigPin } from '../types'
import { usePrefs } from '../prefs'
import { useCmdHoverFactory, useTip } from '../cmdtip'

interface Props {
  pins: ConfigPin[]
  selected?: string
  onSelect: (path: string) => void
  onImport: () => void
  onReload: () => void
  onDrop: (path: string) => void
}

function basename(p: string): string {
  const parts = p.split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] ?? p
}

// The managed config files, as the flush left rail 配置 uses. 任务 reuses it so
// both pages answer to the same selection: one file on screen, one scope.
export default function ConfigRail({ pins, selected, onSelect, onImport, onReload, onDrop }: Props) {
  const { t } = usePrefs()
  const tip = useTip()
  const hover = useCmdHoverFactory()

  return (
    <div className="config-files">
      <p className="config-files-note">{t('config_files_note')}</p>
      {pins.map((p) => (
        <div
          key={p.path}
          className={`config-file-row ${selected === p.path ? 'active' : ''}`}
          data-pin={p.path}
        >
          <button className="config-file-item" onClick={() => onSelect(p.path)} {...tip(p.path, true)}>
            <div className="cfg-name-row">
              <span className="cfg-name">{basename(p.path)}</span>
              {/* A seal, not a label: the kind of file is a fact about the row,
                  so it is stamped on its corner instead of competing with the name. */}
              <span className={`pin-stamp ${p.kind}`}>
                {t(p.kind === 'global' ? 'config_kind_global' : 'config_kind_project')}
              </span>
            </div>
            <div className="cfg-path">{p.dir}</div>
            <div className="cfg-origin-row">
              {/* tracked vs imported is the distinction worth spelling out; the
                  global file needs no such note. */}
              {p.origin !== 'global' && (
                <span className="cfg-origin">
                  {t(p.origin === 'manual' ? 'config_pin_origin_manual' : 'config_pin_origin_tracked')}
                </span>
              )}
              {!p.exists && <span className="badge warn cfg-missing">{t('config_pin_missing')}</span>}
            </div>
          </button>
          {/* A button may not nest inside the item button, so 移出 sits in the
              row itself and floats over its corner. */}
          {p.origin === 'manual' && (
            <button
              className="icon-btn cfg-drop"
              onClick={() => onDrop(p.path)}
              aria-label={t('config_pin_drop_tip')}
            >
              ✕
            </button>
          )}
        </div>
      ))}
      {/* The list's last line is the action that adds to it — no header bar above
          the rail, so the files start at the top. */}
      <div className="config-file-row cfg-add-row">
        <button className="config-file-item cfg-add" onClick={onImport}>
          <span className="cfg-add-plus">＋</span>
          <span className="cfg-add-label">{t('config_pin_import')}</span>
        </button>
        <button
          className="icon-btn cfg-rescan"
          onClick={onReload}
          {...hover('mise config ls --tracked-configs', t('config_pin_rescan_tip'))}
        >
          ⟳
        </button>
      </div>
    </div>
  )
}

// Neither page can do anything without a file to scope to, so both fall back to
// the same invitation to import one.
export function PinEmpty({ onImport }: { onImport: () => void }) {
  const { t } = usePrefs()
  return (
    <div className="empty">
      <h2>{t('config_empty_title')}</h2>
      <p>{t('config_empty_desc')}</p>
      <button className="btn primary" onClick={onImport}>
        {t('config_pin_import')}
      </button>
    </div>
  )
}
