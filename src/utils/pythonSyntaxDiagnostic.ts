export function getPythonSyntaxDiagnostic(error: unknown, source: string) {
  const message = error instanceof Error ? error.message : String(error)
  const match = /^(.*?) at byte range (\d+)\.\.(\d+)$/s.exec(message)
  if (!match) return null

  // Ruff reports UTF-8 byte offsets. Monaco uses UTF-16 positions.
  const bytes = new TextEncoder().encode(source)
  const decoder = new TextDecoder('utf-8', { ignoreBOM: true })
  const before = decoder.decode(bytes.subarray(0, Number(match[2])))
  const through = decoder.decode(bytes.subarray(0, Number(match[3])))
  const reason = match[1] === 'Expected an expression'
    ? '缺少有效的表达式'
    : match[1].replace(/^Expected an indented block after (.+) clause$/, '$1 后需要缩进的代码块')
  return {
    message: reason,
    line: before.split(/\r\n|\r|\n/).length,
    startOffset: before.length,
    endOffset: through.length,
  }
}
