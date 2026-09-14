import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { invoke } from '@tauri-apps/api/core'
import { SKILL_BY_ID, SKILL_TREE, skillPrerequisiteClosure } from '../data/skillTree'
import type { ContestAnalysis, LearningProfile, Problem, SkillLearningPlan, SkillNode, SkillPlanProblem, SkillStatus } from '../types'
import { skillPrerequisitesMet } from '../utils/skillUnlock'

const REVIEW_AFTER_DAYS = 30
const DAY_MS = 24 * 60 * 60 * 1000

export type SkillFreshness = {
  level: 'untracked' | 'fresh' | 'aging' | 'stale'
  days: number | null
  score: number
  label: string
}

export const useLearningStore = defineStore('learning', () => {
  const profile = ref<LearningProfile>({ solvedProblems: [], learningSkills: [], masteredSkills: [], skippedSkills: [], updatedAt: 0, skillEvidence: {}, skillPlans: {}, skillPlanPages: {}, skillLastPracticedAt: {} })
  const selectedSkillId = ref<string | null>(null)
  const initialized = ref(false)
  const contestUrl = ref('')
  const contestAnalysis = ref<ContestAnalysis | null>(null)
  const isAnalyzing = ref(false)
  const error = ref<string | null>(null)

  const mastered = computed(() => new Set(profile.value.masteredSkills))
  const learning = computed(() => new Set(profile.value.learningSkills))
  const skipped = computed(() => new Set(profile.value.skippedSkills))
  const progress = computed(() => Math.round(profile.value.masteredSkills.length / SKILL_TREE.length * 100))

  function statusOf(skill: SkillNode): SkillStatus {
    if (mastered.value.has(skill.id)) return 'mastered'
    if (skipped.value.has(skill.id)) return 'skipped'
    if ((learning.value.has(skill.id) || plansFor(skill.id).length) && skillPrerequisitesMet(skill, mastered.value, skipped.value)) return 'learning'
    return skillPrerequisitesMet(skill, mastered.value, skipped.value) ? 'available' : 'locked'
  }

  function unmetPrerequisites(skill: SkillNode): SkillNode[] {
    return skill.prerequisites.filter((id) => !mastered.value.has(id) && !skipped.value.has(id)).map((id) => SKILL_BY_ID.get(id)!).filter(Boolean)
  }

  async function persist() {
    profile.value.updatedAt = Date.now()
    await invoke('save_learning_profile', { profile: profile.value })
  }

  async function init() {
    if (initialized.value) return
    try {
      const loaded = await invoke<LearningProfile>('load_learning_profile')
      const legacyPlans = loaded.skillPlans ?? {}
      const loadedPages = loaded.skillPlanPages ?? {}
      const skillPlanPages = { ...loadedPages }
      for (const [skillId, plan] of Object.entries(legacyPlans)) {
        if (!skillPlanPages[skillId]?.length) skillPlanPages[skillId] = [plan]
      }
      const skillLastPracticedAt = { ...(loaded.skillLastPracticedAt ?? {}) }
      for (const [skillId, evidence] of Object.entries(loaded.skillEvidence ?? {})) {
        if (evidence.length && !skillLastPracticedAt[skillId] && loaded.updatedAt) skillLastPracticedAt[skillId] = loaded.updatedAt
      }
      profile.value = {
        solvedProblems: loaded.solvedProblems ?? [],
        learningSkills: loaded.learningSkills ?? [],
        masteredSkills: loaded.masteredSkills ?? [],
        skippedSkills: (loaded.skippedSkills ?? []).filter((id) => SKILL_BY_ID.has(id) && !(loaded.masteredSkills ?? []).includes(id)),
        updatedAt: loaded.updatedAt ?? 0,
        skillEvidence: loaded.skillEvidence ?? {},
        skillPlans: legacyPlans,
        skillPlanPages,
        skillLastPracticedAt,
      }
    } catch (e) {
      error.value = String(e)
    } finally {
      initialized.value = true
    }
  }

  function plansFor(skillId: string): SkillLearningPlan[] {
    const pages = profile.value.skillPlanPages[skillId]
    if (pages?.length) return pages
    const legacy = profile.value.skillPlans[skillId]
    return legacy ? [legacy] : []
  }

  function reconcilePlanMastery() {
    const learningSet = new Set(profile.value.learningSkills)
    const masteredSet = new Set(profile.value.masteredSkills)
    const skippedSet = new Set(profile.value.skippedSkills)
    const solved = new Set(profile.value.solvedProblems)
    let changed = true
    while (changed) {
      changed = false
      for (const skill of SKILL_TREE) {
        const plans = plansFor(skill.id)
        if (!plans.length) continue // 保留旧版本中没有题单的历史掌握记录。
        const unlocked = skillPrerequisitesMet(skill, masteredSet, skippedSet)
        // 重复练习不会撤销已经取得的掌握状态：任意一页完整完成即可。
        const complete = plans.some((plan) => plan.problems.length > 0 && plan.problems.every((problem) => solved.has(`${problem.platform}:${problem.id}`)))
        if (unlocked && complete) {
          if (!masteredSet.has(skill.id)) { masteredSet.add(skill.id); changed = true }
          skippedSet.delete(skill.id)
          learningSet.delete(skill.id)
        } else {
          if (masteredSet.delete(skill.id)) changed = true
          if (unlocked) learningSet.add(skill.id)
          else learningSet.delete(skill.id)
        }
      }
    }
    profile.value.learningSkills = [...learningSet]
    profile.value.masteredSkills = [...masteredSet]
    profile.value.skippedSkills = [...skippedSet]
  }

  async function toggleSkillSkipped(skillId: string) {
    if (!SKILL_BY_ID.has(skillId) || mastered.value.has(skillId)) return
    const next = new Set(profile.value.skippedSkills)
    if (next.has(skillId)) next.delete(skillId)
    else next.add(skillId)
    profile.value.skippedSkills = [...next]
    reconcilePlanMastery()
    await persist()
  }

  async function startSkillPlan(skill: SkillNode, problems: SkillPlanProblem[]) {
    if (statusOf(skill) === 'locked') return
    const plan = { skillId: skill.id, generatedAt: Date.now(), problems }
    const pages = [...plansFor(skill.id), plan]
    profile.value.skillPlans = {
      ...profile.value.skillPlans,
      [skill.id]: plan,
    }
    profile.value.skillPlanPages = {
      ...profile.value.skillPlanPages,
      [skill.id]: pages,
    }
    if (!profile.value.learningSkills.includes(skill.id)) profile.value.learningSkills = [...profile.value.learningSkills, skill.id]
    selectedSkillId.value = skill.id
    reconcilePlanMastery()
    await persist()
  }

  function openSkillPlan(skillId: string) { selectedSkillId.value = skillId }
  function closeSkillPlan() { selectedSkillId.value = null }
  function planProgress(skillId: string, pageIndex?: number) {
    const pages = plansFor(skillId)
    const plan = pages[pageIndex ?? Math.max(0, pages.length - 1)]
    if (!plan) return { solved: 0, total: 0 }
    const solved = new Set(profile.value.solvedProblems)
    return { solved: plan.problems.filter((problem) => solved.has(`${problem.platform}:${problem.id}`)).length, total: plan.problems.length }
  }

  function touchSkillsForProblem(problemKey: string, tags: string[] = []) {
    const related = new Set(skillsForTags(tags).map((skill) => skill.id))
    for (const skill of SKILL_TREE) {
      if (plansFor(skill.id).some((plan) => plan.problems.some((problem) => `${problem.platform}:${problem.id}` === problemKey))) related.add(skill.id)
    }
    if (!related.size) return
    const timestamps = { ...profile.value.skillLastPracticedAt }
    const now = Date.now()
    related.forEach((skillId) => { timestamps[skillId] = now })
    profile.value.skillLastPracticedAt = timestamps
  }

  function skillFreshness(skillId: string, now = Date.now()): SkillFreshness {
    const timestamp = profile.value.skillLastPracticedAt[skillId]
    const solved = new Set(profile.value.solvedProblems)
    const practicedProblems = new Set(profile.value.skillEvidence[skillId] ?? [])
    let completedPages = 0
    for (const plan of plansFor(skillId)) {
      let pageComplete = plan.problems.length > 0
      for (const problem of plan.problems) {
        const key = `${problem.platform}:${problem.id}`
        if (solved.has(key)) practicedProblems.add(key)
        else pageComplete = false
      }
      if (pageComplete) completedPages++
    }
    const baseScore = Math.min(100, (mastered.value.has(skillId) ? 50 : 0) + practicedProblems.size * 6 + completedPages * 12)
    if (!timestamp) return { level: 'untracked', days: null, score: baseScore, label: baseScore ? `熟练度 ${baseScore} · 练习时间未知` : '熟练度 0 · 尚无练习记录' }
    const days = Math.max(0, Math.floor((now - timestamp) / DAY_MS))
    const score = Math.max(0, baseScore - Math.max(0, days - 14) * 2)
    const rank = score >= 80 ? '熟练' : score >= 60 ? '较熟练' : score >= 35 ? '巩固中' : score > 0 ? '初练' : '待练习'
    if (days >= REVIEW_AFTER_DAYS) return { level: 'stale', days, score, label: `熟练度 ${score} · ${rank} · 已 ${days} 天未练` }
    if (days >= 14) return { level: 'aging', days, score, label: `熟练度 ${score} · ${rank} · 建议复习` }
    return { level: 'fresh', days, score, label: `熟练度 ${score} · ${rank} · ${days === 0 ? '今天练习过' : `${days} 天前练习`}` }
  }

  async function toggleSolved(problemKey: string) {
    const solved = new Set(profile.value.solvedProblems)
    if (solved.has(problemKey)) solved.delete(problemKey)
    else {
      solved.add(problemKey)
      touchSkillsForProblem(problemKey)
    }
    profile.value.solvedProblems = [...solved]
    reconcilePlanMastery()
    await persist()
  }

  async function markSolved(problemKey: string) {
    if (profile.value.solvedProblems.includes(problemKey)) return
    profile.value.solvedProblems = [...profile.value.solvedProblems, problemKey]
    touchSkillsForProblem(problemKey)
    reconcilePlanMastery()
    await persist()
  }

  async function recordAccepted(problemKey: string, tags: string[]) {
    if (!profile.value.solvedProblems.includes(problemKey)) profile.value.solvedProblems = [...profile.value.solvedProblems, problemKey]
    const evidence = { ...profile.value.skillEvidence }
    for (const skill of skillsForTags(tags)) {
      const keys = new Set(evidence[skill.id] ?? [])
      keys.add(problemKey)
      evidence[skill.id] = [...keys]
    }
    profile.value.skillEvidence = evidence
    touchSkillsForProblem(problemKey, tags)
    reconcilePlanMastery()
    await persist()
  }

  function skillsForTags(tags: string[]): SkillNode[] {
    const tagSet = new Set(tags.map((tag) => tag.toLowerCase()))
    return SKILL_TREE.filter((skill) => skill.tags.some((tag) => tagSet.has(tag.toLowerCase())))
  }

  function knowledgeForTags(tags: string[]): SkillNode[] {
    return skillPrerequisiteClosure(skillsForTags(tags))
  }

  async function analyzeContest() {
    if (!contestUrl.value.trim()) return
    isAnalyzing.value = true
    error.value = null
    try {
      const url = contestUrl.value.trim()
      const command = /https?:\/\/(?:www\.)?luogu\.com\.cn\/contest\/\d+/i.test(url)
        ? 'analyze_contest_luogu'
        : 'analyze_contest_cf'
      const result = await invoke<ContestAnalysis>(command, { contestUrl: url })
      result.problems = result.problems.map((problem) => ({
        ...problem,
        missingSkills: knowledgeForTags(problem.tags).filter((skill) => !mastered.value.has(skill.id)).map((skill) => skill.name),
      }))
      contestAnalysis.value = result
    } catch (e) {
      error.value = String(e)
    } finally {
      isAnalyzing.value = false
    }
  }

  async function analyzeContestProblems(contest: { platform: Problem['platform']; contestId: string; title: string; url: string }, problems: Problem[]) {
    isAnalyzing.value = true
    error.value = null
    try {
      const tags = [...new Set(problems.flatMap((problem) => problem.tags))]
      contestUrl.value = contest.url
      contestAnalysis.value = {
        ...contest,
        tags,
        problems: problems.map((problem) => ({
          id: problem.id,
          title: problem.title,
          rating: problem.rating,
          tags: problem.tags,
          missingSkills: knowledgeForTags(problem.tags).filter((skill) => !mastered.value.has(skill.id)).map((skill) => skill.name),
        })),
      }
    } catch (e) {
      error.value = String(e)
    } finally {
      isAnalyzing.value = false
    }
  }

  return { profile, selectedSkillId, initialized, contestUrl, contestAnalysis, isAnalyzing, error, mastered, skipped, progress, init, statusOf, unmetPrerequisites, plansFor, startSkillPlan, openSkillPlan, closeSkillPlan, planProgress, skillFreshness, toggleSkillSkipped, toggleSolved, markSolved, recordAccepted, skillsForTags, knowledgeForTags, analyzeContest, analyzeContestProblems }
})
