import type * as Monaco from 'monaco-editor'
import { invoke } from '@tauri-apps/api/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { formatCode } from './codeFormatter'
import { attachLiveCodeDiagnostics } from './liveCodeDiagnostics'

vi.mock('./codeFormatter', () => ({ formatCode: vi.fn() }))
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
afterEach(() => {
  vi.useRealTimers()
  vi.resetAllMocks()
})

it('checks the C++ buffer through Tauri and marks the reported line', async () => {
  vi.useFakeTimers()
  vi.mocked(invoke).mockResolvedValue([{ line: 2, column: 5, message: 'expected expression' }])
  const model = {
    isDisposed: () => false,
    getLanguageId: () => 'cpp',
    getValue: () => 'int main() {\n    ;\n}',
    getVersionId: () => 1,
    getLineCount: () => 3,
    getLineMaxColumn: () => 6,
  }
  const register = () => ({ dispose() {} })
  const editor = {
    getModel: () => model,
    onDidChangeModel: register,
    onDidChangeModelLanguage: register,
    onDidChangeModelContent: register,
  } as unknown as Monaco.editor.ICodeEditor
  const setModelMarkers = vi.fn()
  const monaco = { editor: { setModelMarkers }, MarkerSeverity: { Error: 8 } } as unknown as typeof Monaco
  const subscription = attachLiveCodeDiagnostics(monaco, editor, () => 'F:/solutions/main.cpp')
  try {
    await vi.runAllTimersAsync()
    expect(invoke).toHaveBeenCalledWith('check_cpp_syntax', {
      code: model.getValue(),
      path: 'F:/solutions/main.cpp',
    })
    expect(setModelMarkers).toHaveBeenLastCalledWith(model, 'acm-live-syntax', [
      expect.objectContaining({ source: 'C++', startLineNumber: 2, startColumn: 5, endColumn: 6 }),
    ])
    expect(formatCode).not.toHaveBeenCalled()
  } finally {
    subscription.dispose()
  }
})

describe('Python live diagnostics', () => {
  it('waits for typing to pause, marks a syntax error, and clears it on edit', async () => {
    vi.useFakeTimers()
    const source = '# 注释\nnow++\n'
    const errorOffset = new TextEncoder().encode('# 注释\nnow++').length
    vi.mocked(formatCode).mockRejectedValueOnce(`Expected an expression at byte range ${errorOffset}..${errorOffset + 1}`)
    const model = {
      isDisposed: () => false,
      getLanguageId: () => 'python',
      getValue: () => source,
      getVersionId: () => 1,
      getPositionAt: (offset: number) => {
        const lines = source.slice(0, offset).split('\n')
        return { lineNumber: lines.length, column: lines[lines.length - 1].length + 1 }
      },
    }
    const registration = vi.fn(() => ({ dispose: vi.fn() }))
    const contentChange = vi.fn<(listener: () => void) => { dispose: () => void }>(() => ({ dispose: vi.fn() }))
    const editor = {
      getModel: () => model,
      onDidChangeModel: registration,
      onDidChangeModelLanguage: registration,
      onDidChangeModelContent: contentChange,
    } as unknown as Monaco.editor.ICodeEditor
    const setModelMarkers = vi.fn()
    const monaco = { editor: { setModelMarkers }, MarkerSeverity: { Error: 8 } } as unknown as typeof Monaco
    const subscription = attachLiveCodeDiagnostics(monaco, editor, () => '')
    try {
      expect(formatCode).not.toHaveBeenCalled()
      await vi.runAllTimersAsync()
      expect(setModelMarkers).toHaveBeenLastCalledWith(model, 'acm-live-syntax', [
        expect.objectContaining({ startLineNumber: 2, startColumn: 6, message: '缺少有效的表达式' }),
      ])
      contentChange.mock.calls[0][0]()
      expect(setModelMarkers).toHaveBeenLastCalledWith(model, 'acm-live-syntax', [])

      let reject!: (reason: string) => void
      vi.mocked(formatCode).mockReturnValueOnce(new Promise((_, fail) => { reject = fail }))
      await vi.runAllTimersAsync()
      contentChange.mock.calls[0][0]()
      reject(`Expected an expression at byte range ${errorOffset}..${errorOffset + 1}`)
      await Promise.resolve()
      expect(setModelMarkers).toHaveBeenLastCalledWith(model, 'acm-live-syntax', [])
    } finally {
      subscription.dispose()
    }
  })
})
