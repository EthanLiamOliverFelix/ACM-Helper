import { describe, expect, it } from 'vitest'
import type { Submission, Verdict } from '../types'
import { buildPracticeStatistics } from './practiceStats'

const DAY = 24 * 60 * 60 * 1000
function submission(problemId: string, status: Verdict, timestamp: number, extra: Partial<Submission> = {}): Submission {
  return { id: `${problemId}-${status}-${timestamp}`, problemId, platform: 'codeforces', status, language: 'cpp', timestamp, ...extra }
}

describe('practice statistics', () => {
  it('separates unique solved problems from submission attempts', () => {
    const now = new Date(2026, 8, 8, 12).getTime()
    const stats = buildPracticeStatistics([
      submission('100A', 'Wrong Answer', now - DAY),
      submission('100A', 'Accepted', now),
      submission('100A', 'Accepted', now),
    ], ['luogu:P1000'], now)
    expect(stats.solvedProblems).toBe(2)
    expect(stats.submissionCount).toBe(3)
    expect(stats.acceptedSubmissions).toBe(2)
    expect(stats.acceptanceRate).toBe(67)
    expect(stats.solvedLast7Days).toBe(1)
  })

  it('calculates activity streaks and ignores unsupported historical platforms', () => {
    const now = new Date(2026, 8, 8, 12).getTime()
    const stats = buildPracticeStatistics([
      submission('A', 'Accepted', now - 2 * DAY),
      submission('B', 'Accepted', now - DAY, { platform: 'atcoder', language: 'python' }),
      submission('C', 'Accepted', now, { platform: 'luogu' }),
      submission('D', 'Accepted', now, { platform: 'qoj' }),
    ], [], now)
    expect(stats.currentStreak).toBe(3)
    expect(stats.longestStreak).toBe(3)
    expect(stats.activeDays).toBe(3)
    expect(stats.platforms.map((platform) => platform.solved)).toEqual([1, 1, 1])
  })

  it('does not treat network failures or pending work as judge results', () => {
    const now = new Date(2026, 8, 8, 12).getTime()
    const stats = buildPracticeStatistics([
      submission('A', 'Accepted', now),
      submission('B', 'Pending', now),
      submission('C', 'Failed', now, { message: '账号检测超时' }),
      submission('D', 'Failed', now, { message: '用户确认本次尚未 AC' }),
    ], [], now)
    expect(stats.submissionCount).toBe(4)
    expect(stats.judgedSubmissions).toBe(2)
    expect(stats.acceptanceRate).toBe(50)
  })
})
