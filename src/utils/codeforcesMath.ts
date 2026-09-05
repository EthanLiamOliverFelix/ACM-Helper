export type CodeforcesMathSegment =
  | { kind: 'text'; value: string }
  | { kind: 'math'; value: string }

/** Split Polygon's inline $$$...$$$ syntax without changing unmatched text. */
export function splitCodeforcesMathText(value: string): CodeforcesMathSegment[] {
  const segments: CodeforcesMathSegment[] = []
  let cursor = 0
  while (cursor < value.length) {
    const start = value.indexOf('$$$', cursor)
    if (start < 0) {
      segments.push({ kind: 'text', value: value.slice(cursor) })
      break
    }
    const end = value.indexOf('$$$', start + 3)
    if (end < 0) {
      segments.push({ kind: 'text', value: value.slice(cursor) })
      break
    }
    if (start > cursor) segments.push({ kind: 'text', value: value.slice(cursor, start) })
    const formula = value.slice(start + 3, end).trim()
    if (formula) segments.push({ kind: 'math', value: formula })
    else segments.push({ kind: 'text', value: '$$$$$$' })
    cursor = end + 3
  }
  return segments.length ? segments : [{ kind: 'text', value }]
}
