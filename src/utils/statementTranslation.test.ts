import { describe, expect, it } from 'vitest'
import type { Problem } from '../types'
import { isChineseQojPdf, supportsStatementTranslation } from './statementTranslation'
import { translationSourceError } from './statementIntegrity'

const pdf: Problem = {
  platform: 'qoj', id: '14731', title: 'The 4th Universal Cup Extra Stage Wuhan M', tags: [],
  note: 'PDF statement: https://qoj.ac/download.php?type=statement&id=14731&ver=zh_cn',
  description: 'The 2025 ICPC Asia Wuhan Regional Contest. Input file standard input. Output file standard output. 给定序列。',
}

describe('PDF translation policy', () => {
  it('trusts the Chinese PDF version even when English headers dominate', () => {
    expect(isChineseQojPdf(pdf)).toBe(true)
    expect(supportsStatementTranslation(pdf)).toBe(false)
    expect(supportsStatementTranslation(pdf, true)).toBe(false)
    expect(translationSourceError(pdf)).toContain('中文 PDF')
  })

  it('recognizes Chinese body text in old PDF entries without a language marker', () => {
    const legacy = { ...pdf, note: 'PDF statement: https://qoj.ac/download.php?id=1', description: `${'Input output standard input memory limit n x y '.repeat(30)}给定一个长度为整数的序列，请计算并输出满足条件的答案。` }
    expect(isChineseQojPdf(legacy)).toBe(true)
    expect(supportsStatementTranslation(legacy)).toBe(false)
  })

  it('accepts explicit Chinese source metadata', () => {
    expect(isChineseQojPdf({ ...pdf, note: 'PDF statement: https://qoj.ac/download.php?id=1', source: 'QOJ · 中文题面', description: 'Input output' })).toBe(true)
  })

  it('retains translation for extracted English PDFs', () => {
    const english = { ...pdf, note: pdf.note!.replace('zh_cn', 'en'), description: 'Given an array of integers, calculate and print the maximum sum of a contiguous subarray.' }
    expect(isChineseQojPdf(english)).toBe(false)
    expect(supportsStatementTranslation(english)).toBe(true)
    expect(translationSourceError(english)).toBeNull()
  })

  it('does not classify an English PDF based on its Chinese title', () => {
    const english = { ...pdf, title: '构造王国', note: 'PDF statement: https://qoj.ac/download.php?id=1', description: 'Given a sequence of integers, construct a matrix satisfying the following conditions.' }
    expect(isChineseQojPdf(english)).toBe(false)
    expect(supportsStatementTranslation(english)).toBe(true)
  })

  it('preserves normal HTML statement and cached-translation behavior', () => {
    const html = { ...pdf, platform: 'codeforces' as const, note: undefined, description: 'Given a sequence of integers, determine whether the following conditions hold.' }
    expect(supportsStatementTranslation(html)).toBe(true)
    expect(supportsStatementTranslation({ ...html, description: '中文正文' }, true)).toBe(true)
  })
})
