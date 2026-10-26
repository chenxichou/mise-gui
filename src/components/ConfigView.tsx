import { useEffect, useMemo, useState } from 'react'
import type { ConfigContent, ConfigPin, RunResult } from '../types'
import { usePrefs } from '../prefs'
import { useCmdHoverFactory } from '../cmdtip'
import { parseSections, type ConfigRow, type SectionId } from '../configSections'
import ConfigRail, { PinEmpty } from './ConfigRail'

interface Props {
  pins: ConfigPin[]
  onReloadPins: () => void
  onImportPin: () => void
  onDropPin: (path: string) => void
  onSelectPin: (path: string) => void
  selectedPath?: string
  content?: ConfigContent | null
  text?: string
  onEditorText?: (text: string) => void
  onSave?: () => Promise<void>
  saving?: boolean
  onTrust?: (path: string) => Promise<RunResult>
  trusted?: Set<string>
  // Bumped by App each time cfgContent is (re)read, so the editor resets only
  // on real file switches/reloads — not after a save echoes back.
  loadedAt?: number
  // The mise [settings] editor. Only shown while the global config file is the
  // one on screen, because that is the file those writes land in.
  settingsSlot?: React.ReactNode
}

// The main process only parses *.toml; the same rule keeps the section view and
// its validation off .tool-versions and *.yml files.
function isTomlPath(p: string): boolean {
  return p.toLowerCase().endsWith('.toml')
}

// The four tables most files actually use stay on screen; everything else mise
// understands ([alias], [plugins], [watched_files], hooks…) goes behind 更多 so a
// normal config does not read like a list of empty headings.
const COMMON: SectionId[] = ['tools', 'env', 'settings', 'tasks']

const secTitleKey: Record<SectionId, string> = {
  tools: 'config_sec_tools',
  env: 'config_sec_env',
  settings: 'config_sec_settings',
  tasks: 'config_sec_tasks',
  other: 'config_sec_other',
}

function Rows({ rows }: { rows: ConfigRow[] }) {
  const { t } = usePrefs()
  if (rows.length === 0) return <div className="config-sec-empty">{t('config_sec_empty')}</div>
  return (
    <>
      {rows.map((r) => (
        <div className="config-sec-row" key={r.key}>
          <span className="mono config-sec-key">{r.key}</span>
          <span className="config-sec-val">{r.value}</span>
          {r.note && (
            <span className="mono config-sec-note">
              {r.note}
            </span>
          )}
        </div>
      ))}
    </>
  )
}

