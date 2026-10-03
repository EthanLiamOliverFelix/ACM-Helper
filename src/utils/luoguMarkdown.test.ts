import { describe, expect, it } from 'vitest'
import { renderLuoguMarkdown } from './luoguMarkdown'
import { readFileSync } from 'node:fs'

describe('Luogu Markdown renderer', () => {
  it('loads styles matching the renderer layout for not-equal signs and fractions', () => {
    const html = renderLuoguMarkdown(String.raw`$i \ne j$ and $\frac{a}{b}$`)
    const css = readFileSync(new URL('../../node_modules/katex/dist/katex.css', import.meta.url), 'utf8')
    // The slash must overlap the equals sign; fractions need vertical stacking.
    expect(html).toContain('class="rlap"')
    expect(html).toContain('vlist')
    expect(css).toContain('.katex .rlap')
    expect(css).toContain('.katex .vlist')
    expect(css).toContain('.katex .base')
  })

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
