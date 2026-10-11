import { describe, expect, it } from 'vitest'
import { qojProblemUrl, qojStatementPdfUrl } from './qoj'

describe('qojProblemUrl', () => {
  it('keeps global problem ids on the problem route', () => {
    expect(qojProblemUrl('18920')).toBe('https://qoj.ac/problem/18920')
  })

  it('maps archive problem ids back to their contest route', () => {
    expect(qojProblemUrl('c1096a')).toBe('https://qoj.ac/contest/1096/problem/A')
  })
})


it('embeds only QOJ PDF URLs and rejects external or credential-bearing links', () => {
  expect(qojStatementPdfUrl('PDF statement: https://qoj.ac/download.php?id=6&type=statement')).toBe('https://qoj.ac/download.php?id=6&type=statement')
  expect(qojStatementPdfUrl('PDF statement: https://evil.example/a.pdf')).toBeNull()
  expect(qojStatementPdfUrl('PDF statement: https://user@qoj.ac/a.pdf')).toBeNull()
  expect(qojStatementPdfUrl('QOJ 站内 AI 翻译')).toBeNull()
})
