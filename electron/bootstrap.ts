import { runStream } from './mise.ts'
import { windowsInstallerScript } from './installer-script.ts'
import type { MiseInstaller, RunEvent, RunResult } from '../src/types'

// Fixed official installers only: the renderer never supplies executable code.
export function installerPlan(platform: NodeJS.Platform = process.platform) {
  if (platform === 'win32') {
    return {
      supported: true, method: 'powershell' as const,
      command: 'powershell.exe -NoProfile -NonInteractive -Command "irm https://mise.run/powershell | iex"',
      binary: 'powershell.exe',
      args: ['-NoProfile', '-NonInteractive', '-Command',
        windowsInstallerScript],
    }
  }
  if (platform === 'darwin' || platform === 'linux') {
    return {
      supported: true, method: 'shell' as const,
      command: 'curl -fsSL https://mise.run | sh',
      binary: 'sh',
      // Download separately so a failed curl cannot look like a successful sh.
      args: ['-c', 'set -eu; installer=$(mktemp); trap \'rm -f "$installer"\' EXIT; curl -fsSL --connect-timeout 15 --max-time 60 https://mise.run -o "$installer"; sh "$installer"'],
    }
  }
  return { supported: false, method: 'unavailable' as const, command: '', binary: '', args: [] }
}

export function getInstaller(): MiseInstaller {
  const { supported, method, command } = installerPlan()
  return { supported, method, command }
}

let installing = false
export async function installMise(emit: (event: RunEvent) => void): Promise<RunResult> {
  if (installing) return { ok: false, code: -1, stdout: '', stderr: 'Installation already running' }
  const plan = installerPlan()
  if (!plan.supported) return { ok: false, code: -1, stdout: '', stderr: 'Unsupported platform' }
  installing = true
  try {
    // Two official archive hosts can each take up to eight minutes, with a
    // 30s low-speed cutoff. Leave room for metadata, verification and extraction.
    return await runStream(plan.binary, plan.args, undefined, emit, 20 * 60_000)
  } catch (error) {
    const stderr = error instanceof Error ? error.message : String(error)
    emit({ type: 'stderr', data: stderr })
    emit({ type: 'exit', data: '', code: -1 })
    return { ok: false, code: -1, stdout: '', stderr }
  } finally {
    installing = false
  }
}
