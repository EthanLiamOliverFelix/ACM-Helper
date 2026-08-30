import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import type { Difficulty } from '../types'
import type { ProblemSetEntry } from './problemSetStore'
import { useProblemStore } from './problemStore'
import { useProblemSetStore } from './problemSetStore'
import { useLearningStore } from './learningStore'
import {
  buildPracticeRecords,
  practiceSummary,
  REVIEW_DAY_MS,
  type PracticeControl,
  type PracticeControls,
  type PracticeRecord,
  type ReviewPlatform,
} from '../utils/practiceReview'
import { getDataCenterValue, saveDataCenterValue } from '../dataCenter'

const DAILY_LIMIT = 5

export interface PracticeProblem extends ProblemSetEntry {
  practice: PracticeRecord
  staleSkills: string[]
  summary: string
}

function loadControls(): PracticeControls {
  const parsed = getDataCenterValue<PracticeControls>('practice-review', {})
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
}

function problemUrl(platform: ReviewPlatform, id: string) {
  if (platform === 'luogu') return `https://www.luogu.com.cn/problem/${encodeURIComponent(id)}`
  if (platform === 'atcoder') return `https://atcoder.jp/contests/${id.split('_')[0].toLowerCase()}/tasks/${id.toLowerCase()}`
  const match = id.match(/^(\d+)([A-Za-z][A-Za-z0-9]*)$/)
  return match ? `https://codeforces.com/problemset/problem/${match[1]}/${match[2]}` : ''
}

export const usePracticeStore = defineStore('practice', () => {
  const controls = ref<PracticeControls>(loadControls())
  const reviewClock = ref(Date.now())
  const problems = useProblemStore()
  const sets = useProblemSetStore()
  const learning = useLearningStore()

  const records = computed(() => buildPracticeRecords(problems.submissions, controls.value, reviewClock.value))
  const ignoredCount = computed(() => records.value.filter((record) => record.ignored).length)
  const archivedCount = computed(() => records.value.filter((record) => record.mastered || record.autoArchived).length)

  const metadata = computed(() => {
    const entries = new Map<string, ProblemSetEntry>()
    const merge = (entry: {
      platform: string
      id: string
      title?: string
      url?: string
      rating?: number
      difficulty?: Difficulty
      tags?: string[]
      reason?: string
      addedAt?: number
      metadataFetchedAt?: number
    }) => {
      if (entry.platform !== 'codeforces' && entry.platform !== 'luogu' && entry.platform !== 'atcoder') return
      const key = `${entry.platform}:${entry.id.toUpperCase()}`
      const previous = entries.get(key)
      entries.set(key, {
        platform: entry.platform,
        id: entry.id,
        title: entry.title?.trim() || previous?.title || entry.id,
        url: entry.url || previous?.url,
        rating: entry.rating ?? previous?.rating,
        difficulty: (entry.difficulty ?? previous?.difficulty) as Difficulty | undefined,
        tags: entry.tags?.length ? [...entry.tags] : [...(previous?.tags ?? [])],
        reason: entry.reason ?? previous?.reason,
        addedAt: entry.addedAt ?? previous?.addedAt ?? Date.now(),
        metadataFetchedAt: entry.metadataFetchedAt ?? previous?.metadataFetchedAt,
      })
    }
    for (const problem of problems.problems) merge(problem)
    for (const problem of problems.importedProblems) merge(problem)
    for (const set of sets.sets) for (const entry of set.problems) merge(entry)
    if (problems.currentProblem) merge(problems.currentProblem)
    return entries
  })

  function enrich(record: PracticeRecord): PracticeProblem {
    const known = metadata.value.get(record.key)
    const tags = known?.tags ?? []
    const staleSkills = learning.skillsForTags(tags)
      .filter((skill) => ['aging', 'stale'].includes(learning.skillFreshness(skill.id, reviewClock.value).level))
      .map((skill) => skill.name)
    const freshnessPriority = learning.skillsForTags(tags).reduce((score, skill) => {
      const level = learning.skillFreshness(skill.id, reviewClock.value).level
      return score + (level === 'stale' ? 200 : level === 'aging' ? 80 : 0)
    }, 0)
    const practice = { ...record, priority: record.priority + freshnessPriority }
    return {
      platform: record.platform,
      id: known?.id ?? record.problemId,
      title: known?.title ?? record.problemId,
      url: known?.url ?? problemUrl(record.platform, record.problemId),
      rating: known?.rating,
      difficulty: known?.difficulty,
      tags,
      reason: known?.reason,
      addedAt: known?.addedAt ?? record.lastFailureAt,
      metadataFetchedAt: known?.metadataFetchedAt,
      practice,
      staleSkills,
      summary: practiceSummary(practice, reviewClock.value),
    }
  }

  const activeProblems = computed(() => records.value
    .filter((record) => !record.ignored && !record.mastered && (!record.autoArchived || record.pinned))
    .map(enrich)
    .sort((a, b) => b.practice.priority - a.practice.priority || b.practice.lastFailureAt - a.practice.lastFailureAt))
  const wrongProblems = computed(() => activeProblems.value)
  const todayProblems = computed(() => activeProblems.value.filter((problem) => problem.practice.due).slice(0, DAILY_LIMIT))

  function persist() {
    void saveDataCenterValue('practice-review', controls.value)
  }

  function updateControl(key: string, change: (previous: PracticeControl) => PracticeControl) {
    const normalized = key.includes(':') ? `${key.split(':')[0]}:${key.slice(key.indexOf(':') + 1).toUpperCase()}` : key
    controls.value = { ...controls.value, [normalized]: change(controls.value[normalized] ?? {}) }
    reviewClock.value = Date.now()
    persist()
  }

  function togglePinned(key: string) {
    updateControl(key, (previous) => ({ ...previous, pinned: !previous.pinned, ignored: false }))
  }

  function snooze(key: string) {
    updateControl(key, (previous) => ({ ...previous, snoozedUntil: Date.now() + 3 * REVIEW_DAY_MS }))
  }

  function markMastered(key: string) {
    updateControl(key, (previous) => ({ ...previous, pinned: false, snoozedUntil: undefined, masteredAt: Date.now() }))
  }

  function ignore(key: string) {
    updateControl(key, (previous) => ({ ...previous, pinned: false, ignored: true }))
  }

  function restoreIgnored() {
    const next = { ...controls.value }
    for (const [key, control] of Object.entries(next)) {
      if (control.ignored) next[key] = { ...control, ignored: false }
    }
    controls.value = next
    reviewClock.value = Date.now()
    persist()
  }

  function refresh() {
    reviewClock.value = Date.now()
  }

  async function openProblem(problem: PracticeProblem) {
    const url = problem.url || problemUrl(problem.platform, problem.id)
    if (!url) throw new Error('题号格式无效，无法打开该题')
    await problems.openRecommendedProblem({ ...problem, url })
  }

  return {
    controls,
    records,
    wrongProblems,
    todayProblems,
    ignoredCount,
    archivedCount,
    dailyLimit: DAILY_LIMIT,
    refresh,
    togglePinned,
    snooze,
    markMastered,
    ignore,
    restoreIgnored,
    openProblem,
  }
})
