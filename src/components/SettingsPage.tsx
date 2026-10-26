import { Fragment, useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import type { EnvDirInfo, EnvVarName, MiseStatus } from '../types'
import { usePrefs } from '../prefs'
import { useTip, writeClipboard } from '../cmdtip'
import {
  BackIcon,
  CopyIcon,
  CheckIcon,
  RotateIcon,
  EnvIcon,
  FolderOpenIcon,
  InfoIcon,
  PaletteIcon,
  SettingsIcon,
} from './icons'

type Section = 'general' | 'mise' | 'env'

// Directory purposes stay visible; migration notes appear in the change preview.
type EnvItem = {
  v: EnvVarName
  name: string
  desc: string
  pick: string
  notes: string[]
}

// Keep durable data separate from the rebuildable cache.
const ENV_GROUPS: {
  id: 'before' | 'anytime'
  title: string
  sub: string
  items: EnvItem[]
}[] = [
  {
    id: 'before',
    title: 'sp_env_g_before',
    sub: 'sp_env_g_before_sub',
    items: [
      {
        v: 'MISE_DATA_DIR',
        name: 'sp_env_data',
        desc: 'sp_env_data_desc',
        pick: 'sp_dir_pick',
        notes: ['sp_dir_note_move'],
      },
      {
        v: 'MISE_CONFIG_DIR',
        name: 'sp_env_config',
        desc: 'sp_env_config_desc',
        pick: 'sp_env_config_pick',
        notes: ['sp_env_config_note'],
      },
      {
        v: 'MISE_SHIMS_DIR',
        name: 'sp_env_shims',
        desc: 'sp_env_shims_desc',
        pick: 'sp_env_shims_pick',
        notes: ['sp_env_shims_note'],
      },
      {
        v: 'MISE_STATE_DIR',
        name: 'sp_env_state',
        desc: 'sp_env_state_desc',
        pick: 'sp_env_state_pick',
        notes: ['sp_env_state_note'],
      },
    ],
  },
  {
    id: 'anytime',
    title: 'sp_env_g_anytime',
    sub: 'sp_env_g_anytime_sub',
    items: [
      {
        v: 'MISE_CACHE_DIR',
        name: 'sp_env_cache',
        desc: 'sp_env_cache_desc',
        pick: 'sp_env_cache_pick',
        notes: ['sp_env_cache_note'],
      },
    ],
  },
]

interface Props {
  onBack: () => void
  status: MiseStatus | null
  probing: boolean
  initialSection?: Section
  onReprobe: () => void
  // Runs the environment write in the main process and reloads every view.
  onApplyEnvDir: (v: EnvVarName, next: string | null) => Promise<{ ok: boolean; error?: string }>
  onOpenFolder: (path: string) => void
  busy: boolean
}

function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T
  options: { value: T; label: string }[]
  onChange: (next: T) => void
}) {
  return (
    <div className="filter-seg" role="group">
      {options.map((o) => (
        <button
          key={o.value}
          className={`filter-seg-btn ${value === o.value ? 'active' : ''}`}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

function Row({
  name,
  desc,
  wide,
  children,
}: {
  name: string
  desc?: string
  wide?: boolean
  children: ReactNode
}) {
  return (
    <div className={`sp-row ${wide ? 'wide' : ''}`}>
      <div className="sp-row-label">
        <span className="sp-row-name">{name}</span>
        {desc && <span className="sp-row-desc">{desc}</span>}
      </div>
      <div className="sp-row-ctl">{children}</div>
    </div>
  )
}

export default function SettingsPage(props: Props) {
  const { t, lang, setLang, theme, setTheme } = usePrefs()
  const tip = useTip()
  const api = typeof window !== 'undefined' ? window.mise : undefined
  const [section, setSection] = useState<Section>(props.initialSection ?? 'general')

  const [envs, setEnvs] = useState<Record<EnvVarName, EnvDirInfo> | null>(null)
  const [saving, setSaving] = useState<EnvVarName | null>(null)
  const [error, setError] = useState('')
  const [help, setHelp] = useState(false)
  const [reading, setReading] = useState(false)
  const [picking, setPicking] = useState(false)
  const [draft, setDraft] = useState<{ v: EnvVarName; next: string | null } | null>(null)
  const [feedback, setFeedback] = useState<{ v: EnvVarName; kind: 'ok' | 'err'; text: string } | null>(null)
  const [copied, setCopied] = useState<EnvVarName | null>(null)
  const request = useRef(0)
  const saveInFlight = useRef(false)

  const loadEnvs = useCallback(async () => {
    if (!api) return false
    const id = ++request.current
    setReading(true)
    setError('')
    try {
      const values = await api.getEnvDirs()
      if (id === request.current) setEnvs(values)
      return true
    } catch (err) {
      if (id === request.current) setError(String(err))
      return false
    } finally {
      if (id === request.current) setReading(false)
    }
  }, [api])

  useEffect(() => () => { request.current++ }, [])
  useEffect(() => {
    if (section === 'env') void loadEnvs()
  }, [section, loadEnvs, props.status?.installed])
  useEffect(() => {
    const refresh = () => {
      if (section === 'env' && !props.busy && !saving && !picking && !draft && !reading) void loadEnvs()
    }
    window.addEventListener('focus', refresh)
    return () => window.removeEventListener('focus', refresh)
  }, [section, props.busy, saving, picking, draft, reading, loadEnvs])
  useEffect(() => {
    if (!copied) return
    const timer = window.setTimeout(() => setCopied(null), 1400)
    return () => window.clearTimeout(timer)
  }, [copied])

  const { onBack } = props
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (help) setHelp(false)
      else if (draft) setDraft(null)
      else onBack()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [help, draft, onBack])

  const apply = async () => {
    if (!draft || saveInFlight.current) return
    const { v, next } = draft
    saveInFlight.current = true
    setSaving(v)
    setFeedback(null)
    try {
      const result = await props.onApplyEnvDir(v, next)
      if (!result.ok) {
        setFeedback({ v, kind: 'err', text: result.error || t('sp_dir_fail') })
        return
      }
      setDraft(null)
      const refreshed = await loadEnvs()
      setFeedback({ v, kind: 'ok', text: t(!refreshed ? 'sp_env_saved_refresh_failed' : next === null ? 'sp_dir_cleared' : 'sp_dir_saved') })
    } catch (err) {
      setFeedback({ v, kind: 'err', text: String(err) })
    } finally {
      saveInFlight.current = false
      setSaving(null)
    }
  }

  const pick = async (v: EnvVarName, titleKey: string) => {
    const info = envs?.[v]
    if (!api || !info) return
    setPicking(true)
    setFeedback(null)
    try {
      const next = await api.pickFolder(t(titleKey), info.current)
      if (!next) return
      if (next === info.current) {
        setFeedback({ v, kind: 'ok', text: t('sp_dir_same') })
        return
      }
      setDraft({ v, next })
    } catch (err) {
      setFeedback({ v, kind: 'err', text: String(err) })
    } finally { setPicking(false) }
  }

  const copyPath = async (v: EnvVarName, path: string) => {
    if (await writeClipboard(path)) setCopied(v)
    else setFeedback({ v, kind: 'err', text: t('sp_env_copy_failed') })
  }
  const locked = props.busy || saving !== null || picking || reading

  const misePath = props.status?.installed ? props.status.path : ''

  const nav: { id: Section; label: string; group: string; icon: ReactNode }[] = [
    { id: 'general', label: t('sp_nav_general'), group: t('sp_group_app'), icon: <PaletteIcon size={16} /> },
    { id: 'mise', label: t('sp_nav_mise'), group: t('sp_group_mise'), icon: <SettingsIcon size={16} /> },
    { id: 'env', label: t('sp_nav_env'), group: t('sp_group_mise'), icon: <EnvIcon size={16} /> },
  ]
  const groups: string[] = []
  const items: ReactNode[] = []
  for (const n of nav) {
    if (!groups.includes(n.group)) {
      groups.push(n.group)
      items.push(
        <div className="sp-group" key={`g-${n.group}`}>
          {n.group}
        </div>,
      )
    }
    items.push(
      <button
        key={n.id}
        className={`sp-nav-item ${section === n.id ? 'active' : ''}`}
        onClick={() => setSection(n.id)}
      >
        <span className="nav-ico">{n.icon}</span>
        <span className="nav-label">{n.label}</span>
      </button>,
    )
  }

  return (
    <div className="settings-page">
      <div className="settings-rail">
        <button className="sp-back" onClick={props.onBack}>
          <BackIcon size={15} />
          <span>{t('sp_back')}</span>
        </button>
        <nav className="sp-nav">{items}</nav>
      </div>

      <div className="settings-pane">
        <div className="sp-pane-head">
          <div className="sp-title-row">
            <h2>{t(`sp_h_${section}`)}</h2>
            {section === 'env' && <div className="sp-actions">
              <button className="btn tiny" onClick={() => void loadEnvs()} disabled={locked} aria-label={t('sp_env_refresh')} aria-busy={reading}>
                <RotateIcon size={14} /> {t('refresh')}
              </button>
              <button className="icon-btn" onClick={() => setHelp(true)} aria-label={t('sp_env_help_open')}>
                <InfoIcon size={17} />
              </button>
            </div>}
          </div>
          <p>{t(`sp_sub_${section}`)}</p>
        </div>

        {section === 'general' && (
          <>
            <div className="sp-card">
              <Row name={t('sp_theme')} desc={t('sp_theme_desc')}>
                <Segmented
                  value={theme}
                  onChange={(v) => setTheme(v)}
                  options={[
                    { value: 'dark', label: t('theme_dark') },
                    { value: 'light', label: t('theme_light') },
                  ]}
                />
              </Row>
              <Row name={t('sp_lang')} desc={t('sp_lang_desc')}>
                <Segmented
                  value={lang}
                  onChange={(v) => setLang(v)}
                  options={[
                    { value: 'zh', label: '中文' },
                    { value: 'en', label: 'English' },
                  ]}
                />
              </Row>
            </div>
            <div className="sp-hint">{t('sp_general_hint')}</div>
          </>
        )}

        {section === 'mise' && (
          <>
            <div className="sp-card">
              <Row name={t('sp_mise_ver')} desc={t('sp_mise_path')} wide>
                <div className="sp-path-wrap">
                  <span className="mono sp-path" {...tip(misePath, true)}>
                    {props.status?.installed
                      ? `${props.status.version} · ${props.status.path}`
                      : t('sp_mise_missing')}
                  </span>
                  <button className="btn tiny" onClick={props.onReprobe} disabled={props.probing} aria-busy={props.probing}>
                    {t(props.probing ? 'detecting' : 'sp_probe_again')}
                  </button>
                </div>
              </Row>
            </div>
            <div className="sp-hint">{t(props.status?.installed ? 'sp_mise_hint' : 'ni_desc')}</div>
          </>
        )}

        {section === 'env' && (
          <>
            {error && <div className="config-error mono" role="alert">
              {error}
              <button className="btn tiny" onClick={() => void loadEnvs()} disabled={locked}>{t('sp_env_retry')}</button>
            </div>}
            {!props.status?.installed && !Object.values(envs ?? {}).some(info => info.verified)
              && <p className="sp-hint">{t('sp_env_preinstall')}</p>}
            {ENV_GROUPS.map((group) => (
              <div className="sp-env-group" key={group.id}>
                <div className="sp-env-group-head">
                  <span className={`sp-env-group-mark ${group.id}`} />
                  <span className="sp-env-group-title">{t(group.title)}</span>
                </div>
                <p className="sp-env-group-sub">{t(group.sub)}</p>
                {group.items.map((item) => {
                  const info = envs?.[item.v]
                  const editing = draft?.v === item.v
                  const result = feedback?.v === item.v ? feedback : null
                  return (
                    <div className="sp-card env-card" key={item.v} data-env={item.v} aria-busy={saving === item.v}>
                      <div className="sp-env-head">
                        <div className="sp-env-heading">
                          <span className="sp-row-name">{t(item.name)}</span>
                          {info && <span className="badge inactive env-source">{t('sp_env_source_' + info.source)}</span>}
                          <span className="mono sp-env-var">{item.v}</span>
                        </div>
                        <div className="sp-actions">
                          <button className="btn tiny" disabled={locked || !info?.editable}
                            onClick={() => void pick(item.v, item.pick)}>{t('sp_dir_change')}</button>
                          {info?.persisted && <button className="btn tiny ghost" disabled={locked || !info.editable}
                            onClick={() => { setDraft({ v: item.v, next: null }); setFeedback(null) }}>{t('sp_dir_reset')}</button>}
                        </div>
                      </div>
                      <p className="sp-env-description">{t(item.desc)}
                        {info && !info.exists && <span className="env-path-note"> · {t('sp_env_not_created')}</span>}
                      </p>
                      <div className="sp-dir-line env-path-row">
                        <span className="sp-dir-key">{t(info?.verified ? 'sp_dir_current' : 'sp_env_expected')}</span>
                        <span className="mono sp-dir-val" {...tip(info?.current, true)}>{info?.current ?? t(reading ? 'sp_env_loading' : 'sp_env_not_loaded')}</span>
                        {info && <div className="sp-actions">
                          <button className="icon-btn" onClick={() => void copyPath(item.v, info.current)}
                            aria-label={t(copied === item.v ? 'cmd_copied' : 'sp_env_copy')}>
                            {copied === item.v ? <CheckIcon size={14} /> : <CopyIcon size={14} />}
                          </button>
                          <button className="icon-btn" disabled={!info.exists} onClick={() => props.onOpenFolder(info.current)}
                            aria-label={t(info.exists ? 'sp_open' : 'sp_env_not_created')}><FolderOpenIcon size={14} /></button>
                        </div>}
                      </div>
                      {info && !info.editable && <p className="sp-hint">{t('sp_env_readonly')}</p>}
                      {editing && <div className="env-draft">
                        <div className="env-draft-path"><span>{t('sp_env_from')}</span><code>{info?.current}</code></div>
                        <div className="env-draft-path"><span>{t('sp_env_to')}</span><code>{draft.next ?? t('sp_env_remove_preview')}</code></div>
                        <p>{t(item.notes[0])}</p>
                        <div className="sp-actions">
                          <button className="btn tiny primary" onClick={() => void apply()} disabled={locked}>{t(saving === item.v ? 'config_saving' : 'sp_env_apply')}</button>
                          <button className="btn tiny" onClick={() => setDraft(null)} disabled={locked}>{t('cancel')}</button>
                        </div>
                      </div>}
                      {result && <div className={`env-feedback ${result.kind}`} role={result.kind === 'err' ? 'alert' : 'status'}>{result.text}</div>}
                    </div>
                  )
                })}
              </div>
            ))}

            {help && (
              <div className="overlay" onClick={() => setHelp(false)}>
                <div className="modal env-help" onClick={(e) => e.stopPropagation()}>
                  <div className="modal-head">
                    <h2>{t('sp_env_help')}</h2>
                    <div className="spacer" />
                    <button className="icon-btn" aria-label={t('sp_env_help_close')} onClick={() => setHelp(false)}>
                      ✕
                    </button>
                  </div>
                  <div className="modal-body">
                    <table className="env-help-table">
                      <thead>
                        <tr>
                          <th>{t('sp_env_help_var')}</th>
                          <th>{t('sp_env_help_role')}</th>
                          <th>{t('sp_env_help_default')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {ENV_GROUPS.map((group) => (
                          <Fragment key={group.id}>
                            <tr className="env-help-group">
                              <td colSpan={3}>
                                <span className={`sp-env-group-mark ${group.id}`} />
                                {t(group.title)}
                              </td>
                            </tr>
                            {group.items.map((item) => (
                              <tr key={item.v}>
                                <td className="mono">{item.v}</td>
                                <td>
                                  <span className="env-help-name">{t(item.name)}</span>
                                  <span className="env-help-desc">{t(item.desc)}</span>
                                </td>
                                <td className="mono env-help-path">
                                  {envs?.[item.v]?.fallback ?? '…'}
                                </td>
                              </tr>
                            ))}
                          </Fragment>
                        ))}
                      </tbody>
                    </table>
                    <div className="sp-hint">{t('sp_env_help_hint')}</div>
                  </div>
                  <div className="modal-foot">
                    <div className="spacer" />
                    <button className="btn" onClick={() => setHelp(false)}>
                      {t('sp_env_help_close')}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </>
        )}

      </div>
    </div>
  )
}
