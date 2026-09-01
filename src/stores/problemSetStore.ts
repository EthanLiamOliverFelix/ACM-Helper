import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { invoke } from '@tauri-apps/api/core'
import type { Difficulty, LuoguProblemPage, LuoguTrainingDetail, Problem, SkillPlanProblem } from '../types'
import { useProblemStore } from './problemStore'
import { parseBatchProblemInput, type BatchProblemToken } from '../utils/problemBatch'
import { qojProblemUrl } from '../utils/qoj'
import { getDataCenterValue, saveDataCenterValue } from '../dataCenter'

export interface ProblemSetEntry {
  platform: 'codeforces' | 'luogu' | 'atcoder' | 'qoj'
  id: string
  title: string
  url?: string
  rating?: number
  difficulty?: Difficulty
  tags: string[]
  reason?: string
  addedAt: number
  metadataFetchedAt?: number
}

export interface ProblemSet {
  id: string
  name: string
  createdAt: number
  problems: ProblemSetEntry[]
  source?: {
    platform: 'luogu'
    trainingId: number
    url: string
    providerName: string
    syncedAt: number
  }
}

function makeId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

function loadSets(): ProblemSet[] {
  const value = getDataCenterValue<ProblemSet[]>('problem-sets', [])
  if (Array.isArray(value)) return value
  return []
}

