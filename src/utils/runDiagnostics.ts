import type { Language, RunResult } from '../types'

export interface RunDiagnostic {
  title: string
  message: string
}

/** Standard error belongs in the bottom workbench; stdout stays with the test case. */
export function getRunDiagnostic(result: RunResult | null, _language: Language): RunDiagnostic | null {
  if (!result || !result.stderr.trim()) return null
  if (result.compileFailed) return { title: '编译问题', message: result.stderr }
  if (result.timedOut) return { title: '运行超时', message: result.stderr }
  if (result.success) return { title: '标准错误输出', message: result.stderr }
  return { title: '运行问题', message: result.stderr }
}

export function selectWorkbenchResult(results: RunResult[]): RunResult | null {
  return results.find((result) => result.compileFailed)
    ?? results.find((result) => !result.success && Boolean(result.stderr.trim()))
    ?? results.find((result) => Boolean(result.stderr.trim()))
    ?? results[results.length - 1]
    ?? null
}
