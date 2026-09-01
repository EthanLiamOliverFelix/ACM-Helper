import { invoke } from '@tauri-apps/api/core'

export interface OjDiagnosticEntry {
  timestamp: number
  platform: string
  operation: string
  status: string
  durationMs: number
  message: string
}

function messageOf(reason: unknown) {
  if (typeof reason === 'string') return reason
  if (reason instanceof Error) return reason.message
  try { return JSON.stringify(reason) } catch { return String(reason) }
}

function operationDeadline(platform: string, operation: string) {
  if (operation === 'submit') return 270_000
  if (platform === 'qoj' && (operation === 'fetch-archive' || operation === 'fetch-contest' || operation === 'fetch-statement')) return 165_000
  if (operation === 'fetch-catalog') return 100_000
  if (operation === 'inspect-account') return 45_000
  return 70_000
}

/**
 * Every OJ request has an independent UI deadline. Rust/WebView work also has
 * its own backend timeout; this outer guard ensures one unhealthy website can
 * never keep another platform's controls in a waiting state.
 */
export async function withOjDiagnostic<T>(platform: string, operation: string, task: () => Promise<T>): Promise<T> {
  const started = performance.now()
  let timer: number | undefined
  try {
    const deadline = operationDeadline(platform, operation)
    const result = await Promise.race([
      task(),
      new Promise<never>((_, reject) => {
        timer = window.setTimeout(() => reject(new Error(`${platform} ${operation} 超时，已解除界面等待；其他网络功能仍可继续使用`)), deadline)
      }),
    ])
    void invoke('record_oj_diagnostic', { platform, operation, status: 'success', durationMs: Math.round(performance.now() - started), message: '' })
    return result
  } catch (reason) {
    void invoke('record_oj_diagnostic', { platform, operation, status: 'error', durationMs: Math.round(performance.now() - started), message: messageOf(reason) })
    throw reason
  } finally {
    if (timer !== undefined) window.clearTimeout(timer)
  }
}

export function getOjDiagnostics(limit = 100) {
  return invoke<OjDiagnosticEntry[]>('get_oj_diagnostics', { limit })
}

export function exportOjDiagnostics() {
  return invoke<string | null>('export_oj_diagnostics')
}

export function clearOjDiagnostics() {
  return invoke<void>('clear_oj_diagnostics')
}
