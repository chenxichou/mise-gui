import { useEffect, useRef, useState } from 'react'
import type { RunResult, ToolConnection } from '../types'
import { connectionCommands } from '../connections'
import { usePrefs } from '../prefs'
import { useCmdHover } from '../cmdtip'

interface Props {
  connection: ToolConnection
  busy: boolean
  onClose: () => void
  onConfirm: () => Promise<RunResult | null>
}

export default function ConnectionDeleteDialog({ connection, busy, onClose, onConfirm }: Props) {
  const { t } = usePrefs()
  const [error, setError] = useState('')
  const submitting = useRef(false)
  const trigger = useRef(document.activeElement as HTMLElement | null)
  const command = connectionCommands({ from: connection })[0]
  const hover = useCmdHover(command)
  const close = () => {
    if (busy || submitting.current) return
    onClose()
    if (trigger.current?.isConnected) trigger.current.focus()
  }
  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') close() }
    window.addEventListener('keydown', escape)
    return () => window.removeEventListener('keydown', escape)
  })
  const submit = async () => {
    if (busy || submitting.current) return
    submitting.current = true
    setError('')
    try {
      const result = await onConfirm()
      if (result?.ok) { onClose(); if (trigger.current?.isConnected) trigger.current.focus() }
      else setError(result?.stderr.trim() || t('connect_failed'))
    } catch (reason) { setError(String(reason)) }
    finally { submitting.current = false }
  }
  return <div className="overlay" onClick={close}>
    <div className="modal narrow" role="dialog" aria-modal="true" aria-labelledby="edge-delete-title" onClick={event => event.stopPropagation()}>
      <div className="modal-head"><h2 id="edge-delete-title">{t('edge_delete')}</h2><div className="spacer" />
        <button className="icon-btn" disabled={busy} aria-label={t('cancel')} onClick={close}>✕</button></div>
      <div className="modal-body">
        <div className="confirm-target mono">{connection.tool}@{connection.requestedVersion ?? connection.version}</div>
        <p className="connection-path mono">{connection.configPath}</p>
        <p className="confirm-desc">{t('edge_delete_hint')}</p>
        <code className="doc-code mono">{command}</code>
        {error && <div className="config-error" role="alert">{error}</div>}
      </div>
      <div className="modal-foot"><button className="btn" disabled={busy} onClick={close}>{t('cancel')}</button>
        <button className="btn confirm-danger" autoFocus disabled={busy} onClick={() => void submit()} {...hover}>{t(busy ? 'connect_working' : 'edge_delete')}</button></div>
    </div>
  </div>
}
