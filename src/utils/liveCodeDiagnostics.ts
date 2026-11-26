import type * as Monaco from 'monaco-editor'
import { invoke } from '@tauri-apps/api/core'
import { formatCode } from './codeFormatter'
import { getPythonSyntaxDiagnostic } from './pythonSyntaxDiagnostic'

const OWNER = 'acm-live-syntax'

interface CppDiagnostic { line: number; column: number; message: string }

async function checkSyntax(model: Monaco.editor.ITextModel, language: 'cpp' | 'python', path: string) {
  const source = model.getValue()
  if (language === 'cpp') {
    const diagnostics = await invoke<CppDiagnostic[]>('check_cpp_syntax', { code: source, path: path || null })
    return diagnostics.flatMap(({ line, column, message }) => {
      if (line < 1 || line > model.getLineCount()) return []
      const maxColumn = model.getLineMaxColumn(line)
      const startColumn = Math.min(Math.max(1, column), Math.max(1, maxColumn - 1))
      return [{ source: 'C++', message, startLineNumber: line, startColumn, endLineNumber: line, endColumn: Math.min(startColumn + 1, maxColumn) }]
    })
  }

  try {
    // Ruff parses before formatting. Discard the formatted text.
    await formatCode(source, 'python')
    return []
  } catch (error) {
    const diagnostic = getPythonSyntaxDiagnostic(error, source)
    if (!diagnostic) return []
    const atEnd = diagnostic.startOffset === source.length
    const endOffset = atEnd ? source.trimEnd().length : Math.max(diagnostic.endOffset, diagnostic.startOffset + 1)
    const start = model.getPositionAt(atEnd ? Math.max(0, endOffset - 1) : diagnostic.startOffset)
    const end = model.getPositionAt(endOffset)
    return [{
      source: 'Python',
      message: diagnostic.message,
      startLineNumber: start.lineNumber,
      startColumn: start.column,
      endLineNumber: end.lineNumber,
      endColumn: end.column,
    }]
  }
}

export function attachLiveCodeDiagnostics(
  monaco: typeof Monaco,
  editor: Monaco.editor.ICodeEditor,
  getPath: () => string,
): Monaco.IDisposable {
  let markedModel: Monaco.editor.ITextModel | null = null
  let timer: ReturnType<typeof setTimeout> | undefined
  let revision = 0
  let running = Promise.resolve()

  function clear() {
    revision++
    clearTimeout(timer)
    if (markedModel && !markedModel.isDisposed()) {
      monaco.editor.setModelMarkers(markedModel, OWNER, [])
    }
    markedModel = null
  }

  function schedule() {
    clear()
    const target = editor.getModel()
    const language = target?.getLanguageId()
    if (!target || (language !== 'python' && language !== 'cpp')) return

    const request = revision
    timer = setTimeout(() => {
      running = running.then(async () => {
        if (request !== revision || target.isDisposed()) return
        const version = target.getVersionId()
        const diagnostics = await checkSyntax(target, language, getPath())
        if (request !== revision || target.isDisposed() || target.getVersionId() !== version || !diagnostics.length) return
        markedModel = target
        monaco.editor.setModelMarkers(target, OWNER, diagnostics.map(item => ({
          ...item, severity: monaco.MarkerSeverity.Error,
        })))
      }).catch(() => {
        // A missing compiler or a timeout is not an error in the source file.
      })
    }, language === 'cpp' ? 1000 : 650)
  }

  const listeners = [
    editor.onDidChangeModel(schedule),
    editor.onDidChangeModelLanguage(schedule),
    editor.onDidChangeModelContent(schedule),
  ]
  schedule()
  return {
    dispose() {
      clear()
      for (const listener of listeners) listener.dispose()
    },
  }
}
