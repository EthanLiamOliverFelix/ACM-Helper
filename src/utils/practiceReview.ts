import type { Submission, Verdict } from '../types'

export type ReviewPlatform = 'codeforces' | 'luogu' | 'atcoder'

export interface PracticeControl {
  ignored?: boolean
  pinned?: boolean
  snoozedUntil?: number
  masteredAt?: number
}

export type PracticeControls = Record<string, PracticeControl>

export interface PracticeRecord {
  key: string
  platform: ReviewPlatform
  problemId: string
  failureCount: number
  failureVerdicts: Verdict[]
  lastFailureAt: number
  correctionStage: number
  lastCompletedAt?: number
  nextReviewAt: number
  due: boolean
  unresolved: boolean
  ignored: boolean
  pinned: boolean
  mastered: boolean
  autoArchived: boolean
  priority: number
}

export const REVIEW_DAY_MS = 24 * 60 * 60 * 1000
const REVIEW_INTERVAL_DAYS = [1, 3, 7]
const DIRECT_FAILURES = new Set<Verdict>([
  'Wrong Answer',
  'Time Limit Exceeded',
  'Runtime Error',
  'Memory Limit Exceeded',
])

function inferLegacyPlatform(problemId: string): ReviewPlatform {
  return /^(P|B|U|T)\d+/i.test(problemId) ? 'luogu' : 'codeforces'
}

function reviewPlatform(submission: Submission): ReviewPlatform | null {
  if (submission.platform === 'codeforces' || submission.platform === 'luogu' || submission.platform === 'atcoder') return submission.platform
  if (!submission.platform) return inferLegacyPlatform(submission.problemId)
  return null
}

function isConfirmedManualFailure(submission: Submission) {
  return submission.status === 'Failed' && /(?:尚未|没有|未)\s*(?:通过|AC)|not\s+accepted/i.test(submission.message ?? '')
}

function uniqueVerdicts(submissions: Submission[]) {
  return [...new Set(submissions.map((submission) => submission.status))]
}

function creditedAcceptedTimes(submissions: Submission[], lastFailureAt: number) {
  const accepted = submissions
    .filter((submission) => submission.status === 'Accepted' && submission.timestamp > lastFailureAt)
    .map((submission) => submission.timestamp)
    .sort((a, b) => a - b)
  if (!accepted.length) return []

  const credited = [accepted[0]]
  for (const timestamp of accepted.slice(1)) {
    const intervalIndex = credited.length - 1
    if (intervalIndex >= REVIEW_INTERVAL_DAYS.length) break
    const earliest = credited[credited.length - 1] + REVIEW_INTERVAL_DAYS[intervalIndex] * REVIEW_DAY_MS
    if (timestamp >= earliest) credited.push(timestamp)
  }
  return credited
}

/**
 * Turns persisted submission history into review state. Infrastructure failures
 * are deliberately excluded so login/network errors never become "wrong answers".
 */
export function buildPracticeRecords(
  submissions: Submission[],
  controls: PracticeControls = {},
  now = Date.now(),
): PracticeRecord[] {
  const groups = new Map<string, { platform: ReviewPlatform; problemId: string; attempts: Submission[] }>()
  for (const submission of submissions) {
    const platform = reviewPlatform(submission)
    if (!platform) continue
    const key = `${platform}:${submission.problemId.toUpperCase()}`
    const group = groups.get(key) ?? { platform, problemId: submission.problemId, attempts: [] }
    group.attempts.push(submission)
    groups.set(key, group)
  }

  const records: PracticeRecord[] = []
  for (const [key, group] of groups) {
    const attempts = group.attempts.slice().sort((a, b) => a.timestamp - b.timestamp)
    const compilationErrors = attempts.filter((submission) => submission.status === 'Compilation Error')
    const failures = attempts.filter((submission) => DIRECT_FAILURES.has(submission.status)
      || isConfirmedManualFailure(submission)
      || (submission.status === 'Compilation Error' && compilationErrors.length >= 2))
    if (!failures.length) continue

    const lastFailureAt = Math.max(...failures.map((submission) => submission.timestamp))
    const credited = creditedAcceptedTimes(attempts, lastFailureAt)
    const correctionStage = credited.length
    const lastCompletedAt = credited.length ? credited[credited.length - 1] : undefined
    const control = controls[key] ?? controls[`${group.platform}:${group.problemId}`] ?? {}
    const manuallyMastered = Boolean(control.masteredAt && control.masteredAt >= lastFailureAt)
    const autoArchived = correctionStage >= 4 && !control.pinned
    let nextReviewAt = lastFailureAt
    if (lastCompletedAt) {
      const days = REVIEW_INTERVAL_DAYS[Math.min(correctionStage - 1, REVIEW_INTERVAL_DAYS.length - 1)] ?? 7
      nextReviewAt = lastCompletedAt + days * REVIEW_DAY_MS
    }
    // Fixed items remain available after the normal 1/3/7-day cycle, but no
    // more than once every two weeks.
    if (control.pinned && correctionStage >= 4 && lastCompletedAt) nextReviewAt = lastCompletedAt + 14 * REVIEW_DAY_MS
    if (control.snoozedUntil && control.snoozedUntil > nextReviewAt) nextReviewAt = control.snoozedUntil

    const overdueDays = Math.max(0, Math.floor((now - nextReviewAt) / REVIEW_DAY_MS))
    records.push({
      key,
      platform: group.platform,
      problemId: group.problemId,
      failureCount: failures.length,
      failureVerdicts: uniqueVerdicts(failures),
      lastFailureAt,
      correctionStage,
      lastCompletedAt,
      nextReviewAt,
      due: !control.ignored && !manuallyMastered && !autoArchived && nextReviewAt <= now,
      unresolved: correctionStage === 0,
      ignored: Boolean(control.ignored),
      pinned: Boolean(control.pinned),
      mastered: manuallyMastered,
      autoArchived,
      priority: (correctionStage === 0 ? 1000 : 0) + (control.pinned ? 500 : 0) + failures.length * 50 + overdueDays * 5,
    })
  }
  return records.sort((a, b) => b.priority - a.priority || b.lastFailureAt - a.lastFailureAt)
}

export function practiceVerdictLabel(verdict: Verdict) {
  const labels: Partial<Record<Verdict, string>> = {
    'Wrong Answer': 'WA',
    'Time Limit Exceeded': 'TLE',
    'Runtime Error': 'RE',
    'Memory Limit Exceeded': 'MLE',
    'Compilation Error': 'CE',
    Failed: '未通过',
  }
  return labels[verdict] ?? verdict
}

export function practiceSummary(record: PracticeRecord, now = Date.now()) {
  const verdicts = record.failureVerdicts.map(practiceVerdictLabel).join('/')
  const failure = `失败 ${record.failureCount} 次 · ${verdicts}`
  if (record.unresolved) return `${failure} · 尚未订正`
  if (record.due) return `${failure} · 第 ${record.correctionStage} 阶段已完成，今日复习`
  const days = Math.max(1, Math.ceil((record.nextReviewAt - now) / REVIEW_DAY_MS))
  return `${failure} · 已订正，${days} 天后复习`
}