export const useProblemSetStore = defineStore('problemSets', () => {
  const initial = loadSets()
  const sets = ref<ProblemSet[]>(initial.length ? initial : [{ id: makeId(), name: '我的题单', createdAt: Date.now(), problems: [] }])
  const activeSetId = ref(sets.value[0].id)
  const activeSet = computed(() => sets.value.find((set) => set.id === activeSetId.value) ?? sets.value[0] ?? null)

  function save() {
    void saveDataCenterValue('problem-sets', sets.value)
  }

  function createSet(name: string) {
    const trimmed = name.trim()
    if (!trimmed) return
    const set = { id: makeId(), name: trimmed, createdAt: Date.now(), problems: [] }
    sets.value.push(set)
    activeSetId.value = set.id
    save()
  }

  function deleteSet(id: string) {
    const index = sets.value.findIndex((set) => set.id === id)
    if (index < 0) return
    sets.value.splice(index, 1)
    if (!sets.value.length) sets.value.push({ id: makeId(), name: '我的题单', createdAt: Date.now(), problems: [] })
    if (!sets.value.some((set) => set.id === activeSetId.value)) {
      activeSetId.value = sets.value[Math.min(index, sets.value.length - 1)].id
    }
    save()
  }

  function deleteSets(ids: string[]) {
    const selected = new Set(ids)
    sets.value = sets.value.filter((set) => !selected.has(set.id))
    if (!sets.value.length) sets.value.push({ id: makeId(), name: '我的题单', createdAt: Date.now(), problems: [] })
    if (!sets.value.some((set) => set.id === activeSetId.value)) activeSetId.value = sets.value[0].id
    save()
  }

  function reorderSet(sourceId: string, targetId: string) {
    const from = sets.value.findIndex((set) => set.id === sourceId)
    const to = sets.value.findIndex((set) => set.id === targetId)
    if (from < 0 || to < 0 || from === to) return
    const [moved] = sets.value.splice(from, 1)
    sets.value.splice(to, 0, moved)
    save()
  }

  function applyMetadata(problem: Problem, fetchedAt = Date.now()) {
    let changed = false
    for (const set of sets.value) {
      for (const entry of set.problems) {
        if (entry.platform !== problem.platform || entry.id.toUpperCase() !== problem.id.toUpperCase()) continue
        const nextTitle = problem.title?.trim() || entry.title
        const nextTags = problem.tags?.length ? [...problem.tags] : entry.tags
        const nextRating = problem.rating ?? entry.rating
        const nextDifficulty = entry.platform === 'luogu' ? (problem.difficulty ?? entry.difficulty) : undefined
        if (entry.title !== nextTitle
          || entry.url !== (problem.url ?? entry.url)
          || entry.rating !== nextRating
          || entry.difficulty !== nextDifficulty
          || JSON.stringify(entry.tags) !== JSON.stringify(nextTags)
          || entry.metadataFetchedAt !== fetchedAt) {
          entry.title = nextTitle
          entry.url = problem.url ?? entry.url
          entry.rating = nextRating
          entry.difficulty = nextDifficulty
          entry.tags = nextTags
          entry.metadataFetchedAt = fetchedAt
          changed = true
        }
      }
    }
    return changed
  }

  function problemUrl(entry: ProblemSetEntry) {
    if (entry.url) return entry.url
    if (entry.platform === 'luogu') return `https://www.luogu.com.cn/problem/${encodeURIComponent(entry.id)}`
    if (entry.platform === 'atcoder') return `https://atcoder.jp/contests/${entry.id.split('_')[0].toLowerCase()}/tasks/${entry.id.toLowerCase()}`
    if (entry.platform === 'qoj') return qojProblemUrl(entry.id)
    const match = entry.id.match(/^(\d+)([A-Za-z][A-Za-z0-9]*)$/)
    return match ? `https://codeforces.com/problemset/problem/${match[1]}/${match[2]}` : ''
  }

  async function enrichSetMetadata(setId = activeSetId.value) {
    const set = sets.value.find((candidate) => candidate.id === setId)
    if (!set) return { updated: 0, failed: 0 }
    const catalog = useProblemStore().problems
    let updated = 0
    for (const entry of set.problems) {
      const known = catalog.find((problem) => problem.platform === entry.platform && problem.id.toUpperCase() === entry.id.toUpperCase())
      if (known && (known.tags.length || known.rating != null || known.difficulty)) {
        if (applyMetadata(known)) updated++
      }
    }

    const pending = set.problems.filter((entry) => !entry.metadataFetchedAt && (!entry.tags.length || (entry.platform === 'luogu' && !entry.difficulty)))
    let cursor = 0
    let failed = 0
    async function worker() {
      while (cursor < pending.length) {
        const entry = pending[cursor++]
        const url = problemUrl(entry)
        if (!url) { failed++; continue }
        try {
          const detail = await invoke<Problem>('import_problem_url', { url })
          if (applyMetadata(detail)) updated++
        } catch {
          failed++
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(4, pending.length) }, () => worker()))
    if (updated) save()
    return { updated, failed }
  }

  function addProblem(problem: Problem, setId = activeSetId.value) {
    if (problem.platform !== 'codeforces' && problem.platform !== 'luogu' && problem.platform !== 'atcoder' && problem.platform !== 'qoj') return false
    const set = sets.value.find((candidate) => candidate.id === setId) ?? activeSet.value
    if (!set) return false
    const exists = set.problems.some((item) => item.platform === problem.platform && item.id.toUpperCase() === problem.id.toUpperCase())
    if (exists) {
      if (applyMetadata(problem)) save()
      return false
    }
    set.problems.push({
      platform: problem.platform,
      id: problem.id,
      title: problem.title,
      url: problem.url,
      rating: problem.rating,
      difficulty: problem.difficulty,
      tags: [...problem.tags],
      addedAt: Date.now(),
      metadataFetchedAt: problem.tags.length || problem.rating != null || problem.difficulty ? Date.now() : undefined,
    })
    save()
    return true
  }

  function importPlan(name: string, problems: SkillPlanProblem[]) {
    const set: ProblemSet = {
      id: makeId(),
      name: name.trim() || `AI 推荐题单 ${new Date().toLocaleDateString()}`,
      createdAt: Date.now(),
      problems: problems.map((problem) => ({
        platform: problem.platform,
        id: problem.id,
        title: problem.title,
        url: problem.url,
        rating: problem.rating,
        tags: [],
        reason: problem.reason,
        addedAt: Date.now(),
      })),
    }
    sets.value.push(set)
    activeSetId.value = set.id
    save()
    return set.id
  }

  async function addProblemUrl(url: string, setId = activeSetId.value) {
    const problem = await invoke<Problem>('import_problem_url', { url: url.trim() })
    if (problem.platform !== 'codeforces' && problem.platform !== 'luogu' && problem.platform !== 'atcoder') {
      throw new Error('题单当前只支持 Codeforces、洛谷和 AtCoder 题目')
    }
    return addProblem(problem, setId)
  }

  function normalized(value: string) {
    return value.trim().toLocaleLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '')
  }

  function findCatalogProblem(token: BatchProblemToken) {
    const store = useProblemStore()
    const catalog = [...store.problems, ...store.importedProblems]
      .filter((problem, index, all) => all.findIndex((item) => item.platform === problem.platform && item.id.toUpperCase() === problem.id.toUpperCase()) === index)
      .filter((problem) => (problem.platform === 'codeforces' || problem.platform === 'luogu' || problem.platform === 'atcoder') && (!token.platform || problem.platform === token.platform))
    if (token.id) return catalog.find((problem) => problem.id.toUpperCase() === token.id!.toUpperCase())
    if (!token.query) return undefined
    const wanted = normalized(token.query)
    const exact = catalog.filter((problem) => normalized(problem.title) === wanted)
    if (exact.length === 1) return exact[0]
    const partial = catalog.filter((problem) => normalized(problem.title).includes(wanted) || wanted.includes(normalized(problem.title)))
    return partial.length === 1 ? partial[0] : undefined
  }

  async function resolveProblem(token: BatchProblemToken): Promise<Problem> {
    if (token.platform === 'qoj' || (token.url && /https?:\/\/(?:www\.)?qoj\.ac\//i.test(token.url))) throw new Error('该平台当前未启用')
    if (token.url) return invoke<Problem>('import_problem_url', { url: token.url })
    const known = findCatalogProblem(token)
    if (known) return known
    if (token.id && token.platform) {
      const url = token.platform === 'luogu'
        ? `https://www.luogu.com.cn/problem/${token.id}`
        : token.platform === 'atcoder'
          ? `https://atcoder.jp/contests/${token.id.split('_')[0].toLowerCase()}/tasks/${token.id.toLowerCase()}`
          : `https://codeforces.com/problemset/problem/${token.id.match(/^\d+/)?.[0]}/${token.id.replace(/^\d+/, '')}`
      return invoke<Problem>('import_problem_url', { url })
    }
    if (token.query && token.platform !== 'codeforces') {
      const page = await invoke<LuoguProblemPage>('fetch_problems_luogu', {
        page: 1,
        keyword: token.query,
        problemType: '',
        difficulty: null,
        tagNames: [],
      })
      const exact = page.problems.filter((problem) => normalized(problem.title) === normalized(token.query!))
      if (exact.length === 1) return exact[0]
      if (page.problems.length === 1) return page.problems[0]
    }
    throw new Error(`无法唯一识别“${token.raw}”`)
  }

  async function addProblemsBatch(input: string, setId = activeSetId.value) {
    const tokens = parseBatchProblemInput(input)
    if (!tokens.length) throw new Error('请输入题目链接、题号或题目名称')
    let cursor = 0
    let added = 0
    let duplicates = 0
    const failed: string[] = []
    async function worker() {
      while (cursor < tokens.length) {
        const token = tokens[cursor++]
        try {
          const problem = await resolveProblem(token)
          if (problem.platform !== 'codeforces' && problem.platform !== 'luogu' && problem.platform !== 'atcoder') throw new Error('暂不支持该平台')
          if (addProblem(problem, setId)) added++
          else duplicates++
        } catch {
          failed.push(token.raw)
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(4, tokens.length) }, () => worker()))
    return { total: tokens.length, added, duplicates, failed }
  }

  async function importLuoguTraining(source: string | number) {
    const detail = await invoke<LuoguTrainingDetail>('fetch_luogu_training_detail', { source: String(source) })
    const existing = sets.value.find((set) => set.source?.platform === 'luogu' && set.source.trainingId === detail.id)
    const entries: ProblemSetEntry[] = detail.problems.map((problem) => ({
      platform: 'luogu',
      id: problem.id,
      title: problem.title,
      url: problem.url,
      difficulty: problem.difficulty,
      tags: [...problem.tags],
      addedAt: Date.now(),
    }))
    if (existing) {
      const oldById = new Map(existing.problems.map((problem) => [problem.id, problem]))
      existing.name = detail.name
      existing.problems = entries.map((entry) => ({ ...entry, addedAt: oldById.get(entry.id)?.addedAt ?? entry.addedAt }))
      existing.source = { platform: 'luogu', trainingId: detail.id, url: `https://www.luogu.com.cn/training/${detail.id}`, providerName: detail.providerName, syncedAt: Date.now() }
      activeSetId.value = existing.id
      save()
      return { setId: existing.id, updated: true, count: entries.length }
    }
    const set: ProblemSet = {
      id: makeId(),
      name: detail.name,
      createdAt: Date.now(),
      problems: entries,
      source: { platform: 'luogu', trainingId: detail.id, url: `https://www.luogu.com.cn/training/${detail.id}`, providerName: detail.providerName, syncedAt: Date.now() },
    }
    sets.value.push(set)
    activeSetId.value = set.id
    save()
    return { setId: set.id, updated: false, count: entries.length }
  }

  function removeProblem(setId: string, platform: 'codeforces' | 'luogu' | 'atcoder' | 'qoj', problemId: string) {
    const set = sets.value.find((candidate) => candidate.id === setId)
    if (!set) return
    set.problems = set.problems.filter((item) => item.platform !== platform || item.id !== problemId)
    save()
  }

  function contains(problem: Problem, setId = activeSetId.value) {
    return Boolean(sets.value.find((set) => set.id === setId)?.problems.some((item) => item.platform === problem.platform && item.id === problem.id))
  }

  async function openProblem(problem: ProblemSetEntry) {
    if (!problem.metadataFetchedAt) await enrichSetMetadata(activeSetId.value)
    const url = problemUrl(problem)
    if (!url) throw new Error('题号格式无效，无法打开该题')
    await useProblemStore().openRecommendedProblem({ ...problem, url })
  }

  save()
  return { sets, activeSetId, activeSet, createSet, deleteSet, deleteSets, reorderSet, addProblem, addProblemUrl, addProblemsBatch, importPlan, importLuoguTraining, enrichSetMetadata, removeProblem, contains, openProblem }
})
