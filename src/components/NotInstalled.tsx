import { useEffect, useState } from 'react'
import { usePrefs } from '../prefs'
import { useCmdHover } from '../cmdtip'
import type { MiseInstaller } from '../types'

interface Props {
  error: string
  probing: boolean
  installing: boolean
  installError: string
  onInstall: () => void
  onRetry: () => void
  onDocs: () => void
  onSettings: () => void
}

export default function NotInstalled({ error, probing, installing, installError, onInstall, onRetry, onDocs, onSettings }: Props) {
  const { t } = usePrefs()
  const [installer, setInstaller] = useState<MiseInstaller | null>(null)
  const [planError, setPlanError] = useState('')
  useEffect(() => {
    let live = true
    window.mise.getInstaller().then(plan => { if (live) setInstaller(plan) })
      .catch(err => { if (live) setPlanError(String(err)) })
    return () => { live = false }
  }, [])
  const hover = useCmdHover(installer?.command, t('ni_install'))
  return (
    <div className="empty mise-unavailable" role="region" aria-label={t('ni_title')}>
      <h2>{t('ni_title')}</h2>
      <p>{t('ni_desc')}</p>
      <div className="unavailable-actions">
        {installer?.supported && <button className="btn primary"
          onClick={onInstall} disabled={installing || probing} aria-busy={installing} {...hover}>
          {t(installing ? 'ni_installing' : installError ? 'ni_install_retry' : 'ni_install')}
        </button>}
        <button className="btn" onClick={onRetry} disabled={probing || installing} aria-busy={probing}>
          {t(probing ? 'detecting' : 'sp_probe_again')}
        </button>
        <button className="btn" onClick={onDocs}>{t('nav_docs')}</button>
        <button className="btn" onClick={onSettings}>{t('sp_nav_env')}</button>
      </div>
      {installing && <p className="install-progress" role="status"><span className="spinner" />{t('ni_install_progress')}</p>}
      {(installError || planError) && <div className="config-error install-error" role="alert">{installError || planError}</div>}
      <p className="hint">{t('ni_available')}</p>
      {installer?.supported ? <div className="installer-plan">
        <p>{t('ni_install_hint')}</p>
        <code className="mono">{installer.command}</code>
      </div> : installer && <p>{t('ni_install_unavailable')}</p>}
      {error && <details className="unavailable-details">
        <summary>{t('ni_details')}</summary>
        <pre>{error}</pre>
      </details>}
    </div>
  )
}
