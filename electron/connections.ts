import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import * as mise from './mise.ts'
import { invalidate, resolvePinForWrite } from './pins.ts'
import type { ConnectionChange, RunEvent, RunResult } from '../src/types'
import { readDisabled, writeDisabled, sameDisabled } from './disabled.ts'

const dependencies = { resolvePinForWrite, listInstalled: mise.listInstalled, install: mise.install, unuse: mise.unuse }
const key = (path: string) => process.platform === 'win32' ? resolve(path).toLowerCase() : resolve(path)
const snapshot = (path: string): Buffer | null => existsSync(path) ? readFileSync(path) : null
const equal = (a: Buffer | null, b: Buffer | null) => a === null ? b === null : b !== null && a.equals(b)
let changing = false

// A move creates its new request first. If removing the old request fails, only
// restore the destination when it still contains exactly our own write.
export async function changeConnection(
  change: ConnectionChange, emit: (event: RunEvent) => void, deps = dependencies,
): Promise<RunResult> {
  const fail = (message: string): RunResult => {
    emit({ type: 'stderr', data: message })
    return { ok: false, code: -1, stdout: '', stderr: message }
  }
  if (changing) return fail('Another connection change is already running')
  changing = true
  let undo: (() => string) | undefined
  // Child commands have separate exits; the IPC wrapper emits one final exit.
  const forward = (event: RunEvent) => { if (event.type !== 'exit') emit(event) }
  try {
    if (!change?.from?.tool || !change.from.version || !change.from.configPath ||
      (change.to && (!change.to.tool || !change.to.version || !change.to.configPath))) return fail('Invalid connection')
    const from = await deps.resolvePinForWrite(change.from.configPath)
    const to = change.to ? await deps.resolvePinForWrite(change.to.configPath) : null
    if (!from?.exists || (change.to && !to)) return fail('Selected config is missing or no longer managed')
    const beforeFrom = snapshot(from.path)
    const beforeTo = to ? snapshot(to.path) : null
    const tools = await deps.listInstalled(from.dir)
    const tool = tools.find(t => t.name === change.from.tool)
    const version = tool?.versions.find(v => v.version === change.from.version)
    const source = version?.sources.find(s => key(s.path) === key(from.path))
    const requested = source?.requestedVersion ?? version?.requestedVersion ?? change.from.version
    const otherRequests = [...new Set(tool?.versions.filter(v => v !== version).flatMap(v => {
      const s = v.sources.find(s => key(s.path) === key(from.path))
      return s ? [s.requestedVersion ?? v.requestedVersion ?? v.version] : []
    }) ?? [])]
    if (change.from.disabled) {
      const saved = readDisabled(), remembered = saved.find(row => sameDisabled(row, change.from))
      if (!remembered) return fail('Disabled connection changed. Refresh and try again.')
      if ((change.from.requestedVersion && change.from.requestedVersion !== (remembered.requestedVersion ?? remembered.version)) ||
        !equal(snapshot(from.path), beforeFrom)) return fail('Connection changed on disk. Refresh and try again.')
      if (change.action === 'enable' || change.to) {
        if (change.to && key(change.to.configPath) !== key(from.path)) return fail('Enable the connection in its original config first')
        const name = change.to?.tool ?? remembered.tool
        const requested = change.to && (change.to.tool !== remembered.tool || change.to.version !== remembered.version)
          ? change.to.version : remembered.requestedVersion ?? remembered.version
        const active = tools.find(t => t.name === name)?.versions.flatMap(v => v.sources.filter(s => key(s.path) === key(from.path))
          .map(s => s.requestedVersion ?? v.requestedVersion ?? v.version)) ?? []
        if (active.includes(requested)) return fail('This request is already enabled. Refresh the graph.')
        const result = await deps.install(name, requested, { pin: true, configPath: from.path, cwd: from.dir, additionalVersions: [...new Set(active)] }, forward)
        if (!result.ok) return result
      } else if (change.action) return fail('Invalid disabled connection action')
      writeDisabled(saved.filter(row => !sameDisabled(row, remembered)))
      return { ok: true, code: 0, stdout: '', stderr: '' }
    }
    if (!source || (change.from.requestedVersion && requested !== change.from.requestedVersion) ||
      JSON.stringify([...otherRequests].sort()) !== JSON.stringify([...(change.from.otherRequests ?? [])].sort()) ||
      !equal(snapshot(from.path), beforeFrom) || (to && !equal(snapshot(to.path), beforeTo))) {
      return fail('Connection changed on disk. Refresh the tool graph and try again.')
    }
    if (change.action === 'disable') {
      const saved = readDisabled()
      writeDisabled([...saved.filter(row => !sameDisabled(row, change.from)), { ...change.from, requestedVersion: requested, disabled: true }])
      const result = await deps.unuse(change.from.tool, requested, from.dir, forward, from.path)
      if (!result.ok) writeDisabled(saved)
      return result
    }
    if (change.action) return fail('Invalid connection action')
    const sameFile = !!to && key(from.path) === key(to.path)
    const sameTool = change.to?.tool === change.from.tool
    if (sameFile && sameTool && change.to?.version === change.from.version) return fail('Connection is unchanged')

    if (change.to && to) {
      const nextVersion = sameTool && change.to.version === change.from.version ? requested : change.to.version
      const result = await deps.install(change.to.tool, nextVersion, {
        pin: true, configPath: to.path, cwd: existsSync(to.dir) ? to.dir : undefined,
        additionalVersions: sameFile && sameTool ? otherRequests : undefined,
      }, forward)
      if (!result.ok) return result
      const written = snapshot(to.path)
      undo = () => {
        if (!equal(snapshot(to.path), written)) return 'Destination changed externally; it was kept. Refresh the graph.'
        if (beforeTo === null) { if (existsSync(to.path)) unlinkSync(to.path) }
        else writeFileSync(to.path, beforeTo)
        return 'Destination was restored; the original connection was kept.'
      }
      // A same-tool version switch already replaced its request in this file.
      if (sameFile && sameTool) return result
      if (!sameFile && !equal(snapshot(from.path), beforeFrom)) return fail(`Original config changed on disk. ${undo()}`)
    }
    const result = await deps.unuse(change.from.tool, requested, from.dir, forward, from.path)
    if (!result.ok && undo) return fail(`${result.stderr.trim()}\n${undo()}`)
    return result
  } catch (error) {
    let message = error instanceof Error ? error.message : String(error)
    if (undo) { try { message += `\n${undo()}` } catch (rollbackError) { message += `\nRestore failed: ${String(rollbackError)}` } }
    return fail(message)
  } finally {
    changing = false
    invalidate()
  }
}
