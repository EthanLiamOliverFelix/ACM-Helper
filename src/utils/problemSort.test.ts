import { describe, expect, it } from 'vitest'
import type { Problem } from '../types'
import { compareCodeforcesProblems } from './problemSort'

function problem(id: string): Problem {
  return { id, title: id, tags: [], platform: 'codeforces' }
}

describe('compareCodeforcesProblems', () => {
  it('sorts the numeric contest part from large to small', () => {
    const ids = ['9E', '2100A', '99B', '999F'].map(problem).sort(compareCodeforcesProblems).map(item => item.id)
    expect(ids).toEqual(['2100A', '999F', '99B', '9E'])
  })

  it('sorts the problem suffix alphabetically inside one contest', () => {
    const ids = ['2100C', '2100A', '2100B'].map(problem).sort(compareCodeforcesProblems).map(item => item.id)
    expect(ids).toEqual(['2100A', '2100B', '2100C'])
  })
})
