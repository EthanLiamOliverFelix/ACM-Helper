import { describe, expect, it } from 'vitest'
import { parseBatchProblemInput } from './problemBatch'

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
})
