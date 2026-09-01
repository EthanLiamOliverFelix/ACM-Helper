<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { useProblemSetStore } from '../stores/problemSetStore'
import { useContestFavoriteStore } from '../stores/contestFavoriteStore'
import { useProblemStore } from '../stores/problemStore'
import { useLearningStore } from '../stores/learningStore'
import { usePracticeStore, type PracticeProblem } from '../stores/practiceStore'
import type { ContestAnalysis, ContestCatalogEntry, LuoguTrainingCategory, LuoguTrainingPage, Problem } from '../types'

const sets = useProblemSetStore()
const contests = useContestFavoriteStore()
const problems = useProblemStore()
const learning = useLearningStore()
const practice = usePracticeStore()
const view = ref<'list' | 'detail' | 'smart' | 'plaza' | 'contests' | 'favorites' | 'contest-detail'>('list')
const activeSmartId = ref<'wrongbook' | 'today'>('wrongbook')
const newName = ref('')
const setSearch = ref('')
const problemSearch = ref('')
const problemUrl = ref('')
const batchInput = ref('')
const batchAdding = ref(false)
const notice = ref('')
const error = ref('')
const bulkMode = ref(false)
const selectedSetIds = ref(new Set<string>())
const confirmBulkDelete = ref(false)
const dragId = ref('')
const dragOverId = ref('')
const metadataLoading = ref(false)
const contestUrl = ref('')
const contestSearch = ref('')
const contestCatalog = ref<ContestCatalogEntry[]>([])
const contestCatalogPlatform = ref<'codeforces' | 'atcoder'>('codeforces')
const contestCatalogLoading = ref(false)
const activeContest = ref<{ platform: 'codeforces' | 'luogu' | 'atcoder' | 'qoj'; contestId: string; title: string; url: string } | null>(null)
const contestProblems = ref<Problem[]>([])
const contestProblemsLoading = ref(false)
const contestDetailBack = ref<'contests' | 'favorites'>('contests')
let holdTimer: number | null = null
let holdStart = { x: 0, y: 0 }
let suppressClick = false
let holdPointerId = -1
let lastReorderTarget = ''

const plazaTrainings = ref<LuoguTrainingPage['trainings']>([])
const plazaCategories = ref<LuoguTrainingCategory[]>([])
const plazaCategory = ref('public')
const plazaSearch = ref('')
const plazaPage = ref(1)
const plazaCount = ref(0)
const plazaPerPage = ref(30)
const plazaLoading = ref(false)
const importingTrainingId = ref<number | null>(null)

const filteredSets = computed(() => {
  const query = setSearch.value.trim().toLowerCase()
  return query ? sets.sets.filter((set) => set.name.toLowerCase().includes(query)) : sets.sets
})
const contestSolvedCount = computed(() => contestProblems.value.filter((problem) => learning.profile.solvedProblems.includes(`${problem.platform}:${problem.id}`)).length)
const activeSmartProblems = computed(() => activeSmartId.value === 'today' ? practice.todayProblems : practice.wrongProblems)
const filteredSmartProblems = computed(() => {
  const query = problemSearch.value.trim().toLowerCase()
  const list = activeSmartProblems.value
  return query ? list.filter((problem) => problem.id.toLowerCase().includes(query) || problem.title.toLowerCase().includes(query) || problem.tags.some((tag) => tag.toLowerCase().includes(query))) : list
})
const filteredProblems = computed(() => {
  const query = problemSearch.value.trim().toLowerCase()
  const list = (sets.activeSet?.problems ?? []).filter((problem) => problem.platform !== 'qoj')
  return query ? list.filter((problem) => problem.id.toLowerCase().includes(query) || problem.title.toLowerCase().includes(query) || problem.tags.some((tag) => tag.toLowerCase().includes(query))) : list
})
const visibleActiveSetProblemCount = computed(() => sets.activeSet?.problems.filter((problem) => problem.platform !== 'qoj').length ?? 0)
const solvedCount = computed(() => sets.activeSet?.problems.filter((problem) => problem.platform !== 'qoj' && learning.profile.solvedProblems.includes(`${problem.platform}:${problem.id}`)).length ?? 0)
const plazaPages = computed(() => Math.max(1, Math.ceil(plazaCount.value / plazaPerPage.value)))
const filteredContests = computed(() => {
  const query = contestSearch.value.trim().toLowerCase()
  const visible = contests.favorites.filter((contest) => contest.platform !== 'qoj')
  return query
    ? visible.filter((contest) => contest.title.toLowerCase().includes(query) || contest.contestId.toLowerCase().includes(query) || contest.platform.includes(query))
    : visible
})
const visibleContestCount = computed(() => contests.favorites.filter((contest) => contest.platform !== 'qoj').length)
const filteredContestCatalog = computed(() => {
  const query = contestSearch.value.trim().toLowerCase()
  return contestCatalog.value.filter((contest) => contest.platform === contestCatalogPlatform.value
    && (!query || contest.id.toLowerCase().includes(query) || contest.title.toLowerCase().includes(query)))
})

const contestPlatformLabel = (platform: string) => platform === 'codeforces' ? 'CF' : platform === 'luogu' ? '洛谷' : platform === 'atcoder' ? 'AtCoder' : ''

function flash(message: string) {
  notice.value = message
  window.setTimeout(() => { if (notice.value === message) notice.value = '' }, 2400)
}

function createSet() {
  if (!newName.value.trim()) return
  sets.createSet(newName.value)
  newName.value = ''
  view.value = 'detail'
}

function openSmart(id: 'wrongbook' | 'today') {
  practice.refresh()
  activeSmartId.value = id
  problemSearch.value = ''
  view.value = 'smart'
}

