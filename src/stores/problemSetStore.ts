import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { invoke } from '@tauri-apps/api/core'
import type { Difficulty, LuoguProblemPage, LuoguTrainingDetail, Problem, SkillPlanProblem } from '../types'
import { useProblemStore } from './problemStore'
import { mapInOrderedBatches, parseBatchProblemInput, type BatchProblemToken } from '../utils/problemBatch'
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
  parentId?: string | null
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

export interface ProblemSetGroup {
  id: string
  name: string
  parentId: string | null
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
  const groups = ref<ProblemSetGroup[]>(getDataCenterValue('problem-set-groups', []))
  const sets = ref<ProblemSet[]>(initial.length ? initial : [{ id: makeId(), name: '我的题单', createdAt: Date.now(), problems: [] }])
  const activeSetId = ref(sets.value[0].id)
  const activeSet = computed(() => sets.value.find((set) => set.id === activeSetId.value) ?? sets.value[0] ?? null)

  function save() {
    void saveDataCenterValue('problem-sets', sets.value)
    void saveDataCenterValue('problem-set-groups', groups.value)
  }

  function createSet(name: string, parentId: string | null = null) {
    const trimmed = name.trim()
    if (!trimmed) return
    const set = { id: makeId(), name: trimmed, parentId, createdAt: Date.now(), problems: [] }
    sets.value.push(set)
    activeSetId.value = set.id
    save()
  }

  function createGroup(name: string, parentId: string | null = null) {
    if (!name.trim() || (parentId && !groups.value.some(group => group.id === parentId))) return
    const group = { id: makeId(), name: name.trim(), parentId }
    groups.value.push(group)
    save()
    return group.id
  }

  function renameItem(id: string, name: string) {
    const item = groups.value.find(group => group.id === id) ?? sets.value.find(set => set.id === id)
    if (!item || !name.trim()) return
    item.name = name.trim()
    save()
  }

  function canMoveItem(id: string, parentId: string | null) {
    if (!groups.value.some(group => group.id === id) && !sets.value.some(set => set.id === id)) return false
    const visited = new Set<string>([id])
    let parent = parentId
    while (parent) {
      if (visited.has(parent)) return false
      visited.add(parent)
      const group = groups.value.find(group => group.id === parent)
      if (!group) return false
      parent = group.parentId
    }
    return true
  }

  function moveItem(id: string, parentId: string | null) {
    if (!canMoveItem(id, parentId)) return false
    const item = groups.value.find(group => group.id === id) ?? sets.value.find(set => set.id === id)!
    item.parentId = parentId
    save()
    return true
  }

  function topLevelItemIds(ids: string[]) {
    const selected = new Set(ids)
    const items = new Map([...groups.value, ...sets.value].map(item => [item.id, item]))
    return ids.filter(id => {
      const visited = new Set<string>()
      let parent = items.get(id)?.parentId
      if (!items.has(id)) return false
      while (parent && !visited.has(parent)) {
        if (selected.has(parent)) return false
        visited.add(parent)
        parent = items.get(parent)?.parentId
      }
      return true
    })
  }

  function moveItems(ids: string[], parentId: string | null) {
    const roots = topLevelItemIds(ids)
    if (!roots.length || !roots.every(id => canMoveItem(id, parentId))) return false
    const selected = new Set(roots)
    for (const item of [...groups.value, ...sets.value]) if (selected.has(item.id)) item.parentId = parentId
    save()
    return true
  }

  function reorderItems(ids: string[], targetId: string, side: 'before' | 'after') {
    const selected = new Set(ids)
    if (selected.has(targetId)) return false
    const groupTarget = groups.value.find(item => item.id === targetId)
    function reorder<T extends { id: string; parentId?: string | null }>(list: T[]) {
      const target = list.find(item => item.id === targetId)
      const moved = list.filter(item => selected.has(item.id))
      if (!target || !moved.length || moved.length !== selected.size || moved.some(item => (item.parentId ?? null) !== (target.parentId ?? null))) return false
      const remaining = list.filter(item => !selected.has(item.id))
      const insertion = remaining.findIndex(item => item.id === targetId) + Number(side === 'after')
      list.splice(0, list.length, ...remaining.slice(0, insertion), ...moved, ...remaining.slice(insertion))
      save()
      return true
    }
    return groupTarget ? reorder(groups.value) : reorder(sets.value)
  }

  function reorderGroup(id: string, targetId: string, side?: 'before' | 'after') {
    const from = groups.value.findIndex(group => group.id === id)
    const to = groups.value.findIndex(group => group.id === targetId)
    if (from < 0 || to < 0 || from === to || groups.value[from].parentId !== groups.value[to].parentId) return
    const [group] = groups.value.splice(from, 1)
    const insertion = side ? groups.value.findIndex(item => item.id === targetId) + (side === 'after' ? 1 : 0) : to
    groups.value.splice(insertion, 0, group)
    save()
  }

  // 删除容器时将内容移到上一级，保留题单及子组。
  function deleteGroup(id: string) {
    const group = groups.value.find(group => group.id === id)
    if (!group) return
    for (const item of [...groups.value, ...sets.value]) {
      if (item.parentId === id) item.parentId = group.parentId
    }
    groups.value = groups.value.filter(group => group.id !== id)
    save()
  }

  function exportSetText(setId = activeSetId.value) {
    const set = sets.value.find(set => set.id === setId)
    return set ? set.problems.map(problem => `${problem.title || problem.id}\r\n${problemUrl(problem)}`).join('\r\n\r\n') : ''
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

  function reorderSet(sourceId: string, targetId: string, side?: 'before' | 'after') {
    const from = sets.value.findIndex((set) => set.id === sourceId)
    const to = sets.value.findIndex((set) => set.id === targetId)
    if (from < 0 || to < 0 || from === to || (sets.value[from].parentId ?? null) !== (sets.value[to].parentId ?? null)) return
    const [moved] = sets.value.splice(from, 1)
    const insertion = side ? sets.value.findIndex(item => item.id === targetId) + (side === 'after' ? 1 : 0) : to
    sets.value.splice(insertion, 0, moved)
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
    let added = 0
    let duplicates = 0
    const failed: string[] = []

    // 网络抓取仍以四个为一组并发，但所有写入都在抓取完成后按输入下标执行，
    // 避免响应较快的后置链接先进入题单。
    const resolved = await mapInOrderedBatches(tokens, 4, resolveProblem)
    for (let index = 0; index < resolved.length; index++) {
      const result = resolved[index]
      if (result.status === 'rejected') {
        failed.push(tokens[index].raw)
        continue
      }
      const problem = result.value
      if (problem.platform !== 'codeforces' && problem.platform !== 'luogu' && problem.platform !== 'atcoder') {
        failed.push(tokens[index].raw)
        continue
      }
      if (addProblem(problem, setId)) added++
      else duplicates++
    }
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
  return { sets, groups, activeSetId, activeSet, createSet, createGroup, renameItem, canMoveItem, moveItem, moveItems, topLevelItemIds, reorderItems, reorderGroup, deleteGroup, exportSetText, deleteSet, deleteSets, reorderSet, addProblem, addProblemUrl, addProblemsBatch, importPlan, importLuoguTraining, enrichSetMetadata, removeProblem, contains, openProblem }
})
