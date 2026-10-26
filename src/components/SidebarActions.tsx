import { useEffect, useRef, useState } from 'react'
import { usePrefs } from '../prefs'
import { DocsIcon, MoreIcon, SettingsIcon } from './icons'

interface Props {
  collapsed: boolean
  docsActive: boolean
  onDocs: () => void
  onSettings: () => void
}

export default function SidebarActions({ collapsed, docsActive, onDocs, onSettings }: Props) {
  const { t } = usePrefs()
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)

  useEffect(() => setOpen(false), [collapsed])
  useEffect(() => {
    if (!open) return
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false)
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setOpen(false)
      trigger.current?.focus()
    }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('pointerdown', outside)
      document.removeEventListener('keydown', escape)
    }
  }, [open])

  const buttons = (
    <>
      <button
        className={`quick-toggle docs ${docsActive ? 'active' : ''}`}
        aria-label={t('nav_docs')}
        onClick={() => { setOpen(false); onDocs() }}
      ><DocsIcon size={15} /></button>
      <button
        className="quick-toggle settings"
        aria-label={t('sp_title')}
        onClick={() => { setOpen(false); onSettings() }}
      ><SettingsIcon size={15} /></button>
    </>
  )

  if (!collapsed) return <div className="foot-actions">{buttons}</div>

  return (
    <div className="sidebar-more" ref={root} onBlur={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false)
    }}>
      <button
        className={`quick-toggle ${open ? 'active' : ''}`}
        ref={trigger}
        aria-label={t('sidebar_more')}
        aria-expanded={open}
        aria-controls={open ? 'sidebar-more-actions' : undefined}
        onClick={() => setOpen((value) => !value)}
      ><MoreIcon size={17} /></button>
      {open && <div id="sidebar-more-actions" className="sidebar-more-popover" role="group" aria-label={t('sidebar_more')}>
        {buttons}
      </div>}
    </div>
  )
}
