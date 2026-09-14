import { describe, expect, it } from 'vitest'
import { applyMarkdownFormat } from './markdownEditing'
import { renderLuoguMarkdown } from './luoguMarkdown'

describe('Markdown note editing helpers', () => {
  it('wraps a selection with bold Markdown', () => {
    expect(applyMarkdownFormat('hello world', 6, 11, 'bold')).toEqual({
      text: 'hello **world**', selectionStart: 8, selectionEnd: 13,
    })
  })

  it('uses safe HTML for underline because Markdown has no underline syntax', () => {
    expect(applyMarkdownFormat('重点', 0, 2, 'underline').text).toBe(':underline[重点]')
    expect(renderLuoguMarkdown(':underline[重点]')).toContain('<u>重点</u>')
  })

  it('adds list markers to every selected line', () => {
    expect(applyMarkdownFormat('a\nb', 0, 3, 'list').text).toBe('- a\n- b')
  })

  it('adds strikethrough and safe palette color markup', () => {
    expect(applyMarkdownFormat('旧结论', 0, 3, 'strikethrough').text).toBe('~~旧结论~~')
    expect(renderLuoguMarkdown('~~旧结论~~')).toContain('<del>旧结论</del>')
    const colored = applyMarkdownFormat('重点', 0, 2, 'color-red').text
    expect(colored).toBe(':color[重点]{name=red}')
    expect(renderLuoguMarkdown(colored)).toContain('markdown-color-red')
  })

  it('inserts an editable formula placeholder when selection is empty', () => {
    const result = applyMarkdownFormat('', 0, 0, 'formula')
    expect(result.text).toBe('$a_i$')
    expect(result.selectionEnd - result.selectionStart).toBe(3)
  })
})
