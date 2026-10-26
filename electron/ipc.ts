import type { ConnectionChange, MiseApi, RunEvent, RunResult, ToolConnection } from '../src/types'

export interface StreamArguments {
  'mise:install-mise': Record<string, never>
  'mise:install': { tool: string; version: string; opts: Parameters<MiseApi['install']>[2] }
  'mise:uninstall': { tool: string; version: string }
  'mise:unuse': { tool: string; version: string; configPath?: string }
  'mise:change-connection': ConnectionChange
  'mise:link': { tool: string; version: string; path: string; force: boolean }
  'mise:run-task': { task: string; opts: { configPath?: string } }
  'mise:trust-config': { path: string }
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected an argument object')
  return value as Record<string, unknown>
}

function text(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value.trim() || /[\0\r\n]/.test(value)) throw new Error(`Invalid ${name}`)
  return value
}

function operand(value: unknown, name: string) {
  const result = text(value, name)
  if (result.startsWith('-')) throw new Error(`Invalid ${name}`)
  return result
}

export function parseConnection(value: unknown): ToolConnection {
  const row = record(value)
  const connection: ToolConnection = {
    tool: operand(row.tool, 'tool'), version: operand(row.version, 'version'), configPath: text(row.configPath, 'config path'),
  }
  if (row.requestedVersion !== undefined) connection.requestedVersion = operand(row.requestedVersion, 'requested version')
  if (row.disabled !== undefined) {
    if (typeof row.disabled !== 'boolean') throw new Error('Invalid disabled flag')
    connection.disabled = row.disabled
  }
  if (row.otherRequests !== undefined) {
    if (!Array.isArray(row.otherRequests)) throw new Error('Invalid sibling requests')
    connection.otherRequests = row.otherRequests.map(value => operand(value, 'sibling request'))
  }
  return connection
}

export function parseStreamArguments<K extends keyof StreamArguments>(channel: K, value: unknown): StreamArguments[K] {
  const args = record(value)
  const path = (value: unknown) => value === undefined ? undefined : text(value, 'config path')
  let result: StreamArguments[keyof StreamArguments]
  switch (channel) {
    case 'mise:install-mise': result = {}; break
    case 'mise:install': {
      const opts = record(args.opts)
      if (typeof opts.pin !== 'boolean') throw new Error('Invalid pin flag')
      result = { tool: operand(args.tool, 'tool'), version: operand(args.version, 'version'), opts: { pin: opts.pin, configPath: path(opts.configPath) } }
      break
    }
    case 'mise:uninstall': case 'mise:unuse':
      result = { tool: operand(args.tool, 'tool'), version: operand(args.version, 'version'), configPath: path(args.configPath) }; break
    case 'mise:change-connection': {
      if (args.action !== undefined && args.action !== 'enable' && args.action !== 'disable') throw new Error('Invalid connection action')
      if (args.action && args.to) throw new Error('Connection action cannot also change destination')
      const to = args.to === undefined ? undefined : parseConnection(args.to)
      result = { from: parseConnection(args.from), action: args.action, to }; break
    }
    case 'mise:link':
      if (typeof args.force !== 'boolean') throw new Error('Invalid force flag')
      result = { tool: operand(args.tool, 'tool'), version: operand(args.version, 'version'), path: text(args.path, 'path'), force: args.force }; break
    case 'mise:run-task':
      result = { task: operand(args.task, 'task'), opts: { configPath: path(record(args.opts).configPath) } }; break
    case 'mise:trust-config': result = { path: text(args.path, 'config path') }; break
    default: throw new Error('Unknown streaming command')
  }
  // The switch constructs one validated shape for each key in this map.
  return result as StreamArguments[K]
}

export function trustedRendererUrl(candidate: string, entry: string): boolean {
  try {
    const actual = new URL(candidate), expected = new URL(entry)
    actual.hash = ''; actual.search = ''; expected.hash = ''; expected.search = ''
    return actual.href === expected.href
  } catch { return false }
}

// Convert every startup/validation/operation failure to the same protocol.
// A rejected command must still release the renderer's stream subscription.
export async function completeStream(
  run: (emit: (event: RunEvent) => void) => Promise<RunResult>, emit: (event: RunEvent) => void,
): Promise<RunResult> {
  let exited = false
  const forward = (event: RunEvent) => {
    if (exited) return
    if (event.type === 'exit') exited = true
    emit(event)
  }
  let result: RunResult
  try { result = await run(forward) }
  catch (error) {
    const stderr = error instanceof Error ? error.message : String(error)
    forward({ type: 'stderr', data: stderr })
    result = { ok: false, code: -1, stdout: '', stderr }
  }
  forward({ type: 'exit', data: '', code: result.code })
  return result
}
