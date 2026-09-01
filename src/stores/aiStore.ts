import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { invoke } from '@tauri-apps/api/core'
import type { AiChatResult, AiMessage, AssistanceLevel, LuoguProblemPage, Platform, SkillNode, SkillPlanProblem } from '../types'
import { useProblemStore } from './problemStore'
import { useLearningStore } from './learningStore'
import { parseChatProblemSetResponse, parseSkillPlanResponse } from '../utils/skillPlan'
import { getDataCenterValue, saveDataCenterValue } from '../dataCenter'

export const useAiStore = defineStore('ai', () => {
  type ModelConfig = { endpoint?: string; model?: string; protocol?: 'responses' | 'chat_completions'; apiKey?: string; rememberApiKey?: boolean }
  type SavedAiConfig = ModelConfig & { version?: number; solution?: ModelConfig; translation?: ModelConfig }
  const saved = getDataCenterValue<SavedAiConfig>('ai-config', {})
  // 旧版本只有一套 AI 配置。升级时将它同时作为两类模型的初始值，避免用户现有配置失效。
  const solutionSaved = saved.solution ?? saved
  const translationSaved = saved.translation ?? saved
  const endpoint = ref(solutionSaved.endpoint ?? 'https://api.openai.com/v1')
  const model = ref(solutionSaved.model ?? '')
  const protocol = ref<'responses' | 'chat_completions'>(solutionSaved.protocol ?? 'responses')
  const rememberApiKey = ref(solutionSaved.rememberApiKey ?? true)
  const apiKey = ref(solutionSaved.apiKey ?? '')
  const translationEndpoint = ref(translationSaved.endpoint ?? 'https://api.openai.com/v1')
  const translationModel = ref(translationSaved.model ?? '')
  const translationProtocol = ref<'responses' | 'chat_completions'>(translationSaved.protocol ?? 'responses')
  const translationRememberApiKey = ref(translationSaved.rememberApiKey ?? true)
  const translationApiKey = ref(translationSaved.apiKey ?? '')
  const assistanceLevel = ref<AssistanceLevel>('hint')
  const messages = ref<AiMessage[]>([])
  const draft = ref('')
  const isSending = ref(false)
  const error = ref<string | null>(null)
  const translations = ref<Record<string, string>>({})
  const isTranslating = ref(false)
  const translationLoads = new Map<string, Promise<string | null>>()
  const isConfigured = computed(() => Boolean(endpoint.value.trim() && model.value.trim() && apiKey.value.trim()))
  const translationConfigured = computed(() => Boolean(translationEndpoint.value.trim() && translationModel.value.trim() && translationApiKey.value.trim()))

  function saveConfig() {
    return saveDataCenterValue('ai-config', {
      version: 2,
      solution: {
        endpoint: endpoint.value,
        model: model.value,
        protocol: protocol.value,
        rememberApiKey: rememberApiKey.value,
        ...(rememberApiKey.value ? { apiKey: apiKey.value } : {}),
      },
      translation: {
        endpoint: translationEndpoint.value,
        model: translationModel.value,
        protocol: translationProtocol.value,
        rememberApiKey: translationRememberApiKey.value,
        ...(translationRememberApiKey.value ? { apiKey: translationApiKey.value } : {}),
      },
    })
  }

  function buildContext(): string {
    const problems = useProblemStore()
    const learning = useLearningStore()
    const problem = problems.currentProblem
    const solved = new Set(learning.profile.solvedProblems)
    const acceptedRatings = problems.submissions
      .filter((submission) => submission.status === 'Accepted')
      .map((submission) => problems.problems.find((candidate) => candidate.id === submission.problemId && (!submission.platform || candidate.platform === submission.platform))?.rating)
      .filter((rating): rating is number => typeof rating === 'number')
    const targetRating = acceptedRatings.length
      ? Math.round(acceptedRatings.reduce((sum, rating) => sum + rating, 0) / acceptedRatings.length / 100) * 100 + 100
      : 1000
    const candidateProblems = problems.problems
      .filter((candidate) => !solved.has(`${candidate.platform}:${candidate.id}`))
      .filter((candidate) => candidate.rating == null || Math.abs(candidate.rating - targetRating) <= 500)
      .sort((a, b) => Math.abs((a.rating ?? targetRating) - targetRating) - Math.abs((b.rating ?? targetRating) - targetRating))
      .slice(0, 60)
      .map((candidate) => ({ id: candidate.id, platform: candidate.platform, title: candidate.title, rating: candidate.rating, tags: candidate.tags, url: candidate.url }))
    return JSON.stringify({
      problem: problem ? { id: problem.id, title: problem.title, rating: problem.rating, tags: problem.tags, description: problem.description, samples: problem.samples } : null,
      contextFileName: problems.contextFileName,
      language: problems.currentLanguage,
      userCode: problems.currentCode,
      recentSubmissions: problems.submissions.slice(0, 20),
      learningProfile: learning.profile,
      recommendation: {
        estimatedNextRating: targetRating,
        masteredSkills: learning.profile.masteredSkills,
        candidateProblems,
        instruction: '推荐具体题目时只从 candidateProblems 中选择，并结合技能树前置关系说明原因。若用户要求生成题单、训练计划、一组练习题或把推荐保存为题单，正常回答后必须追加一个严格格式的 ```acm-problem-set 代码块。块内是 JSON 对象：{"name":"题单名称","problems":[{"platform":"codeforces、luogu或atcoder","id":"题号","title":"标题","rating":难度分,"reason":"推荐原因"}]}。不要在该代码块中加入注释，只选 candidateProblems 中真实存在的题。',
      },
      vpAnalysis: learning.contestAnalysis,
      vpAnalysisError: learning.error,
    }, null, 2)
  }

  async function send() {
    const content = draft.value.trim()
    if (!content || isSending.value) return
    saveConfig()
    messages.value.push({ role: 'user', content, timestamp: Date.now() })
    draft.value = ''
    isSending.value = true
    error.value = null
    try {
      const learning = useLearningStore()
      const contestUrl = content.match(/https?:\/\/(?:www\.)?(?:codeforces\.com\/(?:contest|gym)|luogu\.com\.cn\/contest)\/\d+/i)?.[0]
      if (contestUrl) {
        learning.contestUrl = contestUrl
        await learning.analyzeContest()
      }
      const result = await invoke<AiChatResult>('ai_chat', {
        endpoint: endpoint.value,
        apiKey: apiKey.value,
        model: model.value,
        protocol: protocol.value,
        assistanceLevel: assistanceLevel.value,
        messages: messages.value.map(({ role, content }) => ({ role, content })),
        context: buildContext(),
        previousResponseId: null,
      })
      messages.value.push({
        role: 'assistant',
        content: result.text,
        timestamp: Date.now(),
        problemSet: parseChatProblemSetResponse(result.text) ?? undefined,
      })
    } catch (e) {
      error.value = String(e)
    } finally {
      isSending.value = false
    }
  }

  async function loadCachedTranslation(problemId: string, platform: Platform = 'codeforces'): Promise<string | null> {
    if (platform !== 'codeforces' && platform !== 'atcoder') return null
    const normalizedId = problemId.trim().toUpperCase()
    const key = `${platform}:${normalizedId}`
    if (translations.value[key]) return translations.value[key]
    const pending = translationLoads.get(key)
    if (pending) return pending
    const task = invoke<string | null>('load_oj_translation', { platform, problemId: normalizedId })
      .then((content) => {
        if (content) translations.value[key] = content
        return content
      })
      .finally(() => translationLoads.delete(key))
    translationLoads.set(key, task)
    return task
  }

  async function translateCurrentProblem(force = false) {
    const problems = useProblemStore()
    const problem = problems.currentProblem
    if (!problem || !['codeforces', 'atcoder'].includes(problem.platform)) throw new Error('仅支持翻译 Codeforces 和 AtCoder 英文题面')
    const problemId = problem.id.toUpperCase()
    const key = `${problem.platform}:${problemId}`
    if (!force) {
      if (translations.value[key]) return translations.value[key]
      const cached = await loadCachedTranslation(problemId, problem.platform)
      if (cached) return cached
    }
    if (!translationConfigured.value) throw new Error('请先在顶部“设置 → 翻译模型”中配置模型、API 地址和 API Key')
    isTranslating.value = true
    error.value = null
    try {
      const source = JSON.stringify({
        title: problem.title,
        description: problem.description,
        input: problem.input,
        output: problem.output,
        note: problem.note,
      })
      const result = await invoke<AiChatResult>('ai_chat', {
        endpoint: translationEndpoint.value,
        apiKey: translationApiKey.value,
        model: translationModel.value,
        protocol: translationProtocol.value,
        assistanceLevel: 'full',
        messages: [{ role: 'user', content: `把下面的 ${problem.platform === 'codeforces' ? 'Codeforces' : 'AtCoder'} 英文题面完整翻译为简体中文。输出 Markdown，保留所有数学公式、变量、约束、列表和标题结构；样例输入输出由程序单独显示，不要在译文中重复样例；不要用三反引号或 markdown 代码围栏包裹整篇回复；不要解题，不要添加原文没有的信息。\n\n${source}` }],
        context: '{}',
        previousResponseId: null,
      })
      await invoke('save_oj_translation', { platform: problem.platform, problemId, content: result.text })
      translations.value[key] = result.text
      return result.text
    } finally {
      isTranslating.value = false
    }
  }

  async function generateSkillPlan(skill: SkillNode): Promise<SkillPlanProblem[]> {
    if (!isConfigured.value) throw new Error('请先在顶部“设置”中配置 AI，才能生成学习题单')
    const problemStore = useProblemStore()
    const learningStore = useLearningStore()
    const luoguPage = await invoke<LuoguProblemPage>('fetch_problems_luogu', {
      page: 1,
      keyword: '',
      problemType: '',
      difficulty: null,
      tagNames: skill.tags,
    }).catch(() => null)
    const solved = new Set(learningStore.profile.solvedProblems)
    const previousPlans = learningStore.plansFor(skill.id)
    const previousProblems = previousPlans.flatMap((plan) => plan.problems)
    const previousKeys = new Set(previousProblems.map((problem) => `${problem.platform}:${problem.id.toUpperCase()}`))
    const previousRatings = previousProblems.map((problem) => problem.rating).filter((rating): rating is number => typeof rating === 'number')
    const previousAverageRating = previousRatings.length
      ? Math.round(previousRatings.reduce((sum, rating) => sum + rating, 0) / previousRatings.length)
      : null
    const seen = new Set<string>()
    const skillTags = new Set(skill.tags.map((tag) => tag.toLowerCase()))
    const sortedCandidates = [...problemStore.problems, ...problemStore.importedProblems, ...(luoguPage?.problems ?? [])]
      .filter((problem) => problem.platform === 'codeforces' || problem.platform === 'luogu' || problem.platform === 'atcoder')
      .filter((problem) => !solved.has(`${problem.platform}:${problem.id}`))
      .filter((problem) => {
        const key = `${problem.platform}:${problem.id}`
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })
      .sort((a, b) => {
        const aPrevious = previousKeys.has(`${a.platform}:${a.id.toUpperCase()}`) ? 1 : 0
        const bPrevious = previousKeys.has(`${b.platform}:${b.id.toUpperCase()}`) ? 1 : 0
        const aMatch = a.tags.some((tag) => skillTags.has(tag.toLowerCase())) ? 1 : 0
        const bMatch = b.tags.some((tag) => skillTags.has(tag.toLowerCase())) ? 1 : 0
        return aPrevious - bPrevious || bMatch - aMatch || (a.rating ?? 1200) - (b.rating ?? 1200)
      })
      .map((problem) => ({ platform: problem.platform, id: problem.id, title: problem.title, rating: problem.rating, difficulty: problem.difficulty, tags: problem.tags, url: problem.url, usedBefore: previousKeys.has(`${problem.platform}:${problem.id.toUpperCase()}`) }))
    const cfCandidates = sortedCandidates.filter((problem) => problem.platform === 'codeforces').slice(0, 60)
    const luoguCandidates = sortedCandidates.filter((problem) => problem.platform === 'luogu').slice(0, 60)
    const atcoderCandidates = sortedCandidates.filter((problem) => problem.platform === 'atcoder').slice(0, 60)
    const candidates = Array.from({ length: Math.max(cfCandidates.length, luoguCandidates.length, atcoderCandidates.length) })
      .flatMap((_, index) => [cfCandidates[index], luoguCandidates[index], atcoderCandidates[index]].filter(Boolean))
    if (candidates.length < 8) throw new Error('当前题库候选题不足 8 道，请先加载 Codeforces、洛谷或 AtCoder 题库后重试')

    const candidateMap = new Map(candidates.map((problem) => [`${problem.platform}:${problem.id.toUpperCase()}`, problem]))
    const result = await invoke<AiChatResult>('ai_chat', {
      endpoint: endpoint.value,
      apiKey: apiKey.value,
      model: model.value,
      protocol: protocol.value,
      assistanceLevel: 'full',
      messages: [{
        role: 'user',
        content: `为知识点“${skill.name}”生成第 ${previousPlans.length + 1} 份、约 10 道题的递进练习题单。只能选择候选题中真实存在的题，并兼顾基础巩固、变式和综合应用。新题单应整体比上一份更难、更综合；上一份可量化平均 rating 为 ${previousAverageRating ?? '未知'}。尽量不要选择历史题单中出现过的题（候选中的 usedBefore=true），只有公认经典且确有复习价值时才允许重复，最多重复 1 道，并在 reason 中说明复习原因。尽量混合 Codeforces、洛谷和 AtCoder 的合适题目。只输出 JSON 数组，不要 Markdown 和解释。每项字段必须是 platform、id、title、rating、reason；platform 只能是 codeforces、luogu 或 atcoder。\n\n历史题目：${JSON.stringify(previousProblems.map((problem) => ({ platform: problem.platform, id: problem.id, rating: problem.rating })))}\n\n候选题：${JSON.stringify(candidates)}`,
      }],
      context: JSON.stringify({
        skill: { id: skill.id, name: skill.name, description: skill.description, tags: skill.tags, prerequisites: skill.prerequisites },
        masteredSkills: learningStore.profile.masteredSkills,
        solvedProblems: learningStore.profile.solvedProblems,
        previousSkillPlans: previousPlans,
      }),
      previousResponseId: null,
    })
    const plan = parseSkillPlanResponse(result.text)
      .filter((problem) => candidateMap.has(`${problem.platform}:${problem.id.toUpperCase()}`))
      .map((problem) => {
        const candidate = candidateMap.get(`${problem.platform}:${problem.id.toUpperCase()}`)!
        return { ...problem, title: candidate.title, rating: candidate.rating ?? problem.rating }
      })
      .slice(0, 12)
    if (plan.length < 8) throw new Error(`AI 只返回了 ${plan.length} 道有效候选题，请重试生成`)
    return plan
  }

  function clear() { messages.value = []; error.value = null }
  return { endpoint, model, protocol, apiKey, rememberApiKey, translationEndpoint, translationModel, translationProtocol, translationApiKey, translationRememberApiKey, assistanceLevel, messages, draft, isSending, error, translations, isTranslating, isConfigured, translationConfigured, saveConfig, send, loadCachedTranslation, translateCurrentProblem, generateSkillPlan, clear }
})
