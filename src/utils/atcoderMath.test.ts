import { describe, expect, it } from 'vitest'
import { atCoderVarMarkupToTex } from './atcoderMath'
import { renderLuoguMarkdown } from './luoguMarkdown'

describe('AtCoder math markup', () => {
  it('keeps TeX commands from plain var elements', () => {
    expect(atCoderVarMarkupToTex('\\ldots')).toBe('\\ldots')
  })

  it('converts HTML subscript and superscript markup', () => {
    const tex = atCoderVarMarkupToTex('A<sub>i</sub><sup>2</sup>')
    expect(tex).toBe('A_{i}^{2}')
    expect(renderLuoguMarkdown(`$${tex}$`)).toContain('class="katex"')
  })

  it('decodes entities used by inequalities', () => {
    expect(atCoderVarMarkupToTex('1 &lt; N &amp;&amp; N &le; 10')).toBe('1 < N && N &le; 10')
  })
})
