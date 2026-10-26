import { useEffect, useState } from 'react'
import { usePrefs } from './prefs'
import { PanelIcon } from './components/icons'

interface Props {
  collapsed: boolean
  onToggleSidebar: () => void
}

export default function TitleBar({ collapsed, onToggleSidebar }: Props) {
  const { t } = usePrefs()
  const [maximized, setMaximized] = useState(false)
  useEffect(() => {
    const unsub = window.windowControls?.onMaximizedChanged(setMaximized)
    return () => unsub?.()
  }, [])

  const controls = window.windowControls

  return (
    <div className="titlebar">
      {/* Sidebar toggle lives here, top-left, the way Qoder does it. */}
      <button
        className="titlebar-toggle"
        onClick={onToggleSidebar}
        aria-label={collapsed ? t('sidebar_expand') : t('sidebar_collapse')}
        aria-pressed={collapsed}
      >
        <PanelIcon size={15} />
      </button>
      <div className="titlebar-title">
        <span className="titlebar-logo">m</span>
        <span>Mise GUI</span>
        <span className="titlebar-sub">{t('brand_sub')}</span>
      </div>
      <div className="titlebar-controls">
        <button
          className="win-btn"
          onClick={() => controls?.minimize()}
          aria-label={t('win_minimize')}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
            <line x1="0" y1="5" x2="10" y2="5" stroke="currentColor" />
          </svg>
        </button>
        <button
          className="win-btn"
          onClick={() => controls?.toggleMaximize()}
          aria-label={maximized ? t('win_restore') : t('win_maximize')}
        >
          {maximized ? (
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
              <rect x="0.5" y="2.5" width="6" height="6" fill="none" stroke="currentColor" />
              <path d="M2.5 2.5 V0.5 H9.5 V7.5 H7.5" fill="none" stroke="currentColor" />
            </svg>
          ) : (
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
              <rect x="0.5" y="0.5" width="9" height="9" fill="none" stroke="currentColor" />
            </svg>
          )}
        </button>
        <button
          className="win-btn close"
          onClick={() => controls?.close()}
          aria-label={t('win_close')}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
            <path d="M0 0 L10 10 M10 0 L0 10" stroke="currentColor" />
          </svg>
        </button>
      </div>
    </div>
  )
}
