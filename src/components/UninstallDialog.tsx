import { useEffect } from 'react'
import { usePrefs } from '../prefs'
import { useCmdHover } from '../cmdtip'

interface Target {
  tool: string
  version: string
  installPath?: string
  source?: string
}

interface Props {
  target: Target
  busy: boolean
  onCancel: () => void
  onConfirm: () => void
}

export default function UninstallDialog({ target, busy, onCancel, onConfirm }: Props) {
  const { t } = usePrefs()
  const spec = `${target.tool}@${target.version}`
  const hover = useCmdHover(`mise uninstall ${spec}`)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [busy, onCancel])

  return (
    <div className="overlay" onClick={busy ? undefined : onCancel}>
      <div className="modal narrow" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>{t('uninstall_confirm_title')}</h2>
          <div className="spacer" />
          <button className="icon-btn" onClick={onCancel} disabled={busy}>
            ✕
          </button>
        </div>

        <div className="modal-body">
          <div className="confirm-target mono">{spec}</div>
          <p className="confirm-desc">{t('uninstall_confirm_desc', { spec })}</p>
          {target.installPath && (
            <p className="confirm-meta mono">{t('install_path_prefix', { s: target.installPath })}</p>
          )}
          {target.source && (
            <div className="confirm-warn">
              {t('uninstall_confirm_config_note', { s: target.source })}
            </div>
          )}
          <code className="doc-code mono">{`mise uninstall ${spec}`}</code>
        </div>

        <div className="modal-foot">
          <button className="btn" onClick={onCancel} disabled={busy}>
            {t('cancel')}
          </button>
          <button
            className="btn confirm-danger"
            onClick={onConfirm}
            disabled={busy}
            {...hover}
          >
            {busy ? t('uninstalling') : t('uninstall')}
          </button>
        </div>
      </div>
    </div>
  )
}
