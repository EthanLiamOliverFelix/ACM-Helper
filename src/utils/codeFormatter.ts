import type { Language } from '../types'
import initClangFormatter, { format as formatWithClang } from '@wasm-fmt/clang-format/vite'
import initPythonFormatter, { format as formatWithRuff } from '@wasm-fmt/ruff_fmt/vite'

let clangInitialization: Promise<unknown> | null = null
let pythonInitialization: Promise<unknown> | null = null

async function initializeClangFormatter() {
  if (!clangInitialization) {
    clangInitialization = initClangFormatter().catch((error) => {
      // A rejected Promise would otherwise poison formatting for the rest of
      // the process. Clear it so a transient WebView/Vite request can retry.
      clangInitialization = null
      throw error
    })
  }
  await clangInitialization
}

async function initializePythonFormatter() {
  if (!pythonInitialization) {
    pythonInitialization = initPythonFormatter().catch((error) => {
      pythonInitialization = null
      throw error
    })
  }
  await pythonInitialization
}

export async function formatCode(source: string, language: Language): Promise<string> {
  if (!source.trim()) return source
  if (language === 'python') {
    await initializePythonFormatter()
    return formatWithRuff(source, 'main.py', {
      indent_style: 'space',
      indent_width: 4,
      line_width: 100,
      quote_style: 'preserve',
      magic_trailing_comma: 'respect',
    })
  }
  await initializeClangFormatter()
  const filename = language === 'java' ? 'Main.java' : 'main.cpp'
  const style = ['BasedOnStyle: Google', 'IndentWidth: 4', 'ColumnLimit: 100', 'SortIncludes: Never'].join('\n')
  return formatWithClang(source, filename, style)
}
