import type { Language, LocalTestCase, RunResult } from '../types'

export interface RunDiagnostic {
  title: string
  message: string
}

/** Only compiler failures open and write to the terminal automatically. */
export function getRunDiagnostic(result: RunResult | null, _language: Language): RunDiagnostic | null {
  if (!result?.compileFailed || !result.stderr.trim()) return null
  return { title: '编译问题', message: result.stderr }
}

export function getTestCaseStatusText(test: Pick<LocalTestCase, 'status' | 'compileFailed' | 'timedOut'>): string {
  if (test.status === 'error') {
    if (test.compileFailed) return '编译失败'
    if (test.timedOut) return '运行超时'
  }
  return { idle: '未运行', running: '运行中…', passed: '通过', failed: '答案错误', completed: '已运行', error: '运行错误' }[test.status]
}

export function selectWorkbenchResult(results: RunResult[]): RunResult | null {
  return results.find((result) => result.compileFailed)
    ?? results.find((result) => !result.success && Boolean(result.stderr.trim()))
    ?? results.find((result) => Boolean(result.stderr.trim()))
    ?? results[results.length - 1]
    ?? null
}
