export type MarkdownColor = 'red' | 'orange' | 'yellow' | 'green' | 'blue' | 'purple'
export type MarkdownFormat = 'bold' | 'italic' | 'underline' | 'strikethrough' | 'code' | 'formula' | 'formula-block' | 'heading' | 'list' | 'link' | `color-${MarkdownColor}`

export interface MarkdownEditResult {
  text: string
  selectionStart: number
  selectionEnd: number
}

const wrappers: Partial<Record<MarkdownFormat, [string, string, string]>> = {
  bold: ['**', '**', '加粗内容'],
  italic: ['*', '*', '斜体内容'],
  underline: [':underline[', ']', '下划线内容'],
  strikethrough: ['~~', '~~', '删除内容'],
  code: ['`', '`', '代码'],
  formula: ['$', '$', 'a_i'],
  'formula-block': ['$$\n', '\n$$', '公式'],
  link: ['[', '](https://)', '链接文字'],
}

export function applyMarkdownFormat(text: string, start: number, end: number, format: MarkdownFormat): MarkdownEditResult {
  const selected = text.slice(start, end)
  const color = format.startsWith('color-') ? format.slice('color-'.length) : ''
  const wrapper: [string, string, string] | undefined = color
    ? [':color[', `]{name=${color}}`, '彩色文字']
    : wrappers[format]
  if (wrapper) {
    const [before, after, placeholder] = wrapper
    const body = selected || placeholder
    return {
      text: `${text.slice(0, start)}${before}${body}${after}${text.slice(end)}`,
      selectionStart: start + before.length,
      selectionEnd: start + before.length + body.length,
    }
  }

  const lineStart = text.lastIndexOf('\n', Math.max(0, start - 1)) + 1
  const lineEndCandidate = text.indexOf('\n', end)
  const lineEnd = lineEndCandidate < 0 ? text.length : lineEndCandidate
  const selectedLines = text.slice(lineStart, lineEnd)
  const prefix = format === 'heading' ? '## ' : '- '
  const replacement = selectedLines.split('\n').map((line) => `${prefix}${line}`).join('\n')
  return {
    text: `${text.slice(0, lineStart)}${replacement}${text.slice(lineEnd)}`,
    selectionStart: lineStart + prefix.length,
    selectionEnd: lineStart + replacement.length,
  }
}
