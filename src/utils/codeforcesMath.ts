export type CodeforcesMathSegment =
  | { kind: 'text'; value: string }
  | { kind: 'math'; value: string }

/**
 * Split Polygon's inline $$$...$$$ syntax without changing unmatched text.
 * Some cached/translated statements duplicate the delimiter, so every run of
 * three or more dollar signs is treated as one boundary.
 */
export function splitCodeforcesMathText(value: string): CodeforcesMathSegment[] {
  const segments: CodeforcesMathSegment[] = []
  const delimiter = /\${3,}/g
  let cursor = 0
  while (cursor < value.length) {
    delimiter.lastIndex = cursor
    const start = delimiter.exec(value)
    if (!start) {
      segments.push({ kind: 'text', value: value.slice(cursor) })
      break
    }
    const startEnd = start.index + start[0].length
    delimiter.lastIndex = startEnd
    const end = delimiter.exec(value)
    if (!end) {
      segments.push({ kind: 'text', value: value.slice(cursor) })
      break
    }
    if (start.index > cursor) segments.push({ kind: 'text', value: value.slice(cursor, start.index) })
    const formula = value.slice(startEnd, end.index).trim()
    if (formula) segments.push({ kind: 'math', value: formula })
    else segments.push({ kind: 'text', value: value.slice(start.index, end.index + end[0].length) })
    cursor = end.index + end[0].length
  }
  return segments.length ? segments : [{ kind: 'text', value }]
}
