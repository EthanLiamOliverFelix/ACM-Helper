import { describe, expect, it } from 'vitest'
import { qojProblemUrl } from './qoj'

describe('qojProblemUrl', () => {
  it('keeps global problem ids on the problem route', () => {
    expect(qojProblemUrl('18920')).toBe('https://qoj.ac/problem/18920')
  })

  it('maps archive problem ids back to their contest route', () => {
    expect(qojProblemUrl('c1096a')).toBe('https://qoj.ac/contest/1096/problem/A')
  })
})
