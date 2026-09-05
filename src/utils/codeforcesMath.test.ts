import { describe, expect, it } from 'vitest'
import { renderLuoguMarkdown } from './luoguMarkdown'
import { splitCodeforcesMathText } from './codeforcesMath'

describe('Codeforces Polygon math', () => {
  it('extracts multiple inline formulas from statement text', () => {
    const segments = splitCodeforcesMathText(
      'All the values are integer and between $$$-100$$$ and $$$100$$$.',
    )
    expect(segments).toEqual([
      { kind: 'text', value: 'All the values are integer and between ' },
      { kind: 'math', value: '-100' },
      { kind: 'text', value: ' and ' },
      { kind: 'math', value: '100' },
      { kind: 'text', value: '.' },
    ])
    for (const segment of segments.filter((item) => item.kind === 'math')) {
      expect(renderLuoguMarkdown(`$${segment.value}$`)).toContain('class="katex"')
    }
  })

  it('keeps unmatched delimiters as ordinary text', () => {
    expect(splitCodeforcesMathText('broken $$$x')).toEqual([
      { kind: 'text', value: 'broken $$$x' },
    ])
  })

  it.each([4, 5, 6])('collapses duplicated %s-dollar delimiters', (count) => {
    const dollars = '$'.repeat(count)
    expect(splitCodeforcesMathText(`before ${dollars}\\sum_i a_i${dollars} after`)).toEqual([
      { kind: 'text', value: 'before ' },
      { kind: 'math', value: '\\sum_i a_i' },
      { kind: 'text', value: ' after' },
    ])
  })
})
