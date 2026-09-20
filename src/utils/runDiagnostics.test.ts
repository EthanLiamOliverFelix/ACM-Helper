import { describe, expect, it } from 'vitest'
import type { RunResult } from '../types'
import { getRunDiagnostic, selectWorkbenchResult } from './runDiagnostics'

function result(overrides: Partial<RunResult> = {}): RunResult {
  return {
    success: false,
    stdout: '',
    stderr: 'error',
    compileFailed: false,
    exitCode: 1,
    durationMs: 10,
    timedOut: false,
    ...overrides,
  }
}

describe('run diagnostics workbench', () => {
  it('shows Python and Java runtime errors in the workbench', () => {
    expect(getRunDiagnostic(result({ stderr: 'Traceback' }), 'python')).toEqual({ title: '运行问题', message: 'Traceback' })
    expect(getRunDiagnostic(result({ stderr: 'Exception in thread main' }), 'java')).toEqual({ title: '运行问题', message: 'Exception in thread main' })
  })

  it('keeps compile errors and timeouts distinguishable', () => {
    expect(getRunDiagnostic(result({ compileFailed: true }), 'java')?.title).toBe('编译问题')
    expect(getRunDiagnostic(result({ timedOut: true, stderr: '运行超时' }), 'python')?.title).toBe('运行超时')
  })

  it('shows stderr from successful runs in the bottom workbench', () => {
    const warning = result({ success: true, stderr: 'warning', exitCode: 0 })
    expect(getRunDiagnostic(warning, 'cpp')).toEqual({ title: '标准错误输出', message: 'warning' })
    expect(selectWorkbenchResult([warning, result({ success: true, stderr: '', exitCode: 0 })])).toBe(warning)
  })

  it('does not lose an earlier error when a later test succeeds', () => {
    const failure = result({ stderr: 'Traceback' })
    const success = result({ success: true, stderr: '', exitCode: 0 })
    expect(selectWorkbenchResult([failure, success])).toBe(failure)
  })
})
