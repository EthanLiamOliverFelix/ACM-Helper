import { describe, expect, it } from 'vitest'
import type { Submission, Verdict } from '../types'
import { buildPracticeRecords, REVIEW_DAY_MS } from './practiceReview'

const DAY = REVIEW_DAY_MS
function submission(status: Verdict, timestamp: number, extra: Partial<Submission> = {}): Submission {
  return { id: `${status}-${timestamp}`, problemId: '977A', platform: 'codeforces', status, language: 'cpp', timestamp, ...extra }
}

describe('practice review aggregation', () => {
  it('does not add a one-shot accepted problem', () => {
    expect(buildPracticeRecords([submission('Accepted', 100)], {}, 100 + DAY)).toEqual([])
  })

  it('adds judged failures immediately and preserves their verdicts', () => {
    const records = buildPracticeRecords([
      submission('Time Limit Exceeded', 100),
      submission('Runtime Error', 200),
    ], {}, 300)
    expect(records[0]).toMatchObject({ failureCount: 2, unresolved: true, due: true })
    expect(records[0].failureVerdicts).toEqual(['Time Limit Exceeded', 'Runtime Error'])
  })

  it('schedules the first review one day after correction', () => {
    const records = buildPracticeRecords([
      submission('Wrong Answer', 100),
      submission('Accepted', 200),
    ], {}, 200 + DAY - 1)
    expect(records[0]).toMatchObject({ correctionStage: 1, due: false, nextReviewAt: 200 + DAY })
  })

  it('does not count rapid repeated AC submissions as spaced reviews', () => {
    const records = buildPracticeRecords([
      submission('Wrong Answer', 100),
      submission('Accepted', 200),
      submission('Accepted', 300),
      submission('Accepted', 400),
    ], {}, 200 + DAY)
    expect(records[0]).toMatchObject({ correctionStage: 1, due: true })
  })

  it('requires two compilation errors and ignores infrastructure failures', () => {
    expect(buildPracticeRecords([submission('Compilation Error', 100)], {}, 200)).toEqual([])
    expect(buildPracticeRecords([submission('Failed', 100, { message: '洛谷账号检测超时' })], {}, 200)).toEqual([])
    expect(buildPracticeRecords([
      submission('Compilation Error', 100),
      submission('Compilation Error', 200),
    ], {}, 300)).toHaveLength(1)
  })

  it('resurfaces after a new failure even if it was marked mastered', () => {
    const controls = { 'codeforces:977A': { masteredAt: 300 } }
    expect(buildPracticeRecords([submission('Wrong Answer', 100)], controls, 400)[0].mastered).toBe(true)
    expect(buildPracticeRecords([submission('Wrong Answer', 500)], controls, 600)[0]).toMatchObject({ mastered: false, due: true })
  })

  it('keeps a manually removed problem out until it fails again', () => {
    const controls = { 'codeforces:977A': { removedAt: 300 } }
    expect(buildPracticeRecords([submission('Wrong Answer', 100)], controls, 400)).toEqual([])
    expect(buildPracticeRecords([submission('Wrong Answer', 500)], controls, 600)[0]).toMatchObject({ unresolved: true, due: true })
  })

  it('archives after correction and three properly spaced reviews', () => {
    const attempts = [
      submission('Wrong Answer', 0),
      submission('Accepted', 100),
      submission('Accepted', 100 + DAY),
      submission('Accepted', 100 + 4 * DAY),
      submission('Accepted', 100 + 11 * DAY),
    ]
    expect(buildPracticeRecords(attempts, {}, 100 + 20 * DAY)[0]).toMatchObject({ correctionStage: 4, autoArchived: true, due: false })
  })
})
