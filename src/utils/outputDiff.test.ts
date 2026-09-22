import { describe, expect, it } from 'vitest'
import { diffOutput, normalizeOutput } from './outputDiff'

describe('normalizeOutput', () => {
  it('matches the judge whitespace rules', () => {
    expect(normalizeOutput('42  \r\n\r\n')).toBe('42')
  })
})

describe('diffOutput', () => {
  it('keeps equal output unmarked', () => {
    expect(diffOutput('1 2\n3', '1 2\n3')).toEqual([
      { text: '1 2\n3', kind: 'match' },
    ])
  })

  it('marks a replacement without a strikethrough status', () => {
    expect(diffOutput('1 2 3', '1 9 3')).toEqual([
      { text: '1 ', kind: 'match' },
      { text: '9', kind: 'changed', expected: '2' },
      { text: ' 3', kind: 'match' },
    ])
  })

  it('marks additional actual output as extra', () => {
    expect(diffOutput('1 2', '1 2 3')).toEqual([
      { text: '1 2', kind: 'match' },
      { text: ' 3', kind: 'extra', expected: undefined },
    ])
  })

  it('shows expected text when actual output is missing it', () => {
    expect(diffOutput('1 2 3', '1 2')).toEqual([
      { text: '1 2', kind: 'match' },
      { text: ' 3', kind: 'missing' },
    ])
  })
})
