export interface DebugValueEntry { name: string; value: string }
export interface DebugValueView { summary: string; children: DebugValueEntry[]; expandable: boolean }

// Split only outside nested aggregates and quoted strings. GDB includes both
// container summaries and ordinary struct members in its printable values.
function separators(source: string, delimiter: string) {
  const positions: number[] = []
  let depth = 0
  let quote = ''
  let escaped = false
  for (let i = 0; i < source.length; i++) {
    const c = source[i]
    if (quote) {
      if (c === quote && !escaped) quote = ''
      escaped = c === '\\' && !escaped
      if (c !== '\\') escaped = false
      continue
    }
    if (c === '"' || c === "'") { quote = c; continue }
    if ('{[('.includes(c)) depth++
    else if ('}])'.includes(c)) depth--
    else if (c === delimiter && depth === 0) {
      if (delimiter === ',' && /^,\s*capacity\s+\d+\b/.test(source.slice(i))) continue
      positions.push(i)
    }
  }
  return positions
}

export function parseDebugValue(value = ''): DebugValueView {
  const text = value.trim()
  const scalar = { summary: value || '—', children: [], expandable: false }
  // String contents, including braces and commas, must remain a scalar.
  if (/^(?:L|u8|u|U)?["']/.test(text)) return scalar
  const emptyContainer = /\bstd::.*?\b(?:of length 0|with 0 elements)\b/.test(text)
  if (emptyContainer && !text.includes('{')) return { summary: '容器 · 0 项', children: [], expandable: false }
  const open = text.indexOf('{')
  const close = text.lastIndexOf('}')
  if (open < 0 || close < open || text.slice(close + 1).trim()) return scalar
  // Avoid interpreting braces in a pointer's quoted string representation.
  if (text.slice(0, open).includes('"')) return scalar
  const source = text.slice(open + 1, close)
  const parts: string[] = []
  let start = 0
  for (const at of separators(source, ',')) {
    parts.push(source.slice(start, at).trim())
    start = at + 1
  }
  if (source.slice(start).trim()) parts.push(source.slice(start).trim())
  const children = parts.map((part, index) => {
    const equals = separators(part, '=')[0]
    const member = equals == null ? '' : part.slice(0, equals).trim()
    return equals == null || !/^(?:\[[^\]]+\]|(?:static\s+)?[\w$]+|<[^>]+>)$/.test(member) ? { name: `[${index}]`, value: part }
      : { name: part.slice(0, equals).trim(), value: part.slice(equals + 1).trim() }
  })
  const prefix = text.slice(0, open)
  const container = /\bstd::/.test(prefix) || children.every(child => /^\[.*\]$/.test(child.name))
  const length = prefix.match(/\b(?:of length|with)\s+(\d+)/)?.[1]
  return {
    summary: container ? `容器 · ${length ?? children.length} 项` : `对象 · ${children.length} 个成员`,
    children,
    expandable: children.length > 0,
  }
}