export default function ConfigView(props: Props) {
  const { t } = usePrefs()
  const hover = useCmdHoverFactory()
  const [showRaw, setShowRaw] = useState(true)
  const [moreOpen, setMoreOpen] = useState(false)

  const selected = props.selectedPath
  const selectedPin = props.pins.find((p) => p.path === selected)

  const content = props.content ?? null
  const text = props.text ?? ''
  const saving = props.saving ?? false

  // A different file on screen means the 更多 dialog must not follow it.
  useEffect(() => setMoreOpen(false), [selected])

  useEffect(() => {
    if (!moreOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMoreOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [moreOpen])

  const dirty = content !== null && text !== content.content

  // Sections and validation follow the buffer, not the file on disk, so editing
  // the raw text updates the partitioned view live — including unsaved content.
  const tomlFile = isTomlPath(content?.path ?? selected ?? '')
  const parse = useMemo(() => parseSections(text), [text])
  const common = COMMON.map((id) => ({
    id,
    rows: parse.sections.find((s) => s.id === id)?.rows ?? [],
  }))
  const otherRows = parse.sections.find((s) => s.id === 'other')?.rows ?? []

  if (props.pins.length === 0) return <PinEmpty onImport={props.onImportPin} />

  return (
    <div className="config-layout">
      <ConfigRail
        pins={props.pins}
        selected={selected}
        onSelect={props.onSelectPin}
        onImport={props.onImportPin}
        onReload={props.onReloadPins}
        onDrop={props.onDropPin}
      />

      <div className="config-editor">
        {selectedPin?.kind === 'global' && props.settingsSlot}
        {!content ? (
          <div className="config-placeholder">{t('config_pick_file')}</div>
        ) : (
          <>
            <div className="config-meta">
              <span className="mono">{content.path}</span>
              <div className="spacer" />
              {tomlFile &&
                (parse.error || content.error ? (
                  <span className="badge err">{t('config_invalid')}</span>
                ) : (
                  <span className="badge ok">{t('config_valid')}</span>
                ))}
              {dirty && <span className="badge warn">{t('config_unsaved_badge')}</span>}
              <button className="btn tiny" onClick={() => setShowRaw((v) => !v)}>
                {showRaw ? t('config_hide_raw') : t('config_show_raw')}
              </button>
            </div>

            {(parse.error || content.error) && (
              <div className="config-error mono">{parse.error || content.error}</div>
            )}

            {tomlFile && !parse.error && (
              <div className="config-sections">
                {common.map((sec) => (
                  <div className={`config-sec ${sec.rows.length === 0 ? 'is-empty' : ''}`} key={sec.id}>
                    <div className="config-sec-head">
                      <span className="config-sec-title mono">{t(secTitleKey[sec.id])}</span>
                      <div className="spacer" />
                      <span className="config-sec-count">
                        {t('settings_count', { n: sec.rows.length })}
                      </span>
                    </div>
                    <Rows rows={sec.rows} />
                  </div>
                ))}
                {otherRows.length > 0 && (
                  <div className="config-sec config-sec-more">
                    <div className="config-sec-head">
                      <span className="config-sec-title mono">{t('config_sec_other')}</span>
                      <div className="spacer" />
                      <span className="config-sec-count">
                        {t('settings_count', { n: otherRows.length })}
                      </span>
                      <button className="btn tiny" onClick={() => setMoreOpen(true)}>
                        {t('config_more')}
                      </button>
                    </div>
                    <div className="config-sec-empty">{t('config_more_in')}</div>
                  </div>
                )}
              </div>
            )}

            {showRaw && (
              <>
                <textarea
                  className="config-textarea mono"
                  spellCheck={false}
                  value={text}
                  onChange={(e) => props.onEditorText?.(e.target.value)}
                  placeholder={t('config_empty_file')}
                />
                <div className="config-actions">
                  <span className="hint">
                    {parse.error
                      ? t('config_blocked_invalid')
                      : dirty
                        ? t('config_unsaved')
                        : t('config_saved_hint')}
                  </span>
                  <div className="spacer" />
                  <button
                    className="btn primary"
                    disabled={saving || !dirty || !!parse.error}
                    onClick={() => void props.onSave?.()}
                  >
                    {saving ? t('config_saving') : t('config_save')}
                  </button>
                  <button
                    className="btn"
                    disabled={saving || !props.onTrust}
                    onClick={() => props.onTrust?.(content.path)}
                    {...hover(`mise trust ${content.path}`, t('config_trust_tip'))}
                  >
                    {props.trusted?.has(content.path)
                      ? t('config_trusted')
                      : t('config_trust')}
                  </button>
                </div>
              </>
            )}
          </>
        )}
      </div>

      {moreOpen && (
        <div className="overlay" onClick={() => setMoreOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h2>{t('config_more_title')}</h2>
              <div className="spacer" />
              <button className="icon-btn" onClick={() => setMoreOpen(false)}>
                ✕
              </button>
            </div>
            <div className="modal-body">
              <p className="confirm-desc">{t('config_more_desc')}</p>
              {otherRows.map((r) => (
                <div className="config-sec-row" key={r.key}>
                  <span className="mono config-sec-key">{r.key}</span>
                  <span className="config-sec-val">{r.value}</span>
                  {r.note && (
                    <span className="mono config-sec-note">
                      {r.note}
                    </span>
                  )}
                </div>
              ))}
            </div>
            <div className="modal-foot">
              <button className="btn" onClick={() => setMoreOpen(false)}>
                {t('close')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