function togglePracticePin(problem: PracticeProblem) {
  practice.togglePinned(problem.practice.key)
  flash(problem.practice.pinned ? '已取消固定保留' : '已固定在错题本中')
}

function snoozePractice(problem: PracticeProblem) {
  practice.snooze(problem.practice.key)
  flash('已推迟 3 天复习')
}

function masterPractice(problem: PracticeProblem) {
  practice.markMastered(problem.practice.key)
  flash('已标记为掌握；再次做错时会自动恢复')
}

function ignorePractice(problem: PracticeProblem) {
  practice.ignore(problem.practice.key)
  flash('已停止推荐这道题')
}

function removePractice(problem: PracticeProblem) {
  if (!window.confirm(`将“${problem.title}”移出错题本？\n以后再次做错时仍会自动重新加入。`)) return
  practice.removeFromWrongbook(problem.practice.key)
  flash('已移出错题本')
}

async function openSet(id: string) {
  if (suppressClick) return
  if (bulkMode.value) return toggleSelected(id)
  error.value = ''
  sets.activeSetId = id
  problemSearch.value = ''
  view.value = 'detail'
  metadataLoading.value = true
  try {
    const result = await sets.enrichSetMetadata(id)
    if (result.updated) flash(`已补全 ${result.updated} 道题目信息`)
    if (result.failed) error.value = `${result.failed} 道题暂时无法从原 OJ 补全信息`
  } finally {
    metadataLoading.value = false
  }
}

function toggleSelected(id: string) {
  const next = new Set(selectedSetIds.value)
  if (next.has(id)) next.delete(id); else next.add(id)
  selectedSetIds.value = next
  confirmBulkDelete.value = false
}

function toggleBulkMode() {
  bulkMode.value = !bulkMode.value
  selectedSetIds.value = new Set()
  confirmBulkDelete.value = false
}

function deleteSelected() {
  if (!selectedSetIds.value.size) return
  if (!confirmBulkDelete.value) { confirmBulkDelete.value = true; return }
  sets.deleteSets([...selectedSetIds.value])
  toggleBulkMode()
}

function clearHold() {
  if (holdTimer) window.clearTimeout(holdTimer)
  holdTimer = null
}

function detachHoldListeners() {
  window.removeEventListener('pointermove', moveHold)
  window.removeEventListener('pointerup', endHold)
  window.removeEventListener('pointercancel', endHold)
}

function beginHold(id: string, event: PointerEvent) {
  if (event.button !== 0) return
  clearHold()
  detachHoldListeners()
  holdPointerId = event.pointerId
  holdStart = { x: event.clientX, y: event.clientY }
  lastReorderTarget = ''
  window.addEventListener('pointermove', moveHold)
  window.addEventListener('pointerup', endHold)
  window.addEventListener('pointercancel', endHold)
  holdTimer = window.setTimeout(() => {
    dragId.value = id
    suppressClick = true
    document.body.classList.add('is-set-dragging')
  }, 360)
}

function moveHold(event: PointerEvent) {
  if (event.pointerId !== holdPointerId) return
  if (!dragId.value) {
    if (Math.hypot(event.clientX - holdStart.x, event.clientY - holdStart.y) > 8) clearHold()
    return
  }
  event.preventDefault()
  const cards = [...document.querySelectorAll<HTMLElement>('[data-set-id]')]
  const targetCard = cards.find((card) => {
    const rect = card.getBoundingClientRect()
    return event.clientY >= rect.top && event.clientY <= rect.bottom
  })
  const target = targetCard?.dataset.setId ?? ''
  dragOverId.value = target && target !== dragId.value ? target : ''
  if (target && target !== dragId.value && target !== lastReorderTarget) {
    sets.reorderSet(dragId.value, target)
    lastReorderTarget = target
  }
}

function endHold(event?: PointerEvent) {
  if (event && holdPointerId >= 0 && event.pointerId !== holdPointerId) return
  clearHold()
  detachHoldListeners()
  holdPointerId = -1
  dragOverId.value = ''
  document.body.classList.remove('is-set-dragging')
  if (!dragId.value) return
  dragId.value = ''
  window.setTimeout(() => { suppressClick = false }, 0)
}

async function addCurrent() {
  error.value = ''
  if (!problems.currentProblem || (problems.currentProblem.platform !== 'codeforces' && problems.currentProblem.platform !== 'luogu')) return
  flash(sets.addProblem(problems.currentProblem) ? '已加入当前题单' : '这道题已经在当前题单中')
}

async function addBatch() {
  if (!batchInput.value.trim() || batchAdding.value) return
  error.value = ''
  batchAdding.value = true
  try {
    const result = await sets.addProblemsBatch(batchInput.value)
    const parts = [`成功添加 ${result.added} 道`]
    if (result.duplicates) parts.push(`${result.duplicates} 道已存在`)
    flash(parts.join('，'))
    if (result.failed.length) error.value = `未识别 ${result.failed.length} 项：${result.failed.join('；')}`
    if (result.added || result.duplicates) batchInput.value = result.failed.join('\n')
  } catch (reason) { error.value = String(reason) }
  finally { batchAdding.value = false }
}

async function fetchPlaza(targetPage = 1) {
  plazaLoading.value = true
  error.value = ''
  try {
    const result = await invoke<LuoguTrainingPage>('fetch_luogu_training_list', { page: targetPage, keyword: plazaSearch.value, category: plazaCategory.value })
    plazaTrainings.value = result.trainings
    plazaCount.value = result.count
    plazaPerPage.value = result.perPage || 30
    if (result.categories.length) plazaCategories.value = result.categories
    plazaPage.value = targetPage
  } catch (reason) { error.value = String(reason) }
  finally { plazaLoading.value = false }
}

