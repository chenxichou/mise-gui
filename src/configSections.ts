import * as TOML from 'smol-toml'

export type SectionId = 'tools' | 'env' | 'settings' | 'tasks' | 'other'

export interface ConfigRow {
  key: string
  value: string
  note?: string
}

export interface ConfigSection {
  id: SectionId
  rows: ConfigRow[]
}

export interface SectionParse {
  ok: boolean
  error?: string
  sections: ConfigSection[]
}

// mise treats any unknown top-level key in mise.toml as a tool request, so these
// are the only names that are not tool versions.
const TABLES = new Set(['tools', 'env', 'settings', 'tasks', 'alias', 'plugins', 'watched_files'])

function truncate(s: string, max = 90): string {
  const one = s.replace(/\s+/g, ' ').trim()
  return one.length > max ? `${one.slice(0, max - 1)}…` : one
}

function value(v: unknown): string {
  if (Array.isArray(v)) return truncate(v.map((x) => value(x)).join(', '))
  if (typeof v === 'string') return truncate(v)
  if (v === null || v === undefined) return '—'
  if (typeof v === 'object') {
    const entries = Object.entries(v as Record<string, unknown>)
    return truncate(entries.map(([k, x]) => `${k}=${value(x)}`).join(' · '))
  }
  return String(v)
}

function isPlainTable(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function tableRows(v: Record<string, unknown>): ConfigRow[] {
  return Object.entries(v).map(([k, x]) => {
    if (!isPlainTable(x)) return { key: k, value: value(x) }
    // [tasks.build] / [alias.node] style sub-tables: show the interesting field
    // as the value and the rest as a trailing note.
    const run = typeof x.run === 'string' ? x.run : undefined
    const rest = Object.entries(x).filter(([fk]) => fk !== 'run')
    return {
      key: k,
      value: run !== undefined ? truncate(run) : value(x),
      note: rest.length ? truncate(rest.map(([fk, fv]) => `${fk}=${value(fv)}`).join(' · ')) : undefined,
    }
  })
}

export function parseSections(text: string): SectionParse {
  if (!text.trim()) {
    return { ok: true, sections: [{ id: 'tools', rows: [] }, { id: 'env', rows: [] }, { id: 'settings', rows: [] }, { id: 'tasks', rows: [] }] }
  }
  let parsed: Record<string, unknown>
  try {
    parsed = TOML.parse(text) as Record<string, unknown>
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err), sections: [] }
  }

  const tools: ConfigRow[] = []
  const extra: ConfigRow[] = []
  for (const [k, v] of Object.entries(parsed)) {
    if (k === 'tools' && isPlainTable(v)) {
      tools.push(...tableRows(v))
      continue
    }
    if (TABLES.has(k)) {
      if (k !== 'env' && k !== 'settings' && k !== 'tasks') extra.push({ key: k, value: value(v) })
      continue
    }
    // Bare top-level keys are tool versions in mise's own syntax.
    tools.push({ key: k, value: value(v) })
  }

  const env = isPlainTable(parsed.env) ? tableRows(parsed.env) : []
  const settings = isPlainTable(parsed.settings) ? tableRows(parsed.settings) : []
  const tasks = isPlainTable(parsed.tasks) ? tableRows(parsed.tasks) : []

  const out: ConfigSection[] = [
    { id: 'tools', rows: tools },
    { id: 'env', rows: env },
    { id: 'settings', rows: settings },
    { id: 'tasks', rows: tasks },
  ]
  if (extra.length) out.push({ id: 'other', rows: extra })
  return { ok: true, sections: out }
}
