import type {
  InstalledTool,
  InstalledVersion,
  MiseTask,
  RegistryTool,
  ToolSource,
} from '../src/types'

// Both shapes are measured on 2026.10.12: `mise ls --json` gives
// source: { type, path } for the file the current chain loads (and no source at
// all when nothing requests the version), while `--all-sources` gives
// sources: [{ type, path, requested_version }] per version.
function toSource(raw: unknown): ToolSource | null {
  if (typeof raw === 'string') return { path: raw }
  if (!raw || typeof raw !== 'object') return null
  const rec = raw as Record<string, unknown>
  if (typeof rec.path !== 'string' || !rec.path) return null
  return {
    path: rec.path,
    requestedVersion: typeof rec.requested_version === 'string' ? rec.requested_version : undefined,
    kind: typeof rec.type === 'string' ? rec.type : undefined,
  }
}

function dedupeSources(list: ToolSource[]): ToolSource[] {
  // One version row mentions a file at most once: the same path can arrive as
  // `source` and again inside `sources`, and the richer copy carries the request
  // as written. Paths are compared resolved-and-folded because mise prints both
  // separators on Windows.
  const byPath = new Map<string, ToolSource>()
  for (const s of list) {
    const key = s.path.toLowerCase().replace(/\//g, '\\')
    const seen = byPath.get(key)
    if (seen) {
      byPath.set(key, {
        path: seen.path,
        requestedVersion: seen.requestedVersion ?? s.requestedVersion,
        kind: seen.kind ?? s.kind,
      })
    } else {
      byPath.set(key, s)
    }
  }
  return [...byPath.values()]
}

function normalizeVersion(raw: Record<string, unknown>): InstalledVersion {
  const str = (k: string): string | undefined => {
    const v = raw[k]
    return typeof v === 'string' ? v : undefined
  }
  const single = toSource(raw.source)
  const many = Array.isArray(raw.sources) ? raw.sources.map(toSource) : []
  return {
    version: str('version') ?? '',
    requestedVersion: str('requested_version'),
    sources: dedupeSources([single, ...many].filter((s): s is ToolSource => !!s)),
    installed: raw.installed === true,
    active: raw.active === true,
    installPath: str('install_path'),
  }
}

// `mise ls --json` only names the file the current directory chain loads, and
// `--all-sources` (measured) leaves out every version nobody requests. The tool
// page needs the union: unrequested downloads from the first and requests in
// other projects (including versions not installed yet) from the second.
function byTool(parsed: unknown): Map<string, Map<string, InstalledVersion>> {
  const out = new Map<string, Map<string, InstalledVersion>>()
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return out
  for (const [name, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (!Array.isArray(value)) continue
    const versions = new Map<string, InstalledVersion>()
    for (const raw of value) {
      if (!raw || typeof raw !== 'object') continue
      const v = normalizeVersion(raw as Record<string, unknown>)
      if (v.version) versions.set(v.version, v)
    }
    out.set(name, versions)
  }
  return out
}

// `mise ls --json` returns an object keyed by tool name, each value an array
// of version records.
export function parseLsJson(parsed: unknown, withSources?: unknown): InstalledTool[] {
  const tools: InstalledTool[] = []
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return tools
  const merged = byTool(parsed)
  const extra = byTool(withSources)
  for (const [name, versions] of extra) {
    const target = merged.get(name) ?? new Map<string, InstalledVersion>()
    for (const [version, link] of versions) {
      const scoped = target.get(version)
      target.set(version, scoped ? {
        ...scoped,
        requestedVersion: scoped.requestedVersion ?? link.requestedVersion,
        sources: dedupeSources([...scoped.sources, ...link.sources]),
      } : { ...link, active: false })
    }
    merged.set(name, target)
  }
  for (const [name, versions] of merged) tools.push({ name, versions: [...versions.values()] })
  tools.sort((a, b) => a.name.localeCompare(b.name))
  return tools
}

// `mise registry --json` returns an array of entries:
//   { short, backends: [..], bins: [..], description, aliases: [..] }
// Older/alternate builds may emit a map keyed by tool name; both are handled.
export function parseRegistryJson(parsed: unknown): RegistryTool[] | null {
  const toTool = (name: string, meta: Record<string, unknown>): RegistryTool => {
    const backends = Array.isArray(meta.backends)
      ? meta.backends.filter((b): b is string => typeof b === 'string')
      : undefined
    return {
      name,
      description: typeof meta.description === 'string' ? meta.description : undefined,
      backends,
      backend: backends?.[0] ?? (typeof meta.backend === 'string' ? meta.backend : undefined),
      bins: Array.isArray(meta.bins) ? meta.bins.filter((b): b is string => typeof b === 'string') : undefined,
      aliases: Array.isArray(meta.aliases) ? meta.aliases.filter((a): a is string => typeof a === 'string') : undefined,
    }
  }

  let tools: RegistryTool[] = []
  if (Array.isArray(parsed)) {
    for (const item of parsed) {
      if (item && typeof item === 'object') {
        const meta = item as Record<string, unknown>
        const name = typeof meta.short === 'string' ? meta.short : typeof meta.name === 'string' ? meta.name : undefined
        if (name) tools.push(toTool(name, meta))
      }
    }
  } else if (parsed && typeof parsed === 'object') {
    tools = Object.entries(parsed as Record<string, Record<string, unknown>>).map(([name, meta]) =>
      toTool(name, meta ?? {}),
    )
  }

  if (tools.length === 0) return null
  tools.sort((a, b) => a.name.localeCompare(b.name))
  return tools
}

// Fallback for `mise registry` plain-text output: "tool<whitespace>backend".
export function parseRegistryText(text: string): RegistryTool[] {
  const tools: RegistryTool[] = []
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const lower = trimmed.toLowerCase()
    if (lower.startsWith('tool') || lower.startsWith('name')) continue
    const [name, backend] = trimmed.split(/\s+/)
    if (name) tools.push({ name, backend })
  }
  tools.sort((a, b) => a.name.localeCompare(b.name))
  return tools
}

// `mise ls-remote <tool>` prints one version per line (ascending).
export function parseRemote(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
}

function strArray(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined
  const out = v.filter((x): x is string => typeof x === 'string')
  return out.length ? out : undefined
}

function normalizeTask(raw: Record<string, unknown>): MiseTask | null {
  const str = (k: string): string | undefined =>
    typeof raw[k] === 'string' ? (raw[k] as string) : undefined
  const name = str('name')
  if (!name) return null
  return {
    name,
    description: str('description'),
    source: str('source'),
    aliases: strArray(raw.aliases),
    depends: strArray(raw.depends),
    hide: raw.hide === true,
  }
}

// `mise tasks ls --json` returns an array of task objects. Some versions may
// return a map keyed by task name, so both shapes are tolerated.
export function parseTasksJson(parsed: unknown): MiseTask[] {
  const tasks: MiseTask[] = []

  const push = (raw: unknown) => {
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      const t = normalizeTask(raw as Record<string, unknown>)
      if (t) tasks.push(t)
    }
  }

  if (Array.isArray(parsed)) {
    for (const item of parsed) push(item)
  } else if (parsed && typeof parsed === 'object') {
    for (const [name, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        const obj = { name, ...(value as Record<string, unknown>) }
        push(obj)
      }
    }
  }

  tasks.sort((a, b) => a.name.localeCompare(b.name))
  return tasks.filter((t) => !t.hide)
}
