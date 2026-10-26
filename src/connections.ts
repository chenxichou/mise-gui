import type { ConnectionChange } from './types'
import { pathKey } from './paths.ts'

export function connectionCommands({ from, to, action }: ConnectionChange): string[] {
  if (from.disabled && !to && action !== 'enable') return []
  if (action === 'enable' || (from.disabled && to)) {
    const version = to && (to.tool !== from.tool || to.version !== from.version) ? to.version : from.requestedVersion ?? from.version
    return [`mise use ${to?.tool ?? from.tool}@${version} --path "${from.configPath}"`]
  }
  const remove = `mise unuse ${from.tool}@${from.requestedVersion ?? from.version} --no-prune --path "${from.configPath}"`
  if (!to) return [remove]
  const version = to.tool === from.tool && to.version === from.version ? from.requestedVersion ?? from.version : to.version
  const same = pathKey(from.configPath) === pathKey(to.configPath) && from.tool === to.tool
  const specs = [`${to.tool}@${version}`, ...(same ? from.otherRequests ?? [] : []).map(v => `${to.tool}@${v}`)]
  const use = `mise use ${[...new Set(specs)].join(' ')} --path "${to.configPath}"`
  return same ? [use] : [use, remove]
}
