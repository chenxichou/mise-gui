import { useEffect, useState } from 'react'
import type { DoctorInfo } from '../types'
import { usePrefs } from '../prefs'
import { useTip } from '../cmdtip'

interface Props {
  reloadSignal: number
}

function asRecord(v: unknown): Record<string, unknown> | null {
  if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>
  return null
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : []
}

function displayValue(v: unknown): string {
  if (v === null || v === undefined) return '—'
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

function entryPath(e: unknown): string | null {
  if (typeof e === 'string') return e
  const r = asRecord(e)
  if (!r) return null
  for (const key of ['path', 'file', 'config']) {
    if (typeof r[key] === 'string') return r[key] as string
  }
  return null
}

export default function DoctorView({ reloadSignal }: Props) {
  const { t } = usePrefs()
  const [doctor, setDoctor] = useState<DoctorInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const api = typeof window !== 'undefined' ? window.mise : undefined
  const tip = useTip()

  useEffect(() => {
    if (!api) return
    let cancelled = false
    setLoading(true)
    setError(null)
    api
      .getDoctor()
      .then((d) => {
        if (!cancelled) setDoctor(d)
      })
      .catch((err) => {
        if (!cancelled) setError(String(err))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [api, reloadSignal])

  if (loading) {
    return (
      <div className="empty">
        <div className="spinner" />
      </div>
    )
  }
  if (error) {
    return (
      <div className="empty">
        <h2>{t('doctor_error_title')}</h2>
        <p className="mono">{error}</p>
      </div>
    )
  }
  if (!doctor) return null

  const warnings = asArray(doctor.warnings).map(String)
  const flags: Array<[string, boolean | undefined]> = [
    [t('doctor_activated'), doctor.activated],
    [t('doctor_shims_on_path'), doctor.shims_on_path],
  ]

  const configFiles = asArray(doctor.config_files)
  const envFiles = asArray(doctor.env_files)
  const dirs = asRecord(doctor.dirs)
  const shell = asRecord(doctor.shell)
  const envVars = asRecord(doctor.env_vars)
  const settings = asRecord(doctor.settings)
  const buildInfo = asRecord(doctor.build_info)

  return (
    <div className="doctor-scroll">
      {doctor.version && (
        <div className="doctor-head">
          <span className="doctor-version mono">
            mise {String(doctor.version).split(/\s+/)[0]}
          </span>
        </div>
      )}

      <div className="doctor-flags">
        {flags.map(([label, val]) =>
          val === undefined ? null : (
            <div key={label} className={`doctor-flag ${val ? 'ok' : 'warn'}`}>
              <span className={`status-dot ${val ? 'ok' : 'err'}`} />
              {label}
            </div>
          ),
        )}
      </div>

      {warnings.length > 0 && (
        <div className="doctor-card">
          <div className="doctor-card-title">{t('doctor_warnings')}</div>
          {warnings.map((w, i) => (
            <div key={i} className="doctor-warning mono">
              {w}
            </div>
          ))}
        </div>
      )}

      {configFiles.length > 0 && (
        <div className="doctor-card">
          <div className="doctor-card-title">{t('doctor_config_files')}</div>
          {configFiles.map((f, i) => {
            const path = entryPath(f) ?? displayValue(f)
            const r = asRecord(f)
            const trusted = r && typeof r.trusted === 'boolean' ? r.trusted : null
            return (
              <div key={i} className="doctor-entry">
                <span className="mono doctor-path" {...tip(path, true)}>
                  {path}
                </span>
                {trusted !== null && (
                  <span className={`chip ${trusted ? 'ok' : 'warn'}`}>
                    {t(trusted ? 'doctor_trusted' : 'doctor_untrusted')}
                  </span>
                )}
              </div>
            )
          })}
        </div>
      )}

      {envFiles.length > 0 && (
        <div className="doctor-card">
          <div className="doctor-card-title">{t('doctor_env_files')}</div>
          {envFiles.map((f, i) => (
            <div key={i} className="doctor-entry mono">
              {entryPath(f) ?? displayValue(f)}
            </div>
          ))}
        </div>
      )}

      <div className="doctor-grid">
        {shell && Object.keys(shell).length > 0 && (
          <div className="doctor-card">
            <div className="doctor-card-title">{t('doctor_shell')}</div>
            {Object.entries(shell).map(([k, v]) => (
              <div key={k} className="kv-row">
                <span className="kv-key">{k}</span>
                <span className="kv-val mono">{displayValue(v)}</span>
              </div>
            ))}
          </div>
        )}
        {dirs && Object.keys(dirs).length > 0 && (
          <div className="doctor-card">
            <div className="doctor-card-title">{t('doctor_dirs')}</div>
            {Object.entries(dirs).map(([k, v]) => (
              <div key={k} className="kv-row">
                <span className="kv-key">{k}</span>
                <span className="kv-val mono" {...tip(displayValue(v), true)}>
                  {displayValue(v)}
                </span>
              </div>
            ))}
          </div>
        )}
        {envVars && Object.keys(envVars).length > 0 && (
          <div className="doctor-card">
            <div className="doctor-card-title">{t('doctor_env_vars')}</div>
            {Object.entries(envVars).map(([k, v]) => (
              <div key={k} className="kv-row">
                <span className="kv-key mono">{k}</span>
                <span className="kv-val mono">{displayValue(v)}</span>
              </div>
            ))}
          </div>
        )}
        {settings && Object.keys(settings).length > 0 && (
          <div className="doctor-card">
            <div className="doctor-card-title">{t('doctor_settings')}</div>
            {Object.entries(settings).map(([k, v]) => (
              <div key={k} className="kv-row">
                <span className="kv-key mono">{k}</span>
                <span className="kv-val mono">{displayValue(v)}</span>
              </div>
            ))}
          </div>
        )}
        {buildInfo && Object.keys(buildInfo).length > 0 && (
          <div className="doctor-card">
            <div className="doctor-card-title">{t('doctor_build_info')}</div>
            {Object.entries(buildInfo).map(([k, v]) => (
              <div key={k} className="kv-row">
                <span className="kv-key">{k}</span>
                <span className="kv-val mono">{displayValue(v)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
