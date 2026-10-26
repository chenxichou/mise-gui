import { useEffect, useMemo, useState } from 'react'
import type { SettingsInfo } from '../types'
import { usePrefs } from '../prefs'
import { useCmdTip } from '../cmdtip'

interface Props {
  settings: SettingsInfo | null
  busy: boolean
  onSet: (key: string, value: string) => void
  onUnset: (key: string) => void
}

type Kind = 'bool' | 'int' | 'text'

// The handful of settings worth a control. mise has ~200 keys; the rest are only
// listed, read-only, behind 更多 — and documented upstream.
const COMMON: { key: string; kind: Kind; desc: string }[] = [
  { key: 'pin', kind: 'bool', desc: 'settings_pin' },
  { key: 'jobs', kind: 'int', desc: 'settings_jobs' },
  { key: 'disable_update_warning', kind: 'bool', desc: 'settings_update_warning' },
  { key: 'legacy_version_file', kind: 'bool', desc: 'settings_legacy' },
  { key: 'always_keep_download', kind: 'bool', desc: 'settings_keep_download' },
  { key: 'always_keep_install', kind: 'bool', desc: 'settings_keep_install' },
  { key: 'offline', kind: 'bool', desc: 'settings_offline' },
  { key: 'experimental', kind: 'bool', desc: 'settings_experimental' },
  { key: 'http_timeout', kind: 'text', desc: 'settings_http_timeout' },
  { key: 'cache_prune_age', kind: 'text', desc: 'settings_cache_prune' },
]

function display(v: unknown): string {
  if (v === null || v === undefined) return '—'
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

function Switch({
  on,
  disabled,
  onChange,
  ...rest
}: {
  on: boolean
  disabled: boolean
  onChange: () => void
} & Record<string, unknown>) {
  return (
    <button
      type="button"
      className={`switch ${on ? 'on' : ''}`}
      role="switch"
      aria-checked={on}
      disabled={disabled}
      onClick={onChange}
      {...rest}
    >
      <span className="track">
        <span className="fill" />
        <span className="mark ring" />
        <span className="mark dash" />
      </span>
      <span className="knob" />
    </button>
  )
}

function ValueField({
  value,
  kind,
  disabled,
  onCommit,
}: {
  value: string
  kind: Kind
  disabled: boolean
  onCommit: (next: string) => void
}) {
  const [draft, setDraft] = useState(value)
  const [editing, setEditing] = useState(false)
  const shown = editing ? draft : value
  return (
    <input
      className="input settings-input"
      type={kind === 'int' ? 'number' : 'text'}
      value={shown}
      disabled={disabled}
      onChange={(e) => {
        setEditing(true)
        setDraft(e.target.value)
      }}
      onBlur={() => {
        if (editing && shown !== value) onCommit(shown)
        setEditing(false)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        if (e.key === 'Escape') {
          setEditing(false)
          setDraft(value)
          ;(e.target as HTMLInputElement).blur()
        }
      }}
    />
  )
}

export default function SettingsView({ settings, busy, onSet, onUnset }: Props) {
  const { t } = usePrefs()
  // Plain handlers, not useCmdHover: these are built inside a list.
  const { show, hide } = useCmdTip()
  const cmdHover = (cmd: string, label: string) => ({
    onMouseEnter: (e: React.MouseEvent<HTMLElement>) => show(cmd, e.currentTarget, label),
    onMouseLeave: () => hide(),
    onFocus: (e: React.FocusEvent<HTMLElement>) => show(cmd, e.currentTarget, label),
    onBlur: () => hide(),
  })

  const all = useMemo(() => settings?.all ?? {}, [settings])
  const configured = settings?.configured ?? {}
  const isSet = (k: string) => k in configured

  const [search, setSearch] = useState('')
  const [onlyConfigured, setOnlyConfigured] = useState(false)
  // mise has ~200 settings; only the common ones get a control on the page, the
  // read-only rest opens on demand so the config view stays about the file.
  const [allOpen, setAllOpen] = useState(false)

  useEffect(() => {
    if (!allOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setAllOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [allOpen])

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    return Object.entries(all)
      .filter(([k]) => !q || k.toLowerCase().includes(q))
      .sort(([a], [b]) => a.localeCompare(b))
  }, [all, search])

  const visible = onlyConfigured ? rows.filter(([k]) => isSet(k)) : rows

  return (
    <div className="settings-scroll">
      <div className="settings-note">{t('settings_intro')}</div>

      <div className="settings-section">
        <div className="settings-section-head">
          <span className="settings-section-title">{t('settings_common')}</span>
          <div className="spacer" />
          <button
            className="btn tiny"
            onClick={() => setAllOpen(true)}
          >
            {t('config_more')}
          </button>
        </div>
        {COMMON.map((c) => {
          const value = all[c.key]
          const nextBool = value === true ? 'false' : 'true'
          return (
            <div className="settings-row" key={c.key}>
              <div className="settings-meta">
                <span className="mono settings-key">{c.key}</span>
                <span className="settings-desc">{t(c.desc)}</span>
              </div>
              <div className="settings-actions">
                {isSet(c.key) && (
                  <button
                    className="btn tiny ghost"
                    disabled={busy}
                    onClick={() => onUnset(c.key)}
                    {...cmdHover(
                      `mise settings unset ${c.key}`,
                      t('settings_reset_tip'),
                    )}
                  >
                    {t('settings_reset')}
                  </button>
                )}
                {c.kind === 'bool' ? (
                  <Switch
                    on={value === true}
                    disabled={busy}
                    onChange={() => onSet(c.key, nextBool)}
                    {...cmdHover(
                      `mise settings set ${c.key} ${nextBool}`,
                      t('settings_write_global'),
                    )}
                  />
                ) : (
                  <ValueField
                    value={display(value)}
                    kind={c.kind}
                    disabled={busy}
                    onCommit={(next) => onSet(c.key, next)}
                  />
                )}
              </div>
            </div>
          )
        })}
      </div>

      {allOpen && (
        <div className="overlay" onClick={() => setAllOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h2>{t('settings_all')}</h2>
              <div className="spacer" />
              <button className="icon-btn" onClick={() => setAllOpen(false)}>
                ✕
              </button>
            </div>
            <div className="modal-body">
              <p className="confirm-desc">{t('settings_all_desc')}</p>
              <div className="settings-filter">
                <input
                  className="input settings-search"
                  placeholder={t('settings_search')}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                <button
                  className={`filter-seg-btn ${onlyConfigured ? 'active' : ''}`}
                  onClick={() => setOnlyConfigured((v) => !v)}
                >
                  {t('settings_only_configured')}
                </button>
                <div className="spacer" />
                <span className="settings-count">
                  {t('settings_count', { n: visible.length })}
                </span>
              </div>
              {visible.length === 0 ? (
                <div className="settings-empty">{t('settings_no_match')}</div>
              ) : (
                visible.map(([k, v]) => (
                  <div className={`settings-row readonly ${isSet(k) ? 'set' : ''}`} key={k}>
                    <div className="settings-meta">
                      <span className="mono settings-key">{k}</span>
                      {isSet(k) && <span className="badge ok">{t('settings_set_badge')}</span>}
                    </div>
                    <span className="mono settings-value">{display(v)}</span>
                  </div>
                ))
              )}
            </div>
            <div className="modal-foot">
              <button className="btn" onClick={() => setAllOpen(false)}>
                {t('close')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
