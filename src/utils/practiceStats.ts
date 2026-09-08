import type { Submission, Verdict } from '../types'

export type StatisticsPlatform = 'codeforces' | 'luogu' | 'atcoder'

export interface PracticeStatistics {
  solvedProblems: number
  submissionCount: number
  judgedSubmissions: number
  acceptedSubmissions: number
  acceptanceRate: number
  activeDays: number
  currentStreak: number
  longestStreak: number
  solvedLast7Days: number
  submissionsLast30Days: number
  platforms: { id: StatisticsPlatform; label: string; solved: number; submissions: number }[]
  verdicts: { verdict: Verdict; label: string; count: number }[]
  languages: { id: string; label: string; count: number }[]
  activity: { date: string; label: string; submissions: number; acceptedProblems: number }[]
}

const DAY_MS = 24 * 60 * 60 * 1000
const SUPPORTED_PLATFORMS: StatisticsPlatform[] = ['codeforces', 'luogu', 'atcoder']
const PLATFORM_LABELS: Record<StatisticsPlatform, string> = {
  codeforces: 'Codeforces',
  luogu: '洛谷',
  atcoder: 'AtCoder',
}
const VERDICT_LABELS: Partial<Record<Verdict, string>> = {
  Accepted: 'AC',
  'Wrong Answer': 'WA',
  'Time Limit Exceeded': 'TLE',
  'Runtime Error': 'RE',
  'Memory Limit Exceeded': 'MLE',
  'Compilation Error': 'CE',
  Failed: '未通过',
  Interrupted: '已中断',
  Skipped: '已跳过',
}
const LANGUAGE_LABELS: Record<string, string> = { cpp: 'C++', python: 'Python', java: 'Java' }
const JUDGED_VERDICTS = new Set<Verdict>([
  'Accepted',
  'Wrong Answer',
  'Time Limit Exceeded',
  'Runtime Error',
  'Memory Limit Exceeded',
  'Compilation Error',
])

function inferPlatform(problemId: string): StatisticsPlatform {
  return /^(P|B|U|T)\d+/i.test(problemId) ? 'luogu' : 'codeforces'
}

function submissionPlatform(submission: Submission): StatisticsPlatform | null {
  if (submission.platform && SUPPORTED_PLATFORMS.includes(submission.platform as StatisticsPlatform)) return submission.platform as StatisticsPlatform
  return submission.platform ? null : inferPlatform(submission.problemId)
}

function isJudgedSubmission(submission: Submission) {
  if (JUDGED_VERDICTS.has(submission.status)) return true
  return submission.status === 'Failed' && /(?:尚未|没有|未)\s*(?:通过|AC)|not\s+accepted/i.test(submission.message ?? '')
}

function localDayStart(timestamp: number) {
  const date = new Date(timestamp)
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}

function localDateKey(timestamp: number) {
  const date = new Date(timestamp)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function normalizedSolvedKeys(solvedProblems: string[], submissions: Submission[]) {
  const keys = new Set<string>()
  for (const raw of solvedProblems) {
    const separator = raw.indexOf(':')
    if (separator < 0) continue
    const platform = raw.slice(0, separator).toLowerCase() as StatisticsPlatform
    if (SUPPORTED_PLATFORMS.includes(platform)) keys.add(`${platform}:${raw.slice(separator + 1).toUpperCase()}`)
  }
  for (const submission of submissions) {
    const platform = submissionPlatform(submission)
    if (platform && submission.status === 'Accepted') keys.add(`${platform}:${submission.problemId.toUpperCase()}`)
  }
  return keys
}

export function buildPracticeStatistics(submissions: Submission[], solvedProblems: string[], now = Date.now()): PracticeStatistics {
  const validSubmissions = submissions.filter((submission) => submissionPlatform(submission) && Number.isFinite(submission.timestamp))
  const solvedKeys = normalizedSolvedKeys(solvedProblems, validSubmissions)
  const judged = validSubmissions.filter(isJudgedSubmission)
  const accepted = judged.filter((submission) => submission.status === 'Accepted')
  const activeDayStarts = [...new Set(validSubmissions.map((submission) => localDayStart(submission.timestamp)))].sort((a, b) => a - b)
  const activeDaySet = new Set(activeDayStarts)
  const today = localDayStart(now)
  let streakCursor = activeDaySet.has(today) ? today : activeDaySet.has(today - DAY_MS) ? today - DAY_MS : -1
  let currentStreak = 0
  while (streakCursor >= 0 && activeDaySet.has(streakCursor)) {
    currentStreak++
    streakCursor -= DAY_MS
  }
  let longestStreak = 0
  let runningStreak = 0
  let previousDay = -Infinity
  for (const day of activeDayStarts) {
    runningStreak = day - previousDay === DAY_MS ? runningStreak + 1 : 1
    longestStreak = Math.max(longestStreak, runningStreak)
    previousDay = day
  }

  const firstAcceptedAt = new Map<string, number>()
  for (const submission of accepted.slice().sort((a, b) => a.timestamp - b.timestamp)) {
    const platform = submissionPlatform(submission)!
    const key = `${platform}:${submission.problemId.toUpperCase()}`
    if (!firstAcceptedAt.has(key)) firstAcceptedAt.set(key, submission.timestamp)
  }
  const sevenDaysAgo = today - 6 * DAY_MS
  const thirtyDaysAgo = today - 29 * DAY_MS

  const platforms = SUPPORTED_PLATFORMS.map((id) => ({
    id,
    label: PLATFORM_LABELS[id],
    solved: [...solvedKeys].filter((key) => key.startsWith(`${id}:`)).length,
    submissions: validSubmissions.filter((submission) => submissionPlatform(submission) === id).length,
  }))
  const verdicts = [...new Set(judged.map((submission) => submission.status))]
    .map((verdict) => ({ verdict, label: VERDICT_LABELS[verdict] ?? verdict, count: judged.filter((submission) => submission.status === verdict).length }))
    .sort((a, b) => b.count - a.count)
  const languages = [...new Set(validSubmissions.map((submission) => submission.language))]
    .map((id) => ({ id, label: LANGUAGE_LABELS[id] ?? id, count: validSubmissions.filter((submission) => submission.language === id).length }))
    .sort((a, b) => b.count - a.count)
  const activity = Array.from({ length: 14 }, (_, index) => {
    const day = today - (13 - index) * DAY_MS
    const date = localDateKey(day)
    const daySubmissions = validSubmissions.filter((submission) => localDateKey(submission.timestamp) === date)
    const dayAccepted = new Set(daySubmissions.filter((submission) => submission.status === 'Accepted').map((submission) => `${submissionPlatform(submission)}:${submission.problemId.toUpperCase()}`))
    return {
      date,
      label: `${new Date(day).getMonth() + 1}/${new Date(day).getDate()}`,
      submissions: daySubmissions.length,
      acceptedProblems: dayAccepted.size,
    }
  })

  return {
    solvedProblems: solvedKeys.size,
    submissionCount: validSubmissions.length,
    judgedSubmissions: judged.length,
    acceptedSubmissions: accepted.length,
    acceptanceRate: judged.length ? Math.round(accepted.length / judged.length * 100) : 0,
    activeDays: activeDayStarts.length,
    currentStreak,
    longestStreak,
    solvedLast7Days: [...firstAcceptedAt.values()].filter((timestamp) => timestamp >= sevenDaysAgo && timestamp <= now).length,
    submissionsLast30Days: validSubmissions.filter((submission) => submission.timestamp >= thirtyDaysAgo && submission.timestamp <= now).length,
    platforms,
    verdicts,
    languages,
    activity,
  }
}
