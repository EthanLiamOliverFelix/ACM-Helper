import { describe, expect, it } from 'vitest'
import { ojTranslationKey } from './ojTranslation'

describe('OJ translation cache key', () => {
  it('normalizes lowercase AtCoder ids', () => {
    expect(ojTranslationKey('atcoder', 'abc350_a')).toBe('atcoder:ABC350_A')
  })

  it('trims ids and keeps platform namespaces separate', () => {
    expect(ojTranslationKey('codeforces', ' 1742g ')).toBe('codeforces:1742G')
    expect(ojTranslationKey('luogu', ' p1001 ')).toBe('luogu:P1001')
  })
})
