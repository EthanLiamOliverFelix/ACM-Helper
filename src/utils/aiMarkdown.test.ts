import { describe, expect, it } from 'vitest'
import { renderLuoguMarkdown } from './luoguMarkdown'
import { hasTranslationBody, normalizeAiMarkdown } from './aiMarkdown'

describe('AI Markdown normalization', () => {
  it('renders AtCoder var tags returned inside translated Markdown', () => {
    const html = renderLuoguMarkdown(normalizeAiMarkdown('整数 <var>A_i &lt; 2^{60}</var>，<var>N</var> 个元素。'))
    expect(html.match(/class="katex"/g)?.length).toBe(2)
    expect(html).not.toContain('<var>')
  })

  it('preserves code examples and rejects heading-only translations', () => {
    expect(normalizeAiMarkdown('```html\n<var>N</var>\n```')).toContain('<var>N</var>')
    expect(hasTranslationBody('# Xor Sum 3\n## 题解\n## 输入\n## 输出')).toBe(false)
    expect(hasTranslationBody('这是一段完整的题面正文。'.repeat(8))).toBe(true)
  })
  it('unwraps a whole Markdown document fence before rendering', () => {
    const markdown = normalizeAiMarkdown('```markdown\n# 中文题面\n\n这是正文。\n```')
    expect(markdown).toBe('# 中文题面\n\n这是正文。')
    expect(renderLuoguMarkdown(markdown)).toContain('<h1>中文题面</h1>')
  })

  it('normalizes common AI and Codeforces LaTeX delimiters', () => {
    const markdown = normalizeAiMarkdown('行内 \\(n+k\\)，展示 \\[x^2\\]，原题 $$$m$$$')
    const html = renderLuoguMarkdown(markdown)
    expect(html.match(/class="katex"/g)?.length).toBeGreaterThanOrEqual(3)
  })

  it('keeps Codeforces triple-dollar formulas inline', () => {
    const html = renderLuoguMarkdown(normalizeAiMarkdown('between $$$-100$$$ and $$$100$$$.'))
    expect(html.match(/class="katex"/g)?.length).toBeGreaterThanOrEqual(2)
    expect(html).not.toContain('katex-display')
  })

  it.each([4, 5, 6])('normalizes duplicated %s-dollar formula delimiters', (count) => {
    const dollars = '$'.repeat(count)
    const html = renderLuoguMarkdown(normalizeAiMarkdown(`sum ${dollars}\\sum_i a_i${dollars}`))
    expect(html).toContain('class="katex"')
    expect(html).not.toContain('$$$$')
  })

  it('does not remove ordinary fenced code blocks', () => {
    expect(normalizeAiMarkdown('说明\n```cpp\nint main() {}\n```')).toContain('```cpp')
  })
})
