import { describe, expect, it } from 'vitest'
import { renderLuoguMarkdown } from './luoguMarkdown'
import { normalizeAiMarkdown } from './aiMarkdown'

describe('AI Markdown normalization', () => {
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
