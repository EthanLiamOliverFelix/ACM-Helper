import { expect, it } from 'vitest'
import type { Problem } from '../types'
import { decodeTranslation, encodeTranslation, statementError, statementSource, translationSourceError } from './statementIntegrity'

const problem: Problem = { id: '1', platform: 'qoj', title: '题目', tags: [], description: '<p>完整正文</p>', samples: [{ input: '1', output: '2' }, { input: '3', output: '4' }] }
it('roundtrips source and Markdown without breaking Unicode, comment delimiters or code', () => {
  const source = statementSource({ ...problem, description: '<p>--></p>\n中文 %' })
  const content = '# 中文\n```cpp\nint main() {}\n```'
  expect(decodeTranslation(encodeTranslation(content, source))).toEqual({ content, source })
})
it('rejects PDF preview text as translation source', () => {
  expect(translationSourceError({ ...problem, description: '该题使用 PDF 题面，可查看原始 PDF' })).toContain('PDF')
})
it('preserves existing samples if the replacement is missing just one pair', () => {
  expect(statementError({ ...problem, samples: [problem.samples![0]!] }, problem)).toContain('部分')
})
it('changes the source identity if input or sample content changes', () => {
  expect(statementSource({ ...problem, input: 'New input' })).not.toBe(statementSource(problem))
  expect(statementSource({ ...problem, samples: [{ input: '9', output: '2' }] })).not.toBe(statementSource(problem))
})
