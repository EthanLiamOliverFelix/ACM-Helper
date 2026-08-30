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

export async function withOjDiagnostic<T>(platform: string, operation: string, task: () => Promise<T>): Promise<T> {
  const started = performance.now()
  try {
    const result = await task()
    void invoke('record_oj_diagnostic', { platform, operation, status: 'success', durationMs: Math.round(performance.now() - started), message: '' })
    return result
  } catch (reason) {
    void invoke('record_oj_diagnostic', { platform, operation, status: 'error', durationMs: Math.round(performance.now() - started), message: messageOf(reason) })
    throw reason
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
