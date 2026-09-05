import { describe, expect, it } from 'vitest'
import { mapInOrderedBatches, parseBatchProblemInput } from './problemBatch'

describe('batch problem input', () => {
  it('accepts whitespace-separated links', () => {
    const parsed = parseBatchProblemInput('https://codeforces.com/problemset/problem/977/A https://www.luogu.com.cn/problem/P1001')
    expect(parsed.map((item) => item.url)).toEqual([
      'https://codeforces.com/problemset/problem/977/A',
      'https://www.luogu.com.cn/problem/P1001',
    ])
  })

  it('recognizes ids and platform-id/title forms', () => {
    const parsed = parseBatchProblemInput('P1000 977a\n洛谷-P1001/A+B Problem\nCF-4a/Watermelon')
    expect(parsed.map(({ platform, id, query }) => ({ platform, id, query }))).toEqual([
      { platform: 'luogu', id: 'P1000', query: undefined },
      { platform: 'codeforces', id: '977A', query: undefined },
      { platform: 'luogu', id: 'P1001', query: 'A+B Problem' },
      { platform: 'codeforces', id: '4A', query: 'Watermelon' },
    ])
  })

  it('keeps a title containing spaces as one query', () => {
    expect(parseBatchProblemInput('Wrong Subtraction')).toEqual([{ raw: 'Wrong Subtraction', query: 'Wrong Subtraction' }])
  })

  it('recognizes QOJ links and explicitly-prefixed numeric ids', () => {
    const parsed = parseBatchProblemInput('https://qoj.ac/problem/18920\nQOJ-1')
    expect(parsed).toEqual([
      { raw: 'https://qoj.ac/problem/18920', url: 'https://qoj.ac/problem/18920' },
      { raw: 'QOJ-1', platform: 'qoj', id: '1', query: undefined },
    ])
  })

  it('recognizes contest-scoped QOJ archive ids', () => {
    expect(parseBatchProblemInput('QOJ-C1096A')).toEqual([
      { raw: 'QOJ-C1096A', platform: 'qoj', id: 'C1096A', query: undefined },
    ])
  })

  it('keeps input order when concurrent resolutions finish out of order', async () => {
    let active = 0
    let peak = 0
    const result = await mapInOrderedBatches([1, 2, 3, 4, 5], 4, async (value) => {
      active++
      peak = Math.max(peak, active)
      await new Promise((resolve) => setTimeout(resolve, (5 - value) * 2))
      active--
      return `problem-${value}`
    })
    expect(result.map((item) => item.status === 'fulfilled' ? item.value : 'failed')).toEqual([
      'problem-1', 'problem-2', 'problem-3', 'problem-4', 'problem-5',
    ])
    expect(peak).toBe(4)
  })
})