async function openPlaza() {
  view.value = 'plaza'
  if (!plazaTrainings.value.length) await fetchPlaza(1)
}

function addContest() {
  if (!contestUrl.value.trim()) return
  error.value = ''
  try {
    if (/https?:\/\/(?:www\.)?qoj\.ac\//i.test(contestUrl.value)) throw new Error('该平台当前未启用')
    const result = contests.addFromUrl(contestUrl.value)
    contestUrl.value = ''
    flash(result.added ? '比赛已收藏' : '这场比赛已经收藏过了')
  } catch (reason) { error.value = String(reason) }
}

async function loadContestCatalog(force = false) {
  if (contestCatalog.value.length && !force) return
  contestCatalogLoading.value = true
  error.value = ''
  try { contestCatalog.value = await invoke<ContestCatalogEntry[]>('fetch_contest_catalog') }
  catch (reason) { error.value = String(reason) }
  finally { contestCatalogLoading.value = false }
}

async function openContestBrowser() {
  view.value = 'contests'
  await loadContestCatalog()
}

function openContestFavorites() {
  contestSearch.value = ''
  view.value = 'favorites'
}

function analysisProblems(analysis: ContestAnalysis): Problem[] {
  return analysis.problems.map((problem) => ({
    id: problem.id,
    title: problem.title,
    rating: problem.rating,
    tags: problem.tags,
    platform: analysis.platform,
    source: analysis.title,
    url: analysis.platform === 'luogu'
      ? `https://www.luogu.com.cn/problem/${problem.id}`
      : `https://codeforces.com/contest/${analysis.contestId}/problem/${problem.id.replace(/^\d+/, '')}`,
  }))
}

async function openContest(contest: { platform: 'codeforces' | 'luogu' | 'atcoder' | 'qoj'; contestId: string; title: string; url: string }) {
  if (contest.platform === 'qoj') return
  contestDetailBack.value = view.value === 'favorites' ? 'favorites' : 'contests'
  activeContest.value = contest
  contestProblems.value = []
  contestProblemsLoading.value = true
  error.value = ''
  view.value = 'contest-detail'
  try {
    if (contest.platform === 'atcoder') {
      if (!problems.problems.some((problem) => problem.platform === 'atcoder')) await problems.fetchAtCoderProblems()
      const prefix = `${contest.contestId.toLowerCase()}_`
      contestProblems.value = problems.problems.filter((problem) => problem.platform === 'atcoder' && problem.id.toLowerCase().startsWith(prefix))
    } else {
      const command = contest.platform === 'luogu' ? 'analyze_contest_luogu' : 'analyze_contest_cf'
      const analysis = await invoke<ContestAnalysis>(command, { contestUrl: contest.url })
      activeContest.value = { ...contest, title: analysis.title }
      contestProblems.value = analysisProblems(analysis)
    }
    if (!contestProblems.value.length) throw new Error('这场比赛暂时没有可读取的公开题目')
  } catch (reason) { error.value = String(reason) }
  finally { contestProblemsLoading.value = false }
}

function favoriteCatalogContest(contest: ContestCatalogEntry) {
  const result = contests.addFromUrl(contest.url, contest.title)
  flash(result.added ? '比赛已收藏' : '这场比赛已经收藏过了')
}

async function openContestProblem(problem: Problem) {
  if (!problem.url || problem.platform === 'local') return
  await problems.openRecommendedProblem({ ...problem, platform: problem.platform, url: problem.url })
}

async function analyzeActiveContest() {
  if (!activeContest.value || !contestProblems.value.length || learning.isAnalyzing) return
  await learning.analyzeContestProblems(activeContest.value, contestProblems.value)
  if (learning.error) error.value = learning.error
  else problems.activeView = 'learning'
}

async function changePlazaCategory(category: string) {
  plazaCategory.value = category
  await fetchPlaza(1)
}

async function importTraining(source: string | number) {
  error.value = ''
  const numericId = typeof source === 'number' ? source : Number(source.match(/\/training\/(\d+)/)?.[1] ?? source.trim())
  importingTrainingId.value = Number.isFinite(numericId) ? numericId : -1
  try {
    const result = await sets.importLuoguTraining(source)
    flash(`${result.updated ? '已同步' : '已导入'} ${result.count} 道题`)
    problemUrl.value = ''
    view.value = 'detail'
    metadataLoading.value = true
    const metadata = await sets.enrichSetMetadata(result.setId)
    if (metadata.updated) flash(`已补全 ${metadata.updated} 道题目信息`)
    if (metadata.failed) error.value = `${metadata.failed} 道题暂时无法从原 OJ 补全信息`
  } catch (reason) { error.value = String(reason) }
  finally { importingTrainingId.value = null; metadataLoading.value = false }
}

onBeforeUnmount(() => { clearHold(); detachHoldListeners(); document.body.classList.remove('is-set-dragging') })
</script>

<template>
  <div class="problem-sets">
    <template v-if="view === 'list'">
      <header class="panel-header">
        <div><strong>我的题单</strong><span>{{ sets.sets.length }} 个普通题单 · 1 个智能错题本</span></div>
        <button @click="toggleBulkMode">{{ bulkMode ? '完成' : '批量管理' }}</button>
      </header>
      <form class="new-set" @submit.prevent="createSet"><input v-model="newName" maxlength="40" placeholder="新建题单名称" /><button :disabled="!newName.trim()">＋ 创建</button></form>
      <div v-if="!bulkMode" class="home-entry-grid">
        <button class="home-entry wrongbook-entry" @click="openSmart('wrongbook')"><span>⌁</span><div><strong>错题本</strong><small>今日 {{ practice.todayProblems.length }} 题 · 共 {{ practice.wrongProblems.length }} 题</small></div><b>{{ practice.wrongProblems.length }}</b></button>
        <button class="home-entry plaza-entry" @click="openPlaza"><span>▤</span><div><strong>洛谷题单广场</strong><small>官方、教材与精选用户题单</small></div><b>›</b></button>
        <button class="home-entry contest-entry" @click="openContestBrowser"><span>◫</span><div><strong>CF / AtCoder 比赛</strong><small>Div、ABC、ARC、AGC 等</small></div><b>›</b></button>
        <button class="home-entry favorite-entry" @click="openContestFavorites"><span>★</span><div><strong>比赛收藏</strong><small>洛谷、CF、AtCoder · {{ visibleContestCount }} 场</small></div><b>›</b></button>
      </div>
      <div v-if="bulkMode" class="bulk-bar"><button @click="selectedSetIds = new Set(filteredSets.map((set) => set.id))">全选</button><span>已选 {{ selectedSetIds.size }} 个 · 点按选择，长按拖动排序</span><button class="danger" :disabled="!selectedSetIds.size" @click="deleteSelected">{{ confirmBulkDelete ? '确认删除' : '删除' }}</button></div>
      <div class="set-grid">
        <button v-for="set in filteredSets" :key="set.id" class="set-card" :class="{ selected: selectedSetIds.has(set.id), dragging: dragId === set.id, 'drag-over': dragOverId === set.id }" :data-set-id="set.id" @click="openSet(set.id)" @pointerdown="beginHold(set.id, $event)" @contextmenu.prevent>
          <i v-if="bulkMode" class="set-card__check">{{ selectedSetIds.has(set.id) ? '✓' : '' }}</i>
          <div><strong>{{ set.name }}</strong><span>{{ set.problems.filter((problem) => problem.platform !== 'qoj').length }} 道 · {{ set.problems.filter((problem) => problem.platform !== 'qoj' && learning.profile.solvedProblems.includes(`${problem.platform}:${problem.id}`)).length }} 已完成</span></div>
          <small v-if="set.source">洛谷 #{{ set.source.trainingId }}</small><small v-else>本地题单</small><em>{{ bulkMode ? '点按选择 · 长按拖动' : '长按拖动排序' }}</em>
        </button>
        <div v-if="!filteredSets.length" class="empty">没有找到对应题单</div>
      </div>
      <footer class="bottom-search"><span>⌕</span><input v-model="setSearch" placeholder="搜索题单名称" /></footer>
    </template>

    <template v-else-if="view === 'smart'">
      <header class="panel-header detail-header"><button class="back" @click="view = 'list'">‹ 返回</button><div><strong>错题本</strong><span>{{ practice.wrongProblems.length }} 道 · 今日复习 {{ practice.todayProblems.length }} 道</span></div><div class="detail-header__actions"><button class="tag-toggle" :class="{ active: problems.showProblemTags }" @click="problems.toggleProblemTags">{{ problems.showProblemTags ? '隐藏算法标签' : '显示算法标签' }}</button></div></header>
      <div class="smart-tabs"><button :class="{ active: activeSmartId === 'wrongbook' }" @click="openSmart('wrongbook')">全部错题 {{ practice.wrongProblems.length }}</button><button :class="{ active: activeSmartId === 'today' }" @click="openSmart('today')">今日复习 {{ practice.todayProblems.length }}</button></div>
      <div class="smart-explanation">
        <template v-if="activeSmartId === 'today'">从仍需复习的错题中按失败次数、到期时间和知识点陈旧程度选取；每天最多 {{ practice.dailyLimit }} 题。</template>
        <template v-else>一次通过的题不会加入。订正后按 1、3、7 天复习，完成三轮后自动归档；再次做错会重新出现。</template>
      </div>
      <div v-if="notice" class="notice">{{ notice }}</div><div v-if="error" class="error">{{ error }}</div>
      <ul class="problem-items practice-items">
        <li v-for="problem in filteredSmartProblems" :key="problem.practice.key" @click="practice.openProblem(problem)">
          <span class="review-state" :class="{ unresolved: problem.practice.unresolved }">{{ problem.practice.unresolved ? '!' : '↻' }}</span>
          <div>
            <small>{{ problem.platform === 'codeforces' ? 'CF' : problem.platform === 'atcoder' ? 'AtCoder' : '洛谷' }} · {{ problem.id }}</small>
            <strong>{{ problem.title }}</strong>
            <p><span v-if="problem.platform === 'luogu' && problem.difficulty">{{ problem.difficulty }}</span><span v-if="problem.rating">★ {{ problem.rating }}</span><template v-if="problems.showProblemTags"><span v-for="tag in problem.tags" :key="tag">{{ tag }}</span></template></p>
            <span class="practice-summary">{{ problem.summary }}</span>
            <span v-if="problem.staleSkills.length" class="stale-skills">久未练习：{{ problem.staleSkills.join('、') }}</span>
            <div class="practice-actions">
              <button :class="{ active: problem.practice.pinned }" @click.stop="togglePracticePin(problem)">{{ problem.practice.pinned ? '取消固定' : '固定保留' }}</button>
              <button @click.stop="snoozePractice(problem)">稍后复习</button>
              <button @click.stop="masterPractice(problem)">已掌握</button>
              <button class="muted" @click.stop="ignorePractice(problem)">不再推荐</button>
              <button class="danger" @click.stop="removePractice(problem)">移出错题本</button>
            </div>
          </div>
        </li>
      </ul>
      <div v-if="!filteredSmartProblems.length" class="empty">{{ activeSmartProblems.length ? '没有找到对应题目' : activeSmartId === 'today' ? '今天没有到期的复习题，保持这个节奏就很好' : '目前没有需要复习的错题' }}</div>
      <button v-if="practice.ignoredCount" class="restore-ignored" @click="practice.restoreIgnored(); flash('已恢复不再推荐的题目')">恢复 {{ practice.ignoredCount }} 道已忽略题目</button>
      <footer class="bottom-search"><span>⌕</span><input v-model="problemSearch" placeholder="搜索题号、名称或知识点" /></footer>
    </template>

    <template v-else-if="view === 'detail' && sets.activeSet">
      <header class="panel-header detail-header"><button class="back" @click="view = 'list'">‹ 返回</button><div><strong>{{ sets.activeSet.name }}</strong></div><div class="detail-header__actions"><button v-if="sets.activeSet.source" :disabled="importingTrainingId != null" @click="importTraining(sets.activeSet.source.trainingId)">同步</button><button class="tag-toggle" :class="{ active: problems.showProblemTags }" @click="problems.toggleProblemTags">{{ problems.showProblemTags ? '隐藏算法标签' : '显示算法标签' }}</button></div></header>
      <div class="detail-progress-label"><span>{{ solvedCount }}/{{ visibleActiveSetProblemCount }} 已完成</span><em v-if="metadataLoading">正在补全题目信息…</em></div>
      <div class="progress"><i :style="{ width: `${visibleActiveSetProblemCount ? solvedCount / visibleActiveSetProblemCount * 100 : 0}%` }" /></div>
      <div v-if="sets.activeSet.source" class="source-info">来自洛谷 #{{ sets.activeSet.source.trainingId }} · {{ sets.activeSet.source.providerName }}</div>
      <div class="add-actions"><button :disabled="!problems.currentProblem || (problems.currentProblem.platform !== 'codeforces' && problems.currentProblem.platform !== 'luogu')" @click="addCurrent">＋ 加入当前题目</button><form @submit.prevent="addBatch"><textarea v-model="batchInput" rows="2" placeholder="批量粘贴链接、题号或题名；空格或换行分隔链接"></textarea><button :disabled="!batchInput.trim() || batchAdding">{{ batchAdding ? '添加中…' : '批量添加' }}</button></form><small>支持 P1000、977A、题目名称，以及“洛谷-P1000/题名”等格式</small></div>
      <div v-if="notice" class="notice">{{ notice }}</div><div v-if="error" class="error">{{ error }}</div>
      <ul class="problem-items">
        <li v-for="problem in filteredProblems" :key="`${problem.platform}:${problem.id}`" @click="sets.openProblem(problem)"><span class="solved">{{ learning.profile.solvedProblems.includes(`${problem.platform}:${problem.id}`) ? '✓' : '' }}</span><div><small>{{ problem.platform === 'codeforces' ? 'CF' : problem.platform === 'atcoder' ? 'AtCoder' : '洛谷' }} · {{ problem.id }}</small><strong>{{ problem.title }}</strong><p><span v-if="problem.platform === 'luogu' && problem.difficulty">{{ problem.difficulty }}</span><span v-if="problem.rating">★ {{ problem.rating }}</span><template v-if="problems.showProblemTags"><span v-for="tag in problem.tags" :key="tag">{{ tag }}</span></template></p></div><button title="从题单移除" @click.stop="sets.removeProblem(sets.activeSet!.id, problem.platform, problem.id)">×</button></li>
      </ul>
      <div v-if="!filteredProblems.length" class="empty">{{ visibleActiveSetProblemCount ? '没有找到对应题目' : '题单中还没有题目' }}</div>
      <footer class="bottom-search"><span>⌕</span><input v-model="problemSearch" placeholder="搜索题号或题目名称" /></footer>
    </template>

    <template v-else-if="view === 'plaza'">
      <header class="panel-header detail-header"><button class="back" @click="view = 'list'">‹ 返回</button><div><strong>洛谷题单广场</strong><span>按需浏览与导入</span></div></header>
      <form class="training-link" @submit.prevent="importTraining(problemUrl)"><input v-model="problemUrl" placeholder="粘贴洛谷题单链接或编号" /><button :disabled="!problemUrl.trim() || importingTrainingId != null">{{ importingTrainingId != null ? '导入中…' : '导入' }}</button></form>
      <div class="categories"><button :class="{ active: plazaCategory === 'public' }" @click="changePlazaCategory('public')">精选分享</button><button v-for="category in plazaCategories" :key="category.key" :class="{ active: plazaCategory === category.key }" @click="changePlazaCategory(category.key)">{{ category.name }}</button></div>
      <div v-if="error" class="error">{{ error }}</div><div v-if="plazaLoading" class="empty">正在读取洛谷题单…</div>
      <ul v-else class="training-items"><li v-for="training in plazaTrainings" :key="training.id"><div><small>#{{ training.id }} · {{ training.providerName }}</small><strong>{{ training.name }}</strong><span><template v-if="training.problemCount">{{ training.problemCount }} 题 · </template>★ {{ training.markCount }} 收藏</span></div><button :disabled="importingTrainingId != null" @click="importTraining(training.id)">{{ importingTrainingId === training.id ? '导入中…' : '导入' }}</button></li></ul>
      <div class="pagination"><button :disabled="plazaPage <= 1 || plazaLoading" @click="fetchPlaza(plazaPage - 1)">‹</button><span>{{ plazaPage }} / {{ plazaPages }}</span><button :disabled="plazaPage >= plazaPages || plazaLoading" @click="fetchPlaza(plazaPage + 1)">›</button></div>
      <footer class="bottom-search"><span>⌕</span><input v-model="plazaSearch" placeholder="搜索洛谷题单名称" @keyup.enter="fetchPlaza(1)" /><button @click="fetchPlaza(1)">搜索</button></footer>
    </template>

    <template v-else-if="view === 'contests'">
      <header class="panel-header detail-header"><button class="back" @click="view = 'list'">‹ 返回</button><div><strong>CF / AtCoder 比赛</strong><span>比赛将以本地题目目录打开</span></div><button :disabled="contestCatalogLoading" @click="loadContestCatalog(true)">{{ contestCatalogLoading ? '更新中…' : '更新' }}</button></header>
      <div v-if="notice" class="notice">{{ notice }}</div><div v-if="error" class="error">{{ error }}</div>
      <div class="contest-tabs"><button :class="{ active: contestCatalogPlatform === 'codeforces' }" @click="contestCatalogPlatform = 'codeforces'">Codeforces Div</button><button :class="{ active: contestCatalogPlatform === 'atcoder' }" @click="contestCatalogPlatform = 'atcoder'">AtCoder</button></div>
      <strong class="contest-section-title">比赛目录</strong>
      <div v-if="contestCatalogLoading && !contestCatalog.length" class="empty">正在读取比赛目录…</div>
      <ul v-else class="contest-items contest-catalog-items">
        <li v-for="contest in filteredContestCatalog" :key="`${contest.platform}:${contest.id}`">
          <button class="contest-open" @click="openContest({ ...contest, contestId: contest.id })"><span>{{ contestPlatformLabel(contest.platform) }}</span><div><strong>{{ contest.title }}</strong><small>{{ contest.id }}</small></div></button>
          <button class="contest-favorite" :class="{ active: contests.contains(contest.platform, contest.id) }" title="收藏比赛" @click="favoriteCatalogContest(contest)">{{ contests.contains(contest.platform, contest.id) ? '★' : '☆' }}</button>
        </li>
      </ul>
      <footer class="bottom-search"><span>⌕</span><input v-model="contestSearch" placeholder="搜索 CF / AtCoder 比赛" /></footer>
    </template>

    <template v-else-if="view === 'favorites'">
      <header class="panel-header detail-header"><button class="back" @click="view = 'list'">‹ 返回</button><div><strong>比赛收藏</strong><span>{{ visibleContestCount }} 场 · 点击进入本地题目目录</span></div></header>
      <form class="contest-link" @submit.prevent="addContest"><input v-model="contestUrl" placeholder="粘贴洛谷 / CF / AtCoder 比赛链接" /><button :disabled="!contestUrl.trim()">＋ 收藏</button></form>
      <div v-if="notice" class="notice">{{ notice }}</div><div v-if="error" class="error">{{ error }}</div>
      <ul class="contest-items">
        <li v-for="contest in filteredContests" :key="contest.id">
          <button class="contest-open" @click="openContest(contest)"><span>{{ contestPlatformLabel(contest.platform) }}</span><div><strong>{{ contest.title }}</strong><small>{{ contest.url }}</small></div></button>
          <button class="contest-remove" title="取消收藏" @click="contests.remove(contest.id)">×</button>
        </li>
      </ul>
      <div v-if="!filteredContests.length" class="empty">{{ visibleContestCount ? '没有找到对应比赛' : '还没有收藏比赛，粘贴比赛链接即可添加' }}</div>
      <footer class="bottom-search"><span>⌕</span><input v-model="contestSearch" placeholder="搜索收藏的比赛" /></footer>
    </template>

    <template v-else-if="view === 'contest-detail' && activeContest">
      <header class="panel-header detail-header"><button class="back" @click="view = contestDetailBack">‹ 返回</button><div><strong>{{ activeContest.title }}</strong><span>{{ contestSolvedCount }}/{{ contestProblems.length }} 道题目 · {{ contestPlatformLabel(activeContest.platform) }}</span></div><div class="detail-header__actions"><button v-if="activeContest.platform !== 'luogu'" :disabled="learning.isAnalyzing || contestProblemsLoading || !contestProblems.length" @click="analyzeActiveContest">{{ learning.isAnalyzing ? '分析中…' : 'VP 分析' }}</button><button :disabled="contests.contains(activeContest.platform, activeContest.contestId)" @click="contests.addFromUrl(activeContest.url, activeContest.title)">{{ contests.contains(activeContest.platform, activeContest.contestId) ? '★ 已收藏' : '☆ 收藏' }}</button></div></header>
      <div v-if="error" class="error">{{ error }}</div><div v-if="contestProblemsLoading" class="empty">正在读取比赛题目…</div>
      <ul v-else class="problem-items contest-problem-items"><li v-for="problem in contestProblems" :key="`${problem.platform}:${problem.id}`" @click="openContestProblem(problem)"><span class="solved">{{ learning.profile.solvedProblems.includes(`${problem.platform}:${problem.id}`) ? '✓' : '' }}</span><div><small>{{ problem.id }}</small><strong>{{ problem.title }}</strong><p><span v-if="problem.rating">★ {{ problem.rating }}</span><template v-if="problems.showProblemTags"><span v-for="tag in problem.tags" :key="tag">{{ tag }}</span></template></p></div><button>打开 ›</button></li></ul>
      <div v-if="!contestProblemsLoading && !contestProblems.length && !error" class="empty">当前比赛没有公开题目</div>
    </template>
  </div>
</template>

<style scoped lang="scss">
.problem-sets { height: 100%; display: flex; flex-direction: column; min-height: 0; color: #ccc; background: #1e1e1e; }
button, input { font: inherit; }.panel-header { display: flex; align-items: center; justify-content: space-between; gap: 7px; padding: 10px; border-bottom: 1px solid #333; div { display: flex; flex-direction: column; min-width: 0; } strong { overflow: hidden; color: #ddd; font-size: 13px; text-overflow: ellipsis; white-space: nowrap; } span { color: #777; font-size: 9px; } button { padding: 4px 7px; border: 1px solid #444; border-radius: 4px; background: #292929; color: #aaa; font-size: 9px; cursor: pointer; &:disabled { opacity: .4; } } }
.detail-header { justify-content: flex-start; > div:not(.detail-header__actions) { flex: 1; } .back { flex: 0 0 auto; color: #9cdcfe; } &__actions { display: flex; flex: 0 0 auto; flex-direction: row !important; gap: 4px; } .tag-toggle.active { border-color: #4d718f; background: #203545; color: #9cdcfe; } }.detail-progress-label { display: flex; align-items: center; justify-content: space-between; padding: 4px 10px 3px; color: #777; font-size: 9px; em { color: #9cdcfe; font-style: normal; } }.new-set, .training-link, .contest-link { display: flex; gap: 5px; padding: 8px 10px; input { min-width: 0; flex: 1; padding: 6px 7px; border: 1px solid #444; border-radius: 4px; background: #252526; color: #ddd; font-size: 10px; outline: none; &:focus { border-color: #569cd6; } } button { padding: 0 9px; border: 0; border-radius: 4px; background: #0e639c; color: white; font-size: 9px; cursor: pointer; &:disabled { opacity: .4; } } }
.home-entry-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin: 0 10px 7px; }.home-entry { display: grid; min-width: 0; grid-template-columns: 20px 1fr auto; align-items: center; gap: 5px; padding: 9px 8px; border: 1px solid #456b5b; border-radius: 6px; background: #20332b; color: #cdebdc; text-align: left; cursor: pointer; > span { color: #4ec982; font-size: 15px; } > div { display: flex; min-width: 0; flex-direction: column; gap: 2px; } strong, small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } strong { font-size: 10px; } small { color: #7fa895; font-size: 7px; } b { color: #4ec982; font-size: 15px; } &:hover { filter: brightness(1.12); } }.plaza-entry { border-color: #4d718f; background: #203545; color: #d7efff; > span, b { color: #9cdcfe; } small { color: #82a9c2; } }.contest-entry { border-color: #536747; background: #283527; color: #d9edcf; > span, b { color: #b5d6a7; } small { color: #8ca781; } }.favorite-entry { border-color: #77672f; background: #37311f; color: #eee1ae; > span, b { color: #dcdcaa; } small { color: #aa9d6d; } }.bulk-bar { display: flex; align-items: center; gap: 7px; padding: 6px 10px; border-block: 1px solid #3a3a3a; background: #252526; font-size: 9px; span { flex: 1; color: #888; } button { padding: 3px 6px; border: 1px solid #444; border-radius: 3px; background: #333; color: #aaa; cursor: pointer; &.danger { border-color: #6a3939; color: #f48771; } &:disabled { opacity: .4; } } }
.set-grid { flex: 1; min-height: 0; overflow-y: auto; padding: 4px 8px 10px; }.set-card { position: relative; display: grid; grid-template-columns: 1fr auto; gap: 6px; width: 100%; margin: 5px 0; padding: 11px; border: 1px solid #383838; border-radius: 6px; background: #252526; color: #ccc; text-align: left; cursor: grab; touch-action: pan-y; div { display: flex; flex-direction: column; gap: 3px; min-width: 0; } strong { overflow: hidden; font-size: 12px; text-overflow: ellipsis; white-space: nowrap; } span, small, em { color: #777; font-size: 9px; font-style: normal; } small { text-align: right; } em { grid-column: 2; text-align: right; } &:hover { border-color: #4d718f; } &.selected { border-color: #569cd6; background: #203545; } &.dragging { opacity: .55; border-color: #dcdcaa; cursor: grabbing; } &.drag-over { border-color: #569cd6; box-shadow: inset 0 2px #569cd6; } }.set-card__check { position: absolute; top: 8px; right: 8px; display: grid; place-items: center; width: 15px; height: 15px; border: 1px solid #569cd6; border-radius: 3px; color: #9cdcfe; font-size: 9px; }
.progress { height: 3px; margin: 0 10px 5px; overflow: hidden; background: #333; i { display: block; height: 100%; background: #36a867; } }.source-info { padding: 2px 10px 6px; color: #777; font-size: 8px; }.add-actions { padding: 5px 9px 7px; > button { width: 100%; padding: 6px; border: 1px solid #4d718f; border-radius: 4px; background: #233544; color: #9cdcfe; font-size: 9px; cursor: pointer; &:disabled { opacity: .4; } } > small { display: block; margin-top: 4px; color: #666; font-size: 8px; line-height: 1.35; } form { display: flex; align-items: stretch; gap: 4px; margin-top: 5px; textarea { min-width: 0; min-height: 39px; max-height: 100px; flex: 1; resize: vertical; padding: 5px 6px; border: 1px solid #444; border-radius: 3px; background: #252526; color: #ddd; font: 9px/1.4 'Segoe UI', sans-serif; outline: none; &:focus { border-color: #569cd6; } } button { flex: 0 0 auto; padding: 0 7px; border: 0; border-radius: 3px; background: #0e639c; color: white; font-size: 9px; cursor: pointer; &:disabled { opacity: .4; } } } }
.problem-items, .training-items { flex: 1; min-height: 0; overflow-y: auto; list-style: none; margin: 0; padding: 0 7px 10px; li { content-visibility: auto; contain-intrinsic-size: 62px; display: flex; align-items: flex-start; gap: 7px; padding: 9px 7px; border-left: 3px solid transparent; border-radius: 4px; &:hover { background: #2a2d2e; border-left-color: #569cd6; } > div { min-width: 0; flex: 1; display: flex; flex-direction: column; gap: 3px; } small { color: #777; font: 8px Consolas, monospace; } strong { overflow: hidden; color: #d2d2d2; font-size: 11px; text-overflow: ellipsis; white-space: nowrap; } p { display: flex; gap: 3px; margin: 0; overflow: hidden; span { flex: 0 0 auto; padding: 1px 4px; border-radius: 3px; background: #373737; color: #9cdcfe; font-size: 8px; } } > button { border: 0; background: transparent; color: #777; cursor: pointer; &:hover { color: #f48771; } } } }.problem-items li { cursor: pointer; }.solved { display: grid; place-items: center; flex: 0 0 14px; width: 14px; height: 14px; margin-top: 2px; border: 1px solid #36b36a; border-radius: 2px; color: #4ec982; font-size: 9px; }
.smart-tabs { display: flex; gap: 4px; padding: 7px 10px 0; button { flex: 1; padding: 5px; border: 1px solid #444; border-radius: 4px; background: #292929; color: #888; font-size: 8px; cursor: pointer; &.active { border-color: #456b5b; background: #20332b; color: #8fe0b5; } } }.smart-explanation { padding: 7px 10px; border-bottom: 1px solid #333; color: #888; font-size: 8px; line-height: 1.5; }.review-state { display: grid; place-items: center; flex: 0 0 16px; width: 16px; height: 16px; margin-top: 2px; border: 1px solid #c9a846; border-radius: 50%; color: #dcdcaa; font-size: 10px; &.unresolved { border-color: #d86758; color: #f48771; } }.practice-summary { color: #c9a846; font-size: 8px; }.stale-skills { color: #ce9178; font-size: 8px; }.practice-actions { display: flex; flex-wrap: wrap; gap: 3px; margin-top: 3px; button { padding: 2px 5px; border: 1px solid #444; border-radius: 3px; background: #2d2d2d; color: #aaa; font-size: 7px; cursor: pointer; &:hover, &.active { border-color: #4d718f; color: #9cdcfe; } &.muted:hover { border-color: #6a4a4a; color: #f48771; } &.danger { border-color: #633b3b; color: #f48771; } } }.restore-ignored { margin: 4px 10px 7px; padding: 5px; border: 1px solid #444; border-radius: 4px; background: #292929; color: #888; font-size: 8px; cursor: pointer; &:hover { color: #bbb; } }
.categories { display: flex; gap: 4px; padding: 2px 9px 7px; overflow-x: auto; button { flex: 0 0 auto; padding: 4px 6px; border: 1px solid #3d3d3d; border-radius: 4px; background: #252526; color: #999; font-size: 8px; cursor: pointer; &.active { border-color: #4d718f; background: #203545; color: #9cdcfe; } } }.training-items li { align-items: center; div > span { color: #777; font-size: 8px; } > button { padding: 5px 8px; border: 1px solid #3b6e90; border-radius: 4px; background: #20394a; color: #9cdcfe; font-size: 9px; &:disabled { opacity: .4; } } }.pagination { display: flex; justify-content: center; align-items: center; gap: 9px; padding: 6px; border-top: 1px solid #333; color: #777; font-size: 9px; button { width: 25px; border: 1px solid #444; border-radius: 3px; background: #292929; color: #bbb; cursor: pointer; &:disabled { opacity: .3; } } }
.contest-items { flex: 1; min-height: 0; overflow-y: auto; list-style: none; margin: 0; padding: 0 8px 10px; li { display: flex; align-items: stretch; gap: 4px; margin: 5px 0; border: 1px solid #383838; border-radius: 6px; background: #252526; &:hover { border-color: #536f85; } }.contest-open { display: grid; min-width: 0; flex: 1; grid-template-columns: 37px 1fr; align-items: center; gap: 8px; padding: 9px; border: 0; background: transparent; color: #ccc; text-align: left; cursor: pointer; > span { display: grid; place-items: center; min-height: 25px; border-radius: 4px; background: #203545; color: #9cdcfe; font-size: 8px; } > div { display: flex; min-width: 0; flex-direction: column; gap: 3px; } strong, small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } strong { font-size: 10px; } small { color: #777; font: 7px Consolas, monospace; } }.contest-remove { width: 28px; border: 0; border-left: 1px solid #383838; background: transparent; color: #777; cursor: pointer; &:hover { color: #f48771; } } }
.contest-tabs { display: flex; gap: 4px; padding: 0 9px 6px; button { flex: 1; padding: 5px; border: 1px solid #444; border-radius: 4px; background: #292929; color: #888; font-size: 8px; cursor: pointer; &.active { border-color: #4d718f; background: #203545; color: #9cdcfe; } } }.contest-section-title { padding: 3px 10px; color: #888; font-size: 8px; }.contest-catalog-items { flex: 1; }.contest-favorite { width: 28px; border: 0; border-left: 1px solid #383838; background: transparent; color: #888; cursor: pointer; &.active { color: #dcdcaa; } }.contest-problem-items { flex: 1; }.contest-problem-items > li > button { color: #75beff; }
.bottom-search { display: flex; align-items: center; gap: 5px; flex: 0 0 auto; padding: 8px 9px; border-top: 1px solid #3c3c3c; background: #252526; color: #777; input { min-width: 0; flex: 1; padding: 6px 7px; border: 1px solid #444; border-radius: 4px; background: #1e1e1e; color: #ddd; font-size: 10px; outline: none; &:focus { border-color: #569cd6; } } button { padding: 5px 8px; border: 0; border-radius: 3px; background: #0e639c; color: white; font-size: 9px; cursor: pointer; } }.notice, .error { padding: 4px 10px; font-size: 9px; }.notice { color: #4ec9b0; }.error { color: #f48771; word-break: break-all; }.empty { padding: 28px 12px; color: #777; text-align: center; font-size: 10px; }
</style>
