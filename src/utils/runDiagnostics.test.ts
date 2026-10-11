import { describe, expect, it } from 'vitest'
import type { RunResult } from '../types'
import { getRunDiagnostic, getTestCaseStatusText, selectWorkbenchResult } from './runDiagnostics'

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
  it('does not print runtime errors or timeouts to the terminal', () => {
    expect(getRunDiagnostic(result({ stderr: 'Traceback' }), 'python')).toBeNull()
    expect(getRunDiagnostic(result({ stderr: 'Exception in thread main' }), 'java')).toBeNull()
    expect(getRunDiagnostic(result({ timedOut: true, stderr: '运行超时' }), 'cpp')).toBeNull()
  })

  it('prints compiler errors for each supported language', () => {
    expect(getRunDiagnostic(result({ compileFailed: true }), 'cpp')).toEqual({ title: '编译问题', message: 'error' })
    expect(getRunDiagnostic(result({ compileFailed: true }), 'python')?.title).toBe('编译问题')
    expect(getRunDiagnostic(result({ compileFailed: true }), 'java')?.title).toBe('编译问题')
  })

  it('does not print successful runs even when they have stderr', () => {
    const warning = result({ success: true, stderr: 'warning', exitCode: 0 })
    expect(getRunDiagnostic(warning, 'cpp')).toBeNull()
    expect(getRunDiagnostic(result({ success: true, stderr: '', exitCode: 0 }), 'cpp')).toBeNull()
    expect(selectWorkbenchResult([warning, result({ success: true, stderr: '', exitCode: 0 })])).toBe(warning)
  })

  it('does not lose an earlier error when a later test succeeds', () => {
    const failure = result({ stderr: 'Traceback' })
    const success = result({ success: true, stderr: '', exitCode: 0 })
    expect(selectWorkbenchResult([failure, success])).toBe(failure)
    const compileError = result({ compileFailed: true })
    expect(getRunDiagnostic(selectWorkbenchResult([compileError, success]), 'cpp')?.message).toBe('error')
  })

  it('shows timeout and other failure reasons on the test case instead', () => {
    expect(getTestCaseStatusText({ status: 'error', timedOut: true })).toBe('运行超时')
    expect(getTestCaseStatusText({ status: 'error', compileFailed: true })).toBe('编译失败')
    expect(getTestCaseStatusText({ status: 'error' })).toBe('运行错误')
    expect(getTestCaseStatusText({ status: 'failed' })).toBe('答案错误')
    expect(getTestCaseStatusText({ status: 'running', timedOut: true })).toBe('运行中…')
  })
})
