import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import type { InstalledTool, ToolConnection } from '../src/types'
import { pathKey } from '../src/paths.ts'
import { parseConnection } from './ipc.ts'

let storePath = ''
export function setDisabledStore(path: string) { storePath = path }
export function readDisabled(): ToolConnection[] {
  if (!storePath || !existsSync(storePath)) return []
  const rows: unknown = JSON.parse(readFileSync(storePath, 'utf8'))
  if (!Array.isArray(rows)) throw new Error('Invalid disabled connection store')
  return rows.map(parseConnection)
}
export function writeDisabled(rows: ToolConnection[]) {
  if (!storePath) throw new Error('Disabled connection store is not ready')
  writeFileSync(`${storePath}.tmp`, JSON.stringify(rows), 'utf8')
  renameSync(`${storePath}.tmp`, storePath)
}
export const sameDisabled = (a: ToolConnection, b: ToolConnection) => a.tool === b.tool && a.version === b.version && pathKey(a.configPath) === pathKey(b.configPath)

export function withDisabled(tools: InstalledTool[], managed: string[]): InstalledTool[] {
  const next = structuredClone(tools)
  let saved: ToolConnection[]
  try { saved = readDisabled() }
  catch (error) {
    // Never overwrite damaged state. Keep real mise listings usable; writes
    // still use the strict reader and report the error before changing config.
    console.warn('Cannot read disabled connections:', error)
    return next
  }
  for (const row of saved) {
    if (!managed.some(path => pathKey(path) === pathKey(row.configPath))) continue
    let tool = next.find(tool => tool.name === row.tool)
    if (!tool) { tool = { name: row.tool, versions: [] }; next.push(tool) }
    if (tool.versions.some(v => v.sources.some(s => pathKey(s.path) === pathKey(row.configPath) &&
      (s.requestedVersion ?? v.requestedVersion ?? v.version) === (row.requestedVersion ?? row.version)))) continue
    let version = tool.versions.find(v => v.version === row.version)
    if (!version) { version = { version: row.version, installed: false, active: false, sources: [] }; tool.versions.push(version) }
    version.disabledSources = [...(version.disabledSources ?? []), { path: row.configPath, requestedVersion: row.requestedVersion ?? row.version }]
  }
  return next
}
