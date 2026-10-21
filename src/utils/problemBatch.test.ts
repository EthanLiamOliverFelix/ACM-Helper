import { describe, expect, it } from 'vitest'
import { createBatchCatalogLookup, mapInOrderedBatches, parseBatchProblemInput, validateBatchProblemInput } from './problemBatch'

describe('batch problem input', () => {
  it('indexes a large catalog once and does not scan it again for each id', () => {
    let idReads = 0
    const catalog = Array.from({ length: 20000 }, (_, index) => ({
      platform: 'codeforces',
      get id() { idReads++; return `${index + 1}A` },
      title: `Problem ${index + 1}`,
    }))
    const lookup = createBatchCatalogLookup([...catalog, ...catalog])
    expect(idReads).toBe(40000)
    for (let index = 19000; index < 20000; index++) {
      expect(lookup({ raw: '', platform: 'codeforces', id: `${index + 1}a` })).toBe(catalog[index])
    }
    expect(idReads).toBe(40000)
  })

  it('keeps catalog precedence and only resolves unique title matches', () => {
    const first = { platform: 'luogu', id: 'P1000', title: 'A+B' }
    const lookup = createBatchCatalogLookup([first, { ...first, title: 'Duplicate' }, { platform: 'codeforces', id: '1A', title: 'A+B' }])
    expect(lookup({ raw: '', platform: 'luogu', id: 'p1000' })).toBe(first)
    expect(lookup({ raw: '', query: 'A+B' })).toBeUndefined()
    expect(lookup({ raw: '', query: 'A+B', platform: 'luogu' })).toBe(first)
  })

  it('does not match incidental digits or discard meaningful title symbols', () => {
    const plusMinus = { platform: 'codeforces', id: '1971H', title: '±1' }
    const lookup = createBatchCatalogLookup([plusMinus, { platform: 'luogu', id: 'P1', title: 'ABC' }])
    expect(lookup({ raw: 'PG1000', query: 'PG1000' })).toBeUndefined()
    expect(lookup({ raw: 'l100', query: 'l100' })).toBeUndefined()
    expect(lookup({ raw: '1', query: '1' })).toBeUndefined()
    expect(lookup({ raw: 'XYZABC', query: 'XYZABC' })).toBeUndefined()
    expect(lookup({ raw: '±1', query: '±1' })).toBe(plusMinus)
  })

  it.each(['PG1000', 'l100', 'pg1000', 'XYZ123', 'CF-PG1000'])('rejects malformed identifier %s rather than searching titles', raw => {
    const result = validateBatchProblemInput(raw)
    expect(result.tokens).toEqual([])
    expect(result.failures).toMatchObject([{ raw, line: 1 }])
  })
  it('validates complete ids and retains failure line numbers without blocking valid rows', () => {
    const result = validateBatchProblemInput('CF-977A??\r\nP1000\r\n\r\nCF-P1000\r\nQOJ-14687\r\n14687\r\nAT-abc250_f')
    expect(result.tokens.map(item => [item.id, item.line])).toEqual([['P1000', 2], ['14687', 5], ['ABC250_F', 7]])
    expect(result.failures.map(item => [item.raw, item.line])).toEqual([['CF-977A??', 1], ['CF-P1000', 4], ['14687', 6]])
    expect(result.failures[2].reason).toContain('QOJ-')
  })

  it.each(['CF-977', 'CF-977AB', 'CF-abc', 'QOJ-', 'QOJ-12?', 'P1000oops', 'AT-abc250_', 'https://qoj.ac/problem/nope', 'https://evil.test/?next=qoj.ac/problem/1', 'https://codeforces.com/profile/tourist', 'https://atcoder.jp/contests/abc250', 'https://qoj.ac.evil.test/problem/1', 'ftp://qoj.ac/problem/1'])('rejects malformed input %s before resolution', input => {
    const result = validateBatchProblemInput(input)
    expect(result.tokens).toHaveLength(0)
    expect(result.failures).toHaveLength(1)
  })

  it('preserves supported links, ids with titles, title searches and deduplication', () => {
    const input = ['P1000 977A', '洛谷-P1001/A+B Problem', 'Wrong Subtraction', 'QOJ-C1096A', 'P1000', 'https://codeforces.com/contest/1163/problem/C2', 'https://atcoder.jp/contests/abc250/tasks/abc250_f?lang=en', 'https://qoj.ac/contest/1096/problem/A/statement/zh', 'https://www.luogu.com.cn/problem/CF977A'].join('\n')
    const result = validateBatchProblemInput(input)
    expect(result.failures).toEqual([])
    expect(result.tokens).toHaveLength(9)
    expect(result.tokens.find(item => item.id === 'P1001')?.query).toBe('A+B Problem')
    expect(result.tokens.find(item => item.raw === 'Wrong Subtraction')?.query).toBe('Wrong Subtraction')
  })
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
