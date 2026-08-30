import { describe, expect, it } from 'vitest'
import { renderLuoguMarkdown } from './luoguMarkdown'

describe('Luogu Markdown renderer', () => {
  it('renders GFM tables and math structurally', () => {
    const html = renderLuoguMarkdown('| A | B |\n| - | - |\n| 1 | 2 |\n\n$x^2$')
    expect(html).toContain('<table>')
    expect(html).toContain('class="katex"')
  })

  it('renders callout and anti-ai directives without leaking raw markers', () => {
    const html = renderLuoguMarkdown(':::warning[注意]{open}\n保留内容\n:::\n\n::anti-ai')
    expect(html).toContain('luogu-callout-warning')
    expect(html).toContain('<summary>注意</summary>')
    expect(html).toContain('luogu-directive-fallback-anti-ai')
    expect(html).not.toContain(':::warning')
  })

  it('supports alignment, epigraph and Tuack merged cells', () => {
    const html = renderLuoguMarkdown(':::align{right}\n右对齐\n:::\n\n:::epigraph[作者]\n引言\n:::\n\n::cute-table{tuack}\n\n| A | B |\n| - | - |\n| ^ | < |')
    expect(html).toContain('luogu-align-right')
    expect(html).toContain('luogu-epigraph')
    expect(html).toContain('luogu-cute-table-tuack')
    expect(html).toMatch(/rowspan="2"/i)
    expect(html).toMatch(/colspan="2"/i)
  })
})
