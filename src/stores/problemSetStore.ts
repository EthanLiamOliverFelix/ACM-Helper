import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { invoke } from '@tauri-apps/api/core'
import type { Difficulty, LuoguProblemPage, LuoguTrainingDetail, Problem, QojProblemPage, SkillPlanProblem } from '../types'
import { useProblemStore } from './problemStore'
import { createBatchCatalogLookup, mapInOrderedBatches, normalizeBatchProblemTitle, validateBatchProblemInput, type BatchProblemToken } from '../utils/problemBatch'
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
  contestSource?: { platform: 'codeforces' | 'atcoder' | 'luogu' | 'qoj'; contestId: string; url: string }
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

  function containsContest(platform: string, contestId: string) {
    const normalized = contestId.replace(/^(?:contest|gym):/i, '').toLowerCase()
    return sets.value.some(set => set.contestSource?.platform === platform && set.contestSource.contestId.toLowerCase() === normalized)
  }

  function importContest(contest: { platform: 'codeforces' | 'atcoder' | 'luogu' | 'qoj'; contestId: string; title: string; url: string }, problems: Problem[]) {
    const id = contest.contestId.replace(/^(?:contest|gym):/i, '').toLowerCase()
    const existing = sets.value.find(set => set.contestSource?.platform === contest.platform && set.contestSource.contestId.toLowerCase() === id)
    if (existing) return { set: existing, added: false }
    if (!problems.length) throw new Error('这场比赛没有可加入题单的公开题目')
    const seen = new Set<string>()
    const entries: ProblemSetEntry[] = problems.filter(p => p.platform === contest.platform && !seen.has(p.id) && !!seen.add(p.id)).map(p => ({
      platform: contest.platform, id: p.id, title: p.title, url: p.url, rating: p.rating, tags: [...p.tags], addedAt: Date.now(),
    }))
    if (!entries.length) throw new Error('这场比赛没有可加入题单的公开题目')
    const set: ProblemSet = { id: makeId(), name: contest.title, createdAt: Date.now(), problems: entries,
      contestSource: { platform: contest.platform, contestId: id, url: contest.url } }
    sets.value.push(set)
    save()
    return { set, added: true }
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

  function exportSetEntries(setId = activeSetId.value) {
    return sets.value.find(set => set.id === setId)?.problems.map(problem => ({ title: problem.title ? `${problem.id} ${problem.title}` : problem.id, url: problemUrl(problem) })) ?? []
  }

  function reorderProblem(setId: string, sourceKey: string, targetKey: string, side: 'before' | 'after') {
    const set = sets.value.find(set => set.id === setId)
    if (!set || sourceKey === targetKey) return false
    const key = (problem: ProblemSetEntry) => `${problem.platform}:${problem.id}`
    const source = set.problems.find(problem => key(problem) === sourceKey)
    if (!source || !set.problems.some(problem => key(problem) === targetKey)) return false
    const remaining = set.problems.filter(problem => key(problem) !== sourceKey)
    const insertion = remaining.findIndex(problem => key(problem) === targetKey) + Number(side === 'after')
    remaining.splice(insertion, 0, source)
    set.problems = remaining
    save()
    return true
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

  async function enrichSetMetadata(setId = activeSetId.value, options: { fetchMissing?: boolean } = {}) {
    const set = sets.value.find((candidate) => candidate.id === setId)
    if (!set) return { updated: 0, failed: 0 }
    const problems = useProblemStore()
    const catalog = [...problems.importedProblems, ...problems.problems]
    let updated = 0
    for (const entry of set.problems) {
      const known = catalog.find((problem) => problem.platform === entry.platform && problem.id.toUpperCase() === entry.id.toUpperCase())
      if (known && (known.tags.length || known.rating != null || known.difficulty)) {
        if (applyMetadata(known)) updated++
      }
    }

    if (options.fetchMissing === false) {
      if (updated) save()
      return { updated, failed: 0 }
    }
    const pending = set.problems.filter((entry) => entry.platform !== 'qoj' && !entry.metadataFetchedAt && (!entry.tags.length || (entry.platform === 'luogu' && !entry.difficulty)))
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

  async function resolveProblem(token: BatchProblemToken, findCatalogProblem: (token: BatchProblemToken) => Problem | undefined): Promise<Problem> {
    if (token.url) return invoke<Problem>('import_problem_url', { url: token.url })
    const known = findCatalogProblem(token)
    if (known) return known
    if (token.id && token.platform) {
      const url = token.platform === 'luogu'
        ? `https://www.luogu.com.cn/problem/${token.id}`
        : token.platform === 'atcoder'
          ? `https://atcoder.jp/contests/${token.id.split('_')[0].toLowerCase()}/tasks/${token.id.toLowerCase()}`
          : token.platform === 'qoj' ? qojProblemUrl(token.id) : `https://codeforces.com/problemset/problem/${token.id.match(/^\d+/)?.[0]}/${token.id.replace(/^\d+/, '')}`
      return invoke<Problem>('import_problem_url', { url })
    }
    if (token.query && token.platform === 'qoj') {
      const page = await invoke<QojProblemPage>('fetch_problems_qoj', { page: 1, keyword: token.query })
      const exact = page.problems.filter(problem => normalizeBatchProblemTitle(problem.title) === normalizeBatchProblemTitle(token.query!))
      if (exact.length === 1) return exact[0]
    } else if (token.query && token.platform !== 'codeforces') {
      const page = await invoke<LuoguProblemPage>('fetch_problems_luogu', {
        page: 1,
        keyword: token.query,
        problemType: '',
        difficulty: null,
        tagNames: [],
      })
      const exact = page.problems.filter((problem) => normalizeBatchProblemTitle(problem.title) === normalizeBatchProblemTitle(token.query!))
      if (exact.length === 1) return exact[0]
    }
    throw new Error(`无法唯一识别“${token.raw}”`)
  }

  async function addProblemsBatch(input: string, setId = activeSetId.value) {
    const { tokens, failures } = validateBatchProblemInput(input)
    if (!tokens.length && !failures.length) throw new Error('请输入题目链接、题号或题目名称')
    const total = tokens.length + failures.length
    let added = 0
    let duplicates = 0

    // Let the pending button render before preparing the catalog. URL-only batches
    // do not need a local catalog at all.
    await new Promise<void>(resolve => setTimeout(resolve, 0))
    const store = useProblemStore()
    const findCatalogProblem = tokens.some(token => !token.url)
      ? createBatchCatalogLookup([...store.problems, ...store.importedProblems])
      : () => undefined

    // 网络抓取仍以四个为一组并发，但所有写入都在抓取完成后按输入下标执行，
    // 避免响应较快的后置链接先进入题单。
    const resolved = await mapInOrderedBatches(tokens, 4, token => resolveProblem(token, findCatalogProblem))
    for (let index = 0; index < resolved.length; index++) {
      const result = resolved[index]
      if (result.status === 'rejected') {
        failures.push({ raw: tokens[index].raw, line: tokens[index].line, reason: String(result.reason) })
        continue
      }
      const problem = result.value
      if (problem.platform !== 'codeforces' && problem.platform !== 'luogu' && problem.platform !== 'atcoder' && problem.platform !== 'qoj') {
        failures.push({ raw: tokens[index].raw, line: tokens[index].line, reason: '暂不支持该 OJ' })
        continue
      }
      if (addProblem(problem, setId)) added++
      else duplicates++
    }
    failures.sort((a, b) => a.line - b.line)
    return { total, added, duplicates, failed: failures.map(item => item.raw), failures }
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
    const url = problemUrl(problem)
    if (!url) throw new Error('题号格式无效，无法打开该题')
    await useProblemStore().openRecommendedProblem({ ...problem, url })
  }

  save()
  return { sets, groups, activeSetId, activeSet, createSet, containsContest, importContest, createGroup, renameItem, canMoveItem, moveItem, moveItems, topLevelItemIds, reorderItems, reorderGroup, deleteGroup, exportSetText, exportSetEntries, reorderProblem, deleteSet, deleteSets, reorderSet, addProblem, addProblemUrl, addProblemsBatch, importPlan, importLuoguTraining, enrichSetMetadata, removeProblem, contains, openProblem }
})
