import type { Language } from '../types'

let clangFormatter: Promise<typeof import('@wasm-fmt/clang-format/vite')> | null = null
let pythonFormatter: Promise<typeof import('@wasm-fmt/ruff_fmt/vite')> | null = null

async function loadClangFormatter() {
  if (!clangFormatter) {
    clangFormatter = import('@wasm-fmt/clang-format/vite').then(async (module) => {
      await module.default()
      return module
    })
  }
  return clangFormatter
}

async function loadPythonFormatter() {
  if (!pythonFormatter) {
    pythonFormatter = import('@wasm-fmt/ruff_fmt/vite').then(async (module) => {
      await module.default()
      return module
    })
  }
  return pythonFormatter
}

export async function formatCode(source: string, language: Language): Promise<string> {
  if (!source.trim()) return source
  if (language === 'python') {
    const formatter = await loadPythonFormatter()
    return formatter.format(source, 'main.py', {
      indent_style: 'space',
      indent_width: 4,
      line_width: 100,
      quote_style: 'preserve',
      magic_trailing_comma: 'respect',
    })
  }
  const formatter = await loadClangFormatter()
  const filename = language === 'java' ? 'Main.java' : 'main.cpp'
  const style = ['BasedOnStyle: Google', 'IndentWidth: 4', 'ColumnLimit: 100', 'SortIncludes: Never'].join('\n')
  return formatter.format(source, filename, style)
}
