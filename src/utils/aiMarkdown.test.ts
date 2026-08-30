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

  it('does not remove ordinary fenced code blocks', () => {
    expect(normalizeAiMarkdown('说明\n```cpp\nint main() {}\n```')).toContain('```cpp')
  })
})
