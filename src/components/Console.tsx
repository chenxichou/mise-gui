import { memo } from 'react'
import type { ConsoleLine } from '../App'
import { usePrefs } from '../prefs'
import { PanelRightIcon } from './icons'

interface Props {
  lines: ConsoleLine[]
  onClose: () => void
  onClear: () => void
  busy: boolean
}

function Console({ lines, onClose, onClear, busy }: Props) {
  const { t } = usePrefs()
  return (
    <aside className="console command-sidebar" id="command-output" aria-label={t('console_title')}>
      <div className="console-head">
        <div className="console-heading"><span className="console-title">{t('console_title')}</span>
        <span className="console-count">
          {lines.length > 0 ? t('console_lines', { n: lines.length }) : `· ${t('console_idle')}`}
        </span>
        </div>
        <button className="icon-btn" onClick={onClear}>
          {t('console_clear')}
        </button>
        <button className="icon-btn console-toggle" onClick={onClose} aria-label={t('console_collapse')} aria-expanded="true" aria-controls="command-output">
          <PanelRightIcon size={16} />
        </button>
      </div>
      {busy && <div className="console-progress" role="status"><span className="spinner" />{t('console_busy')}</div>}
      <div className="console-body">
        {lines.length === 0 ? (
          <div className="console-line" style={{ color: 'var(--text-faint)' }}>
            {t('console_placeholder')}
          </div>
        ) : (
          lines.map((l) => (
            <div key={l.id} className={`console-line ${l.kind}`}>
              {l.text}
            </div>
          ))
        )}
      </div>
    </aside>
  )
}

export default memo(Console)
