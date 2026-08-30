import { describe, expect, it } from 'vitest'
import { normalizeOutputLineLimit, truncateOutput } from './outputLimit'

describe('local run output limits', () => {
  it('keeps complete output within the configured line count', () => {
    expect(truncateOutput('a\nb\n', 2)).toBe('a\nb\n')
  })

  it('prefixes the first configured lines when output is truncated', () => {
    expect(truncateOutput('a\nb\nc\nd', 3)).toBe('[Truncated]\na\nb\nc')
  })

  it('clamps invalid settings', () => {
    expect(normalizeOutputLineLimit(0)).toBe(1)
    expect(normalizeOutputLineLimit(50_000)).toBe(10_000)
    expect(normalizeOutputLineLimit('bad')).toBe(300)
  })
})
