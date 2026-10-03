<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, reactive, ref, watch } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { useProblemSetStore } from '../stores/problemSetStore'
import { useContestFavoriteStore } from '../stores/contestFavoriteStore'
import { useProblemStore } from '../stores/problemStore'
import { useLearningStore } from '../stores/learningStore'
import { usePracticeStore, type PracticeProblem } from '../stores/practiceStore'
import { useWorkbenchStore } from '../stores/workbenchStore'
import { useMultiSelection } from '../composables/useMultiSelection'
import { createDragGhost } from '../composables/dragGhost'
import '@vscode/codicons/dist/codicon.css'
import type { ContestAnalysis, ContestCatalogEntry, LuoguTrainingCategory, LuoguTrainingPage, Problem } from '../types'

const sets = useProblemSetStore()
const contests = useContestFavoriteStore()
const problems = useProblemStore()
const learning = useLearningStore()
const practice = usePracticeStore()
const workbench = useWorkbenchStore()
const view = ref<'list' | 'detail' | 'smart' | 'plaza' | 'contests' | 'favorites' | 'contest-detail'>('list')
const activeSmartId = ref<'wrongbook' | 'today'>('wrongbook')
const setSearch = ref('')
const setPage = ref(1)
const setPageSize = 12
const currentGroupId = ref<string | null>(null)
const nativeDragId = ref('')
const dragItemIds = ref(new Set<string>())
const collectionRoot = ref<HTMLElement | null>(null)
const dropPreview = ref<{ id: string | null; kind: 'into' | 'before' | 'after' } | null>(null)
let dragGhost: ReturnType<typeof createDragGhost> | null = null
const exporting = ref(false)
const editingSet = ref(false)
const exportMenuOpen = ref(false)
function dismissSetExport(event: MouseEvent) {
  if (!(event.target as Element).closest('.set-export')) exportMenuOpen.value = false
}
const problemListElement = ref<HTMLUListElement | null>(null)
const movingProblemKey = ref('')
const problemDrop = ref<{ key: string; side: 'before' | 'after' } | null>(null)
let problemGhost: ReturnType<typeof createDragGhost> | null = null
let problemPointerId = -1
const difficultyColors: Record<string, string> = {
  '暂无评定': 'var(--color-tone-bfbfbf)', '入门': 'var(--color-tone-fe4c61)', '普及-': 'var(--color-tone-f39c11)', '普及': 'var(--color-tone-ffc116)',
  '普及+/提高-': 'var(--color-tone-52c41a)', '提高': 'var(--color-tone-13c2c2)', '提高+/省选-': 'var(--color-tone-3498db)',
  '省选/NOI-': 'var(--color-tone-9d3dcf)', 'NOI/NOI+/CTS': 'var(--color-tone-7187d8)',
}
function stopProblemMove() {
  window.removeEventListener('pointermove', moveProblem)
  window.removeEventListener('pointerup', finishProblemMove)
  window.removeEventListener('pointercancel', stopProblemMove)
  window.removeEventListener('blur', stopProblemMove)
  window.removeEventListener('keydown', escapeProblemMove)
  problemGhost?.remove()
  problemGhost = null
  movingProblemKey.value = ''
  problemDrop.value = null
  problemPointerId = -1
}
function escapeProblemMove(event: KeyboardEvent) { if (event.key === 'Escape') stopProblemMove() }
function beginProblemMove(key: string, event: PointerEvent) {
  if (!editingSet.value || event.button !== 0) return
  stopProblemMove()
  const row = (event.currentTarget as HTMLElement).closest<HTMLElement>('[data-problem-key]')
  if (!row) return
  event.preventDefault()
  problemPointerId = event.pointerId
  movingProblemKey.value = key
  problemGhost = createDragGhost(row, event.clientX, event.clientY)
  window.addEventListener('pointermove', moveProblem)
  window.addEventListener('pointerup', finishProblemMove)
  window.addEventListener('pointercancel', stopProblemMove)
  window.addEventListener('blur', stopProblemMove)
  window.addEventListener('keydown', escapeProblemMove)
}
function moveProblem(event: PointerEvent) {
  if (event.pointerId !== problemPointerId) return
  event.preventDefault()
  problemGhost?.move(event.clientX, event.clientY)
  problemDrop.value = null
  const list = problemListElement.value
  if (!list) return
  const bounds = list.getBoundingClientRect()
  if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) return
  if (event.clientY < bounds.top + 24) list.scrollTop -= 16
  if (event.clientY > bounds.bottom - 24) list.scrollTop += 16
  const row = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-problem-key]')
  if (!row || !list.contains(row) || row.dataset.problemKey === movingProblemKey.value) return
  const rect = row.getBoundingClientRect()
  problemDrop.value = { key: row.dataset.problemKey!, side: event.clientY < rect.top + rect.height / 2 ? 'before' : 'after' }
}
function finishProblemMove(event: PointerEvent) {
  if (event.pointerId !== problemPointerId) return
  moveProblem(event)
  if (editingSet.value && sets.activeSet && problemDrop.value) sets.reorderProblem(sets.activeSet.id, movingProblemKey.value, problemDrop.value.key, problemDrop.value.side)
  stopProblemMove()
}
function moveProblemByKeyboard(key: string, direction: -1 | 1) {
  if (!editingSet.value || !sets.activeSet) return
  const index = filteredProblems.value.findIndex(problem => `${problem.platform}:${problem.id}` === key)
  const target = filteredProblems.value[index + direction]
  if (target) sets.reorderProblem(sets.activeSet.id, key, `${target.platform}:${target.id}`, direction === -1 ? 'before' : 'after')
}
const itemDialog = reactive({ mode: '' as '' | 'set' | 'group' | 'rename' | 'move', id: '', name: '', parentId: '' })
const itemMenu = ref<{ id: string | null; left: number; top: number } | null>(null)
const menuElement = ref<HTMLElement | null>(null)
const menuItem = computed(() => itemMenu.value?.id
  ? sets.groups.find(group => group.id === itemMenu.value!.id) ?? sets.sets.find(set => set.id === itemMenu.value!.id)
  : null)
const menuIsGroup = computed(() => sets.groups.some(group => group.id === itemMenu.value?.id))
const setStats = computed(() => new Map(sets.sets.map(set => {
  const visible = set.problems.filter(problem => problem.platform !== 'qoj')
  const solved = visible.filter(problem => learning.profile.solvedProblems.includes(`${problem.platform}:${problem.id}`)).length
  return [set.id, { total: visible.length, solved, percent: visible.length ? solved / visible.length * 100 : 0 }]
})))

function openItemMenu(event: MouseEvent, id: string | null = null) {
  if (itemMenu.value?.id === id) { itemMenu.value = null; return }
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
  itemMenu.value = { id, left: Math.max(8, Math.min(rect.right - 160, window.innerWidth - 168)), top: Math.max(8, Math.min(rect.bottom + 4, window.innerHeight - (id ? 132 : 92))) }
  void nextTick(() => menuElement.value?.querySelector<HTMLButtonElement>('button')?.focus())
}

function openCreate(mode: 'set' | 'group') {
  itemMenu.value = null
  Object.assign(itemDialog, { mode, name: '' })
}
const currentGroup = computed(() => sets.groups.find(group => group.id === currentGroupId.value))
const groupPath = computed(() => {
  const path = []
  const visited = new Set<string>()
  let id = currentGroupId.value
  while (id && !visited.has(id)) {
    visited.add(id)
    const group = sets.groups.find(group => group.id === id)
    if (!group) break
    path.unshift(group)
    id = group.parentId
  }
  return path
})
const visibleGroups = computed(() => sets.groups.filter(group => (group.parentId ?? null) === currentGroupId.value
  && group.name.toLowerCase().includes(setSearch.value.trim().toLowerCase())))
const moveTargets = computed(() => sets.groups.filter(group => sets.canMoveItem(itemDialog.id, group.id)))

function groupLabel(id: string) {
  const names: string[] = []
  const visited = new Set<string>()
  let next: string | null = id
  while (next && !visited.has(next)) {
    visited.add(next)
    const group = sets.groups.find(group => group.id === next)
    if (!group) break
    names.unshift(group.name)
    next = group.parentId
  }
  return names.join(' / ')
}

function enterGroup(id: string | null) {
  if (suppressClick) return
  currentGroupId.value = id
  setSearch.value = ''
  setPage.value = 1
  selection.clear()
  confirmBulkDelete.value = false
}

function editItem(mode: 'rename' | 'move', id: string, name: string, parentId?: string | null) {
  itemMenu.value = null
  Object.assign(itemDialog, { mode, id, name, parentId: parentId ?? '' })
}

function submitItemDialog() {
  if (itemDialog.mode === 'set') createSet()
  else if (itemDialog.mode === 'group') sets.createGroup(itemDialog.name, currentGroupId.value)
  else if (itemDialog.mode === 'rename') sets.renameItem(itemDialog.id, itemDialog.name)
  else if (!sets.moveItem(itemDialog.id, itemDialog.parentId || null)) {
    error.value = '无法移动到该组，组不能放入自身或子组中'
    return
  }
  itemDialog.mode = ''
}

function removeGroup(id: string) {
  itemMenu.value = null
  const parentId = sets.groups.find(group => group.id === id)?.parentId ?? null
  sets.deleteGroup(id)
  if (currentGroupId.value === id) enterGroup(parentId)
  flash('已删除组，内容已移到上一级')
}

function startItemDrag(id: string, event: DragEvent) {
  // Keep an in-progress pointer gesture; starting a second native drag would
  // cancel its pointer stream and remove the floating preview.
  if (holdCandidate) {
    event.preventDefault()
    activateHold()
    return
  }
  endHold()
  prepareCollectionDrag(id)
  nativeDragId.value = id
  event.dataTransfer?.setData('text/plain', id)
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
}

function previewDrop(event: MouseEvent) {
  dropPreview.value = null
  const sourceId = nativeDragId.value || dragId.value
  if (!sourceId) return
  const sources = [...dragItemIds.value]
  const canEnter = (parentId: string | null) => sources.length > 0 && sources.every(id => sets.canMoveItem(id, parentId))
  const canReorder = (targetId: string) => {
    const target = sets.groups.find(item => item.id === targetId) ?? sets.sets.find(item => item.id === targetId)
    const groupTarget = sets.groups.some(item => item.id === targetId)
    return !!target && sources.every(id => {
      const source = sets.groups.find(item => item.id === id) ?? sets.sets.find(item => item.id === id)
      return source && sets.groups.some(item => item.id === id) === groupTarget && (source.parentId ?? null) === (target.parentId ?? null)
    })
  }
  const element = document.elementFromPoint(event.clientX, event.clientY)
  if (!element || !collectionRoot.value?.contains(element)) return
  const breadcrumb = element.closest<HTMLElement>('[data-group-target]')
  if (breadcrumb) {
    const id = breadcrumb.dataset.groupTarget || null
    if (canEnter(id)) dropPreview.value = { id, kind: 'into' }
    return
  }
  let row = element.closest<HTMLElement>('[data-group-id], [data-set-id]')
  // The small gap between rows also belongs to the nearest insertion boundary.
  if (!row && element.closest('.set-grid')) {
    const rows = [...collectionRoot.value.querySelectorAll<HTMLElement>('[data-group-id], [data-set-id]')]
    row = rows.reduce<HTMLElement | null>((nearest, candidate) => {
      const distance = (item: HTMLElement) => {
        const rect = item.getBoundingClientRect()
        return Math.min(Math.abs(event.clientY - rect.top), Math.abs(event.clientY - rect.bottom))
      }
      return !nearest || distance(candidate) < distance(nearest) ? candidate : nearest
    }, null)
  }
  if (!row) return
  const id = row.dataset.groupId || row.dataset.setId!
  if (dragItemIds.value.has(id)) return
  const rect = row.getBoundingClientRect()
  const sourceGroup = sets.groups.find(group => group.id === sourceId)
  if (row.dataset.groupId) {
    const edge = event.clientY < rect.top + 12 || event.clientY > rect.bottom - 12
    if (!edge && canEnter(id)) dropPreview.value = { id, kind: 'into' }
    else if (edge && sourceGroup && canReorder(id)) dropPreview.value = { id, kind: event.clientY < rect.top + 12 ? 'before' : 'after' }
    // Groups stay above sets. At a group boundary a set can move to the start of the set list.
    else if (edge && !sourceGroup) {
      const first = pagedSets.value.find(set => !dragItemIds.value.has(set.id))
      if (first && !dragItemIds.value.has(first.id) && canReorder(first.id)) dropPreview.value = { id: first.id, kind: 'before' }
    }
  } else if (!sourceGroup && canReorder(id)) dropPreview.value = { id, kind: event.clientY < rect.top + rect.height / 2 ? 'before' : 'after' }
}

function dropClasses(id: string) {
  return {
    'drop-into': dropPreview.value?.id === id && dropPreview.value.kind === 'into',
    'drop-before': dropPreview.value?.id === id && dropPreview.value.kind === 'before',
    'drop-after': dropPreview.value?.id === id && dropPreview.value.kind === 'after',
  }
}

function applyDrop(sourceId: string) {
  const preview = dropPreview.value
  if (!preview) return
  const ids = dragItemIds.value.size ? [...dragItemIds.value] : [sourceId]
  if (preview.kind === 'into') {
    if (sets.moveItems(ids, preview.id)) { selection.clear(); flash(`已移动 ${ids.length} 项`) }
  } else if (preview.id) sets.reorderItems(ids, preview.id, preview.kind)
}

function finishNativeDrop(event: DragEvent) {
  previewDrop(event)
  if (nativeDragId.value) applyDrop(nativeDragId.value)
  endNativeDrag()
}

function endNativeDrag() {
  nativeDragId.value = ''
  dragItemIds.value = new Set()
  dropPreview.value = null
}

function leaveCollection(event: DragEvent) {
  if (!(event.relatedTarget instanceof Node) || !collectionRoot.value?.contains(event.relatedTarget)) dropPreview.value = null
}

async function exportActiveSet(destination: 'clipboard' | 'word') {
  if (!editingSet.value || !sets.activeSet || exporting.value) return
  exportMenuOpen.value = false
  exporting.value = true
  error.value = ''
  const activeSet = sets.activeSet
  try {
    const content = sets.exportSetText()
    if (destination === 'clipboard') {
      await navigator.clipboard.writeText(content)
      flash(`已复制题单全部 ${activeSet.problems.length} 道题目的名称和链接`)
    } else {
      const path = await invoke<string | null>('export_problem_set_word', { name: activeSet.name, entries: sets.exportSetEntries(activeSet.id) })
      if (path) flash(`已保存到 ${path}`)
    }
  } catch (reason) { error.value = `导出失败：${String(reason)}` }
  finally { exporting.value = false }
}
const problemSearch = ref('')
const problemUrl = ref('')
const batchInput = ref('')
const batchAdding = ref(false)
const notice = ref('')
const error = ref('')
const bulkMode = ref(false)
const confirmBulkDelete = ref(false)
const dragId = ref('')
const metadataLoading = ref(false)
const contestUrl = ref('')
const contestSearch = ref('')
const contestPage = ref(1)
const contestPageSize = 30
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
let holdCandidate: { id: string; element: HTMLElement } | null = null

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
  const children = sets.sets.filter(set => (set.parentId ?? null) === currentGroupId.value)
  return query ? children.filter((set) => set.name.toLowerCase().includes(query)) : children
})
const setPages = computed(() => Math.max(1, Math.ceil(filteredSets.value.length / setPageSize)))
const pagedSets = computed(() => {
  const start = (setPage.value - 1) * setPageSize
  return filteredSets.value.slice(start, start + setPageSize)
})
const selection = useMultiSelection(() => [...visibleGroups.value, ...pagedSets.value].map(item => item.id), () => [...sets.groups, ...sets.sets].map(item => item.id))
const selectedSetIds = computed(() => selection.selected)
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
const contestPages = computed(() => Math.max(1, Math.ceil(filteredContestCatalog.value.length / contestPageSize)))
const pagedContestCatalog = computed(() => {
  const start = (contestPage.value - 1) * contestPageSize
  return filteredContestCatalog.value.slice(start, start + contestPageSize)
})
const contestProgressByKey = computed(() => {
  const result = new Map<string, { solved: number; total: number }>()
  const solved = new Set(learning.profile.solvedProblems.map(key => key.toLowerCase()))
  for (const problem of problems.problems) {
    let contestId = ''
    if (problem.platform === 'codeforces') contestId = problem.id.match(/^(\d+)[A-Za-z]/)?.[1] ?? ''
    else if (problem.platform === 'atcoder') contestId = problem.id.split('_')[0]?.toLowerCase() ?? ''
    else continue
    if (!contestId) continue
    const key = `${problem.platform}:${contestId}`
    const progress = result.get(key) ?? { solved: 0, total: 0 }
    progress.total++
    if (solved.has(`${problem.platform}:${problem.id}`.toLowerCase())) progress.solved++
    result.set(key, progress)
  }
  return result
})

const contestPlatformLabel = (platform: string) => platform === 'codeforces' ? 'CF' : platform === 'luogu' ? '洛谷' : platform === 'atcoder' ? 'AtCoder' : ''
const contestProgress = (contest: ContestCatalogEntry) => contestProgressByKey.value.get(`${contest.platform}:${contest.id.toLowerCase()}`) ?? { solved: 0, total: 0 }

function flash(message: string) {
  notice.value = message
  window.setTimeout(() => { if (notice.value === message) notice.value = '' }, 2400)
}

function createSet() {
  if (!itemDialog.name.trim()) return
  sets.createSet(itemDialog.name, currentGroupId.value)
  setPage.value = setPages.value
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
  if (bulkMode.value) return selection.click(id, {}, true)
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

function clickCollection(id: string, event: MouseEvent, group = false) {
  if (suppressClick) return
  if (bulkMode.value || event.ctrlKey || event.metaKey || event.shiftKey) {
    bulkMode.value = true
    selection.click(id, event, true)
    confirmBulkDelete.value = false
    return
  }
  selection.click(id)
  if (group) enterGroup(id); else void openSet(id)
}
function checkCollection(id: string, event: MouseEvent) {
  selection.click(id, event, true)
  confirmBulkDelete.value = false
}
function prepareCollectionDrag(id: string) {
  if (!selection.selected.has(id)) selection.replace([id])
  const ordered = [...sets.groups, ...sets.sets].filter(item => selection.selected.has(item.id)).map(item => item.id)
  dragItemIds.value = new Set(sets.topLevelItemIds(ordered))
}

function toggleBulkMode() {
  bulkMode.value = !bulkMode.value
  selection.clear()
  confirmBulkDelete.value = false
}

function deleteSelected() {
  if (!selectedSetIds.value.size) return
  if (!confirmBulkDelete.value) { confirmBulkDelete.value = true; return }
  const ids = [...selectedSetIds.value]
  sets.deleteSets(ids.filter(id => sets.sets.some(set => set.id === id)))
  ids.filter(id => sets.groups.some(group => group.id === id)).forEach(id => sets.deleteGroup(id))
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
  window.removeEventListener('blur', cancelHold)
  window.removeEventListener('keydown', escapeHold)
}

function cancelHold() { endHold(); endNativeDrag() }
function escapeHold(event: KeyboardEvent) { if (event.key === 'Escape') cancelHold() }

function beginHold(id: string, event: PointerEvent) {
  if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey) return
  endHold()
  holdPointerId = event.pointerId
  holdStart = { x: event.clientX, y: event.clientY }
  const row = (event.target as HTMLElement).closest<HTMLElement>('.collection-row')
  holdCandidate = row ? { id, element: row } : null
  dropPreview.value = null
  window.addEventListener('pointermove', moveHold)
  window.addEventListener('pointerup', endHold)
  window.addEventListener('pointercancel', endHold)
  window.addEventListener('blur', cancelHold)
  window.addEventListener('keydown', escapeHold)
  holdTimer = window.setTimeout(activateHold, 360)
}

function activateHold() {
  clearHold()
  if (!holdCandidate || dragId.value) return
  prepareCollectionDrag(holdCandidate.id)
  dragId.value = holdCandidate.id
  suppressClick = true
  dragGhost = createDragGhost(holdCandidate.element, holdStart.x, holdStart.y, dragItemIds.value.size)
  document.body.classList.add('is-set-dragging')
}

function beginItemMove(id: string, event: PointerEvent) {
  if (event.button !== 0) return
  beginHold(id, event)
  activateHold()
  event.preventDefault()
}

function moveHold(event: PointerEvent) {
  if (event.pointerId !== holdPointerId) return
  if (!dragId.value) {
    if (Math.hypot(event.clientX - holdStart.x, event.clientY - holdStart.y) > 8) activateHold()
    if (!dragId.value) return
  }
  event.preventDefault()
  dragGhost?.move(event.clientX, event.clientY)
  previewDrop(event)
}

function endHold(event?: PointerEvent) {
  if (event && holdPointerId >= 0 && event.pointerId !== holdPointerId) return
  clearHold()
  detachHoldListeners()
  holdPointerId = -1
  holdCandidate = null
  dragGhost?.remove()
  dragGhost = null
  document.body.classList.remove('is-set-dragging')
  if (dragId.value && event?.type === 'pointerup') {
    previewDrop(event)
    applyDrop(dragId.value)
  }
  dropPreview.value = null
  dragItemIds.value = new Set()
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
  contestPage.value = 1
  const tasks: Promise<unknown>[] = [loadContestCatalog()]
  if (!problems.problems.some(problem => problem.platform === 'codeforces')) tasks.push(problems.fetchProblems())
  if (!problems.problems.some(problem => problem.platform === 'atcoder')) tasks.push(problems.fetchAtCoderProblems())
  await Promise.allSettled(tasks)
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
  workbench.openCurrentCode()
}

async function openPracticeProblem(problem: PracticeProblem) {
  await practice.openProblem(problem)
  workbench.openCurrentCode()
}

async function openSetProblem(problem: Parameters<typeof sets.openProblem>[0]) {
  await sets.openProblem(problem)
  workbench.openCurrentCode()
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

onBeforeUnmount(() => { endHold(); endNativeDrag(); stopProblemMove() })
watch([view, () => sets.activeSetId], () => { editingSet.value = false; exportMenuOpen.value = false; stopProblemMove() })
watch(editingSet, value => { if (!value) { exportMenuOpen.value = false; stopProblemMove() } })

watch(setSearch, () => { setPage.value = 1 })
watch(setPages, (pages) => { setPage.value = Math.min(setPage.value, pages) })
watch([contestSearch, contestCatalogPlatform], () => { contestPage.value = 1 })
watch(contestPages, (pages) => { contestPage.value = Math.min(contestPage.value, pages) })
watch([view, currentGroupId, bulkMode], () => { itemMenu.value = null })
watch(() => itemDialog.mode, mode => {
  if (mode) void nextTick(() => document.querySelector<HTMLElement>('.item-dialog input, .item-dialog select')?.focus())
})
</script>

<template>
  <div ref="collectionRoot" class="problem-sets" @dragleave="leaveCollection" @click="dismissSetExport">
    <template v-if="view === 'list'">
      <header class="panel-header collection-header">
        <div><strong>我的题单 <small>{{ sets.sets.length }}</small></strong></div>
        <div class="collection-header__actions"><button class="manage-button" :class="{ active: bulkMode }" @click="toggleBulkMode">{{ bulkMode ? '完成' : '管理' }}</button><button class="create-button" :aria-expanded="itemMenu?.id === null" aria-haspopup="menu" @click="openItemMenu($event)">＋ 新建</button></div>
      </header>
      <div class="collection-pathbar">
        <button v-if="currentGroup" class="row-tool" title="返回上一级" aria-label="返回上一级" @click="enterGroup(currentGroup.parentId)"><i aria-hidden="true" class="codicon codicon-arrow-left" /></button>
        <nav class="group-path" aria-label="题单分组路径">
          <button data-group-target="" :class="{ current: !currentGroup, 'drop-into': dropPreview?.kind === 'into' && dropPreview.id === null }" @click="enterGroup(null)" @dragover.stop.prevent="previewDrop" @drop.stop.prevent="finishNativeDrop">全部题单</button>
          <template v-for="group in groupPath" :key="group.id"><span>›</span><button :title="group.name" :class="{ current: group.id === currentGroupId, ...dropClasses(group.id) }" :data-group-target="group.id" @click="enterGroup(group.id)" @dragover.stop.prevent="previewDrop" @drop.stop.prevent="finishNativeDrop">{{ group.name }}</button></template>
        </nav>
        <button v-if="currentGroup" class="row-tool" :aria-label="`管理组 ${currentGroup.name}`" title="管理当前组" aria-haspopup="menu" @click="openItemMenu($event, currentGroup.id)"><i aria-hidden="true" class="codicon codicon-ellipsis" /></button>
      </div>
      <div v-if="!bulkMode && !currentGroupId" class="home-entry-grid">
        <button class="home-entry wrongbook-entry" :title="`错题本：今日复习 ${practice.todayProblems.length} 题，共 ${practice.wrongProblems.length} 题`" @click="openSmart('wrongbook')"><i aria-hidden="true" class="codicon codicon-notebook" /><strong>错题本</strong><small v-if="practice.todayProblems.length">今日 {{ practice.todayProblems.length }}</small></button>
        <button class="home-entry plaza-entry" title="洛谷题单广场：官方、教材与精选用户题单" @click="openPlaza"><i aria-hidden="true" class="codicon codicon-library" /><strong>洛谷题单广场</strong></button>
        <button class="home-entry contest-entry" title="Codeforces / AtCoder 比赛目录" @click="openContestBrowser"><i aria-hidden="true" class="codicon codicon-calendar" /><strong>比赛目录</strong></button>
        <button class="home-entry favorite-entry" :title="`比赛收藏：${visibleContestCount} 场`" @click="openContestFavorites"><i aria-hidden="true" class="codicon codicon-star-full" /><strong>比赛收藏</strong><small v-if="visibleContestCount">{{ visibleContestCount }}</small></button>
      </div>
      <div v-if="bulkMode" class="bulk-bar"><button :disabled="!selection.scope.length" @click="selection.toggleAll(); confirmBulkDelete = false">{{ selection.allSelected ? '取消全选' : '全选' }}</button><span>已选 {{ selectedSetIds.size }} 项</span><button class="danger" :disabled="!selectedSetIds.size" @click="deleteSelected">{{ confirmBulkDelete ? '确认删除（保留组内未选内容）' : '删除' }}</button></div>
      <div v-if="notice" class="notice">{{ notice }}</div><div v-if="error" class="error">{{ error }}</div>
      <div class="set-grid" @dragover.stop.prevent="previewDrop" @drop.stop.prevent="finishNativeDrop">
        <div v-for="group in visibleGroups" :key="group.id" :data-group-id="group.id" class="collection-row group-row" :class="{ selected: selectedSetIds.has(group.id), dragging: dragItemIds.has(group.id), ...dropClasses(group.id) }" draggable="true" @dragstart="startItemDrag(group.id, $event)" @dragend="endNativeDrag" @dragover.stop.prevent="previewDrop" @drop.stop.prevent="finishNativeDrop" @contextmenu.prevent="openItemMenu($event, group.id)">
          <button class="row-tool drag-handle" title="拖动组：放入其他组或拖到路径移至上级" :aria-label="`拖动组 ${group.name}`" @pointerdown.stop="beginItemMove(group.id, $event)" @click.stop.prevent><i aria-hidden="true" class="codicon codicon-gripper" /></button>
          <input v-if="bulkMode" class="collection-checkbox" type="checkbox" :checked="selectedSetIds.has(group.id)" :aria-label="`选择 ${group.name}`" @pointerdown.stop @dragstart.stop.prevent @click.stop="checkCollection(group.id, $event)" />
          <button class="row-open" :title="group.name" @pointerdown="beginHold(group.id, $event)" @click="clickCollection(group.id, $event, true)"><i aria-hidden="true" class="row-icon codicon codicon-folder" /><span class="row-copy"><strong>{{ group.name }}</strong><small>{{ sets.sets.filter(set => set.parentId === group.id).length }} 个题单 · {{ sets.groups.filter(child => child.parentId === group.id).length }} 个子组</small></span><i aria-hidden="true" class="row-chevron codicon codicon-chevron-right" /></button>
          <button class="row-tool more-button" :aria-label="`管理组 ${group.name}`" title="更多操作" aria-haspopup="menu" @click="openItemMenu($event, group.id)"><i aria-hidden="true" class="codicon codicon-ellipsis" /></button>
        </div>
        <div v-for="set in pagedSets" :key="set.id" class="collection-row set-row" :class="{ selected: selectedSetIds.has(set.id), dragging: dragItemIds.has(set.id), ...dropClasses(set.id) }" :data-set-id="set.id" draggable="true" @dragstart="startItemDrag(set.id, $event)" @dragend="endNativeDrag" @dragover.stop.prevent="previewDrop" @drop.stop.prevent="finishNativeDrop" @contextmenu.prevent="openItemMenu($event, set.id)">
          <button class="row-tool drag-handle" title="拖动题单：排序或放入组" :aria-label="`拖动题单 ${set.name}`" @pointerdown.stop="beginItemMove(set.id, $event)" @click.stop.prevent><i aria-hidden="true" class="codicon codicon-gripper" /></button>
          <input v-if="bulkMode" class="collection-checkbox" type="checkbox" :checked="selectedSetIds.has(set.id)" :aria-label="`选择 ${set.name}`" @pointerdown.stop @dragstart.stop.prevent @click.stop="checkCollection(set.id, $event)" />
          <button class="row-open" :title="set.name" :aria-pressed="bulkMode ? selectedSetIds.has(set.id) : undefined" @click="clickCollection(set.id, $event)" @pointerdown="beginHold(set.id, $event)">
            <i class="row-icon codicon codicon-list-unordered" />
            <span class="row-copy"><strong>{{ set.name }}</strong><small>{{ setStats.get(set.id)?.total }} 道题 <span class="meta-dot">·</span> {{ setStats.get(set.id)?.solved }} 已完成 <span v-if="set.source" class="source-badge" :title="`洛谷题单 #${set.source.trainingId}`">洛谷</span></small></span>
            <span v-if="setStats.get(set.id)?.solved" class="row-progress" :title="`已完成 ${Math.round(setStats.get(set.id)?.percent ?? 0)}%`"><i :style="{ width: `${setStats.get(set.id)?.percent}%` }" /></span>
          </button>
          <button v-if="!bulkMode" class="row-tool more-button" :aria-label="`管理题单 ${set.name}`" title="更多操作" aria-haspopup="menu" @click="openItemMenu($event, set.id)"><i aria-hidden="true" class="codicon codicon-ellipsis" /></button>
        </div>
        <div v-if="!filteredSets.length && !visibleGroups.length" class="empty">{{ setSearch ? '没有找到对应题单或组' : '此组为空，可以新建或拖入题单、组' }}</div>
      </div>
      <div v-if="setPages > 1" class="pagination set-pagination">
        <button :disabled="setPage <= 1" title="上一页" @click="setPage--">‹</button>
        <span>{{ setPage }} / {{ setPages }} · 每页 {{ setPageSize }} 个</span>
        <button :disabled="setPage >= setPages" title="下一页" @click="setPage++">›</button>
      </div>
      <footer class="bottom-search collection-search"><i aria-hidden="true" class="codicon codicon-search" /><input v-model="setSearch" placeholder="搜索题单或组…" aria-label="搜索题单或组" /></footer>
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
        <li v-for="problem in filteredSmartProblems" :key="problem.practice.key" @click="openPracticeProblem(problem)">
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
      <header class="panel-header detail-header"><button class="back" @click="view = 'list'">‹ 返回</button><div><strong>{{ sets.activeSet.name }}</strong></div><div class="detail-header__actions"><button v-if="sets.activeSet.source" :disabled="importingTrainingId != null" @click="importTraining(sets.activeSet.source.trainingId)">同步</button><button class="tag-toggle" :class="{ active: problems.showProblemTags }" @click="problems.toggleProblemTags">{{ problems.showProblemTags ? '隐藏算法标签' : '显示算法标签' }}</button><button class="edit-set" :class="{ active: editingSet }" :aria-pressed="editingSet" :disabled="batchAdding || exporting" @click="editingSet = !editingSet">{{ editingSet ? '完成编辑' : '编辑' }}</button></div></header>
      <div v-if="editingSet" class="set-edit-toolbar">
        <span class="editing-status">编辑中</span>
        <details class="set-export" :open="exportMenuOpen" @toggle="exportMenuOpen = ($event.currentTarget as HTMLDetailsElement).open" @keydown.esc="exportMenuOpen = false">
          <summary :aria-disabled="exporting || !sets.activeSet.problems.length" @click.prevent="exportMenuOpen = !exporting && !!sets.activeSet.problems.length && !exportMenuOpen">{{ exporting ? '导出中…' : '导出' }}</summary>
          <div class="set-export__menu"><button :disabled="exporting || !sets.activeSet.problems.length" @click="exportActiveSet('clipboard')">复制题目名称和链接</button><button :disabled="exporting || !sets.activeSet.problems.length" @click="exportActiveSet('word')">导出为 Word</button></div>
        </details>
      </div>
      <div class="detail-progress-label"><span>{{ solvedCount }}/{{ visibleActiveSetProblemCount }} 已完成</span><em v-if="metadataLoading">正在补全题目信息…</em></div>
      <div class="progress"><i :style="{ width: `${visibleActiveSetProblemCount ? solvedCount / visibleActiveSetProblemCount * 100 : 0}%` }" /></div>
      <div v-if="sets.activeSet.source" class="source-info">来自洛谷 #{{ sets.activeSet.source.trainingId }} · {{ sets.activeSet.source.providerName }}</div>
      <div v-if="editingSet" class="add-actions"><button :disabled="!problems.currentProblem || (problems.currentProblem.platform !== 'codeforces' && problems.currentProblem.platform !== 'luogu')" @click="addCurrent">＋ 加入当前题目</button><form @submit.prevent="addBatch"><textarea v-model="batchInput" rows="2" placeholder="批量粘贴链接、题号或题名；空格或换行分隔链接"></textarea><button :disabled="!batchInput.trim() || batchAdding">{{ batchAdding ? '添加中…' : '批量添加' }}</button></form><small>支持 P1000、977A、题目名称，以及“洛谷-P1000/题名”等格式</small></div>
      <div v-if="notice" class="notice">{{ notice }}</div><div v-if="error" class="error">{{ error }}</div>
      <ul ref="problemListElement" class="problem-items set-problem-items">
        <li v-for="problem in filteredProblems" :key="`${problem.platform}:${problem.id}`" :data-problem-key="`${problem.platform}:${problem.id}`" :class="{ moving: movingProblemKey === `${problem.platform}:${problem.id}`, 'drop-before': problemDrop?.key === `${problem.platform}:${problem.id}` && problemDrop.side === 'before', 'drop-after': problemDrop?.key === `${problem.platform}:${problem.id}` && problemDrop.side === 'after' }">
          <div class="set-problem-line">
            <button v-if="editingSet" class="problem-grip" :aria-label="`调整 ${problem.id} 的顺序`" title="拖动排序，也可使用上下方向键" @pointerdown.stop="beginProblemMove(`${problem.platform}:${problem.id}`, $event)" @keydown.up.prevent="moveProblemByKeyboard(`${problem.platform}:${problem.id}`, -1)" @keydown.down.prevent="moveProblemByKeyboard(`${problem.platform}:${problem.id}`, 1)"><i class="codicon codicon-menu" aria-hidden="true" /></button>
            <span v-if="learning.profile.solvedProblems.includes(`${problem.platform}:${problem.id}`)" class="set-problem-solved" title="已完成">✓</span>
            <button class="set-problem-name" :title="`${problem.id} ${problem.title}`" @click="openSetProblem(problem)"><small>{{ problem.platform === 'codeforces' ? 'CF' : problem.platform === 'atcoder' ? 'ATC' : problem.platform === 'luogu' ? '洛谷' : 'QOJ' }} · {{ problem.id }}</small><strong>{{ problem.title }}</strong></button>
            <span v-if="problem.platform === 'luogu' && problem.difficulty" class="set-problem-difficulty" :style="{ backgroundColor: difficultyColors[problem.difficulty] }">{{ problem.difficulty }}</span>
            <span v-else-if="problem.rating" class="set-problem-rating">★ {{ problem.rating }}</span>
            <button v-if="editingSet" class="problem-remove" :aria-label="`从题单移除 ${problem.id}`" title="从题单移除" @click="sets.removeProblem(sets.activeSet!.id, problem.platform, problem.id)">×</button>
          </div>
          <div v-if="problems.showProblemTags && problem.tags.length" class="set-problem-tags"><span v-for="tag in problem.tags" :key="tag">{{ tag }}</span></div>
        </li>
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
      <ul v-else :key="`${contestCatalogPlatform}:${contestPage}:${contestSearch}`" class="contest-items contest-catalog-items">
        <li v-for="contest in pagedContestCatalog" :key="`${contest.platform}:${contest.id}`">
          <button class="contest-open" @click="openContest({ ...contest, contestId: contest.id })"><span>{{ contestPlatformLabel(contest.platform) }}</span><div><strong>{{ contest.title }}</strong><small><span>{{ contest.id }}</span><em :class="{ complete: contestProgress(contest).total > 0 && contestProgress(contest).solved === contestProgress(contest).total }">已做 {{ contestProgress(contest).solved }}/{{ contestProgress(contest).total }}</em></small></div></button>
          <button class="contest-favorite" :class="{ active: contests.contains(contest.platform, contest.id) }" title="收藏比赛" @click="favoriteCatalogContest(contest)">{{ contests.contains(contest.platform, contest.id) ? '★' : '☆' }}</button>
        </li>
      </ul>
      <div v-if="contestPages > 1" class="pagination contest-pagination"><button :disabled="contestPage <= 1" @click="contestPage--">‹</button><span>{{ contestPage }} / {{ contestPages }}</span><button :disabled="contestPage >= contestPages" @click="contestPage++">›</button></div>
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
    <div v-if="itemDialog.mode" class="item-dialog" @click.self="itemDialog.mode = ''" @keydown.esc="itemDialog.mode = ''">
      <form @submit.prevent="submitItemDialog">
        <strong>{{ itemDialog.mode === 'set' ? '新建题单' : itemDialog.mode === 'group' ? '新建组' : itemDialog.mode === 'rename' ? '重命名' : `移动「${itemDialog.name}」` }}</strong>
        <label v-if="itemDialog.mode !== 'move'">名称<input v-model="itemDialog.name" autofocus maxlength="80" placeholder="输入名称" /></label>
        <label v-else>目标组<select v-model="itemDialog.parentId"><option value="">全部题单（根目录）</option><option v-for="group in moveTargets" :key="group.id" :value="group.id">{{ groupLabel(group.id) }}</option></select></label>
        <p v-if="itemDialog.mode === 'set' || itemDialog.mode === 'group'" class="dialog-location">创建位置：{{ currentGroup ? groupLabel(currentGroup.id) : '全部题单' }}</p>
        <div class="group-tools"><button type="button" @click="itemDialog.mode = ''">取消</button><button :disabled="itemDialog.mode !== 'move' && !itemDialog.name.trim()">确定</button></div>
      </form>
    </div>
    <Teleport to="body">
      <div v-if="itemMenu" class="collection-menu-layer" @click.self="itemMenu = null" @contextmenu.prevent="itemMenu = null" @keydown.esc.stop="itemMenu = null">
        <div ref="menuElement" class="collection-menu" role="menu" aria-label="题单与组操作" :style="{ left: `${itemMenu.left}px`, top: `${itemMenu.top}px` }">
          <template v-if="itemMenu.id === null">
            <button role="menuitem" @click="openCreate('set')"><i aria-hidden="true" class="codicon codicon-list-unordered" />新建题单</button>
            <button role="menuitem" @click="openCreate('group')"><i aria-hidden="true" class="codicon codicon-new-folder" />新建组</button>
          </template>
          <template v-else-if="menuItem">
            <button role="menuitem" @click="editItem('rename', menuItem.id, menuItem.name)"><i aria-hidden="true" class="codicon codicon-edit" />重命名</button>
            <button role="menuitem" @click="editItem('move', menuItem.id, menuItem.name, menuItem.parentId)"><i aria-hidden="true" class="codicon codicon-arrow-right" />移动到…</button>
            <button v-if="menuIsGroup" class="danger" role="menuitem" title="组内题单和子组将移至上一级" @click="removeGroup(menuItem.id)"><i aria-hidden="true" class="codicon codicon-trash" />删除组</button>
          </template>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped lang="scss">
.collection-header { padding: 10px 12px; flex: 0 0 auto; strong { display: flex; align-items: center; gap: 7px; font-size: 14px; } strong small { padding: 1px 5px; border-radius: 4px; background: var(--color-bg-subtle); color: var(--color-text-faint); font-size: 10px; font-weight: 500; } .collection-header__actions { flex-direction: row; align-items: center; gap: 4px; } .manage-button { border-color: transparent; background: transparent; color: var(--color-text-muted); } .create-button { border-color: var(--color-accent-border); background: var(--color-accent-surface); color: var(--color-accent-text); } button:hover, .manage-button.active { background: var(--color-bg-hover); color: var(--color-text-strong); } }
.collection-pathbar { display: flex; align-items: center; min-height: 32px; padding: 0 9px; flex: 0 0 auto; gap: 3px; }
.group-path { display: flex; flex: 1; min-width: 0; align-items: center; gap: 3px; overflow-x: auto; scrollbar-width: thin; font-size: 11px; button { flex: 0 0 auto; max-width: 140px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding: 4px 3px; border: 0; border-radius: 3px; background: transparent; color: var(--color-text-faint); cursor: pointer; &:hover { color: var(--color-accent-text); background: var(--color-bg-hover); } &.current { color: var(--color-text-secondary); font-weight: 600; } } > span { color: var(--color-text-disabled); } }
.home-entry-grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 4px; margin: 0 10px 8px; padding-bottom: 9px; border-bottom: 1px solid var(--color-border-soft); flex: 0 0 auto; }
.home-entry { display: flex; align-items: center; min-width: 0; gap: 7px; padding: 7px 8px; border: 1px solid transparent; border-radius: 5px; background: var(--color-bg-panel); color: var(--color-text-secondary); text-align: left; cursor: pointer; > i { flex: 0 0 auto; font-size: 14px; color: var(--color-accent-text); } strong { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 11px; font-weight: 500; } small { margin-left: auto; flex: 0 0 auto; color: var(--color-text-faint); font-size: 9px; } &:hover { border-color: var(--color-border-control); background: var(--color-bg-hover); } }
.wrongbook-entry > i { color: var(--color-success); }.favorite-entry > i { color: var(--color-warning); }
.set-grid { flex: 1; min-height: 0; overflow-y: auto; padding: 0 7px 8px; }
.collection-row { position: relative; display: flex; align-items: center; gap: 1px; min-width: 0; min-height: 50px; box-sizing: border-box; margin: 2px 0; padding: 0 3px; border: 1px solid transparent; border-radius: 5px; color: var(--color-text-secondary); transition: background .12s, border-color .12s; &:hover, &:focus-within { background: var(--color-bg-hover); .row-tool { color: var(--color-text-muted); } } &.selected { background: var(--color-accent-surface); border-color: var(--color-accent-border); } &.dragging { opacity: .5; border-color: var(--color-accent-border); } &.drop-into { background: var(--color-accent-surface-hover); border-color: var(--color-accent); box-shadow: inset 0 0 0 1px var(--color-accent); .row-icon, .row-chevron { color: var(--color-accent-text); } } &.drop-before::before, &.drop-after::after { content: ""; position: absolute; z-index: 3; left: 0; right: 0; height: 3px; border-radius: 2px; background: var(--color-accent); box-shadow: 0 0 7px var(--color-accent); pointer-events: none; } &.drop-before::before { top: -3px; } &.drop-after::after { bottom: -3px; } }
.row-tool { display: grid; place-items: center; flex: 0 0 24px; width: 24px; height: 26px; padding: 0; border: 0; border-radius: 4px; background: transparent; color: var(--color-text-faint); cursor: pointer; > i { font-size: 15px; } &:hover { background: var(--color-bg-subtle); color: var(--color-text-strong) !important; } &:focus-visible { outline: 1px solid var(--color-accent); outline-offset: -1px; } }
.drag-handle { flex-basis: 16px; width: 16px; color: var(--color-text-disabled); cursor: grab; touch-action: none; &:active { cursor: grabbing; } > i { font-size: 13px; } }
.more-button { color: var(--color-text-faint); }
.row-open { display: flex; flex: 1; min-width: 0; align-items: center; gap: 9px; align-self: stretch; padding: 7px 3px; border: 0; background: transparent; color: inherit; text-align: left; cursor: pointer; &:focus-visible { outline: 1px solid var(--color-accent); border-radius: 3px; } }
.row-icon { flex: 0 0 auto; font-size: 17px; color: var(--color-accent-text); }.group-row .row-icon { color: var(--color-warning); }
.row-copy { display: flex; flex: 1; min-width: 0; flex-direction: column; gap: 4px; strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; font-weight: 500; color: var(--color-text-strong); } small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 10px; color: var(--color-text-faint); } }.meta-dot { margin: 0 2px; color: var(--color-text-disabled); }
.source-badge { margin-left: 5px; padding: 0 4px; border-radius: 3px; background: var(--color-bg-subtle); font-size: 9px; }
.row-chevron { color: var(--color-text-faint); font-size: 12px; }.row-progress { flex: 0 0 28px; height: 3px; overflow: hidden; border-radius: 3px; background: var(--color-bg-subtle); > i { display: block; height: 100%; border-radius: inherit; background: var(--color-success); } }
.row-checkbox { display: grid; place-items: center; flex: 0 0 14px; height: 14px; border: 1px solid var(--color-border-control); border-radius: 3px; font-size: 11px; color: var(--color-accent-text); }.selected .row-checkbox { border-color: var(--color-accent); background: var(--color-accent-surface); }
.bulk-bar { display: flex; align-items: center; gap: 6px; padding: 6px 10px; border-block: 1px solid var(--color-border-soft); background: var(--color-bg-panel); font-size: 11px; > span { flex: 1; color: var(--color-text-faint); } button { padding: 4px 7px; border: 1px solid var(--color-border-control); border-radius: 4px; background: transparent; color: var(--color-text-secondary); cursor: pointer; &.danger { color: var(--color-danger); } &:disabled { opacity: .4; } } }
.collection-search { margin-top: auto; > i { font-size: 13px; } input { border-color: transparent !important; background: transparent !important; font-size: 11px !important; &:focus { border-color: var(--color-accent-border) !important; } } }
.collection-menu-layer { position: fixed; inset: 0; z-index: 1940; }
.collection-menu { position: fixed; width: 160px; padding: 4px; box-sizing: border-box; border: 1px solid var(--color-border-control); border-radius: 6px; background: var(--color-bg-panel); box-shadow: 0 6px 20px var(--color-overlay); button { display: flex; align-items: center; gap: 9px; width: 100%; padding: 8px 9px; border: 0; border-radius: 3px; background: transparent; color: var(--color-text-secondary); font: 12px var(--font-ui); text-align: left; cursor: pointer; &:hover, &:focus-visible { outline: none; background: var(--color-bg-hover); color: var(--color-text-strong); } &.danger { color: var(--color-danger); } > i { font-size: 14px; } } }
.group-tools { display: flex; flex-wrap: wrap; gap: 5px; padding: 4px 10px; button { padding: 5px 7px; border: 1px solid var(--color-border-control); border-radius: 4px; background: var(--color-bg-control-alt); color: var(--color-text-soft); font-size: 11px; cursor: pointer; &:disabled { opacity: .4; } } }
.dialog-location { color: var(--color-text-faint); font-size: 11px; overflow-wrap: anywhere; }
.item-dialog { position: fixed; inset: 0; z-index: 1950; display: flex; align-items: center; justify-content: center; background: var(--color-tone-0008); form { width: min(360px, 86vw); padding: 16px; border: 1px solid var(--color-border-control); border-radius: 7px; background: var(--color-bg-panel); } label { display: block; margin-top: 12px; font-size: 12px; } input, select { box-sizing: border-box; width: 100%; margin-top: 6px; padding: 8px; background: var(--color-bg-app); border: 1px solid var(--color-border-control); border-radius: 4px; color: var(--color-text-strong); } .group-tools { justify-content: flex-end; margin-top: 12px; } }
.problem-sets { height: 100%; display: flex; flex-direction: column; min-height: 0; color: var(--color-tone-ccc); background: var(--color-bg-app); }
button, input { font: inherit; }.panel-header { display: flex; align-items: center; justify-content: space-between; gap: 7px; padding: 10px; border-bottom: 1px solid var(--color-bg-subtle); div { display: flex; flex-direction: column; min-width: 0; } strong { overflow: hidden; color: var(--color-text-strong); font-size: 15px; text-overflow: ellipsis; white-space: nowrap; } span { color: var(--color-text-faint); font-size: 11px; } button { padding: 5px 8px; border: 1px solid var(--color-border-control); border-radius: 4px; background: var(--color-bg-control-alt); color: var(--color-text-soft); font-size: 11px; cursor: pointer; &:disabled { opacity: .4; } } }
.detail-header { justify-content: flex-start; > div:not(.detail-header__actions) { flex: 1; } .back { flex: 0 0 auto; color: var(--color-accent-text); } &__actions { display: flex; flex: 0 0 auto; flex-direction: row !important; gap: 4px; } .tag-toggle.active { border-color: var(--color-accent-border); background: var(--color-accent-surface); color: var(--color-accent-text); } }.detail-progress-label { display: flex; align-items: center; justify-content: space-between; padding: 4px 10px 3px; color: var(--color-text-faint); font-size: 9px; em { color: var(--color-accent-text); font-style: normal; } }.new-set, .training-link, .contest-link { display: flex; gap: 5px; padding: 8px 10px; input { min-width: 0; flex: 1; padding: 6px 7px; border: 1px solid var(--color-border-control); border-radius: 4px; background: var(--color-bg-panel); color: var(--color-text-strong); font-size: 10px; outline: none; &:focus { border-color: var(--color-accent); } } button { padding: 0 9px; border: 0; border-radius: 4px; background: var(--color-accent-strong); color: var(--color-text-on-accent); font-size: 9px; cursor: pointer; &:disabled { opacity: .4; } } }
.progress { height: 3px; margin: 0 10px 5px; overflow: hidden; background: var(--color-bg-subtle); i { display: block; height: 100%; background: var(--color-tone-36a867); } }.source-info { padding: 2px 10px 6px; color: var(--color-text-faint); font-size: 8px; }.add-actions { padding: 5px 9px 7px; > button { width: 100%; padding: 6px; border: 1px solid var(--color-accent-border); border-radius: 4px; background: var(--color-tone-233544); color: var(--color-accent-text); font-size: 9px; cursor: pointer; &:disabled { opacity: .4; } } > small { display: block; margin-top: 4px; color: var(--color-text-disabled); font-size: 8px; line-height: 1.35; } form { display: flex; align-items: stretch; gap: 4px; margin-top: 5px; textarea { min-width: 0; min-height: 39px; max-height: 100px; flex: 1; resize: vertical; padding: 5px 6px; border: 1px solid var(--color-border-control); border-radius: 3px; background: var(--color-bg-panel); color: var(--color-text-strong); font: 9px/1.4 'Segoe UI', sans-serif; outline: none; &:focus { border-color: var(--color-accent); } } button { flex: 0 0 auto; padding: 0 7px; border: 0; border-radius: 3px; background: var(--color-accent-strong); color: var(--color-text-on-accent); font-size: 9px; cursor: pointer; &:disabled { opacity: .4; } } } }
.problem-items, .training-items { flex: 1; min-height: 0; overflow-y: auto; list-style: none; margin: 0; padding: 0 7px 10px; li { content-visibility: auto; contain-intrinsic-size: 62px; display: flex; align-items: flex-start; gap: 7px; padding: 9px 7px; border-left: 3px solid transparent; border-radius: 4px; &:hover { background: var(--color-bg-hover); border-left-color: var(--color-accent); } > div { min-width: 0; flex: 1; display: flex; flex-direction: column; gap: 3px; } small { color: var(--color-text-faint); font: 8px Consolas, monospace; } strong { overflow: hidden; color: var(--color-tone-d2d2d2); font-size: 11px; text-overflow: ellipsis; white-space: nowrap; } p { display: flex; gap: 3px; margin: 0; overflow: hidden; span { flex: 0 0 auto; padding: 1px 4px; border-radius: 3px; background: var(--color-tone-373737); color: var(--color-accent-text); font-size: 8px; } } > button { border: 0; background: transparent; color: var(--color-text-faint); cursor: pointer; &:hover { color: var(--color-danger); } } } }.problem-items li { cursor: pointer; }.solved { display: grid; place-items: center; flex: 0 0 14px; width: 14px; height: 14px; margin-top: 2px; border: 1px solid var(--color-tone-36b36a); border-radius: 2px; color: var(--color-success-bright); font-size: 9px; }
.smart-tabs { display: flex; gap: 4px; padding: 7px 10px 0; button { flex: 1; padding: 5px; border: 1px solid var(--color-border-control); border-radius: 4px; background: var(--color-bg-control-alt); color: var(--color-tone-888); font-size: 8px; cursor: pointer; &.active { border-color: var(--color-success-border); background: var(--color-success-surface); color: var(--color-tone-8fe0b5); } } }.smart-explanation { padding: 7px 10px; border-bottom: 1px solid var(--color-bg-subtle); color: var(--color-tone-888); font-size: 8px; line-height: 1.5; }.review-state { display: grid; place-items: center; flex: 0 0 16px; width: 16px; height: 16px; margin-top: 2px; border: 1px solid var(--color-warning-strong); border-radius: 50%; color: var(--color-warning); font-size: 10px; &.unresolved { border-color: var(--color-tone-d86758); color: var(--color-danger); } }.practice-summary { color: var(--color-warning-strong); font-size: 8px; }.stale-skills { color: var(--color-code); font-size: 8px; }.practice-actions { display: flex; flex-wrap: wrap; gap: 3px; margin-top: 3px; button { padding: 2px 5px; border: 1px solid var(--color-border-control); border-radius: 3px; background: var(--color-tone-2d2d2d); color: var(--color-text-soft); font-size: 7px; cursor: pointer; &:hover, &.active { border-color: var(--color-accent-border); color: var(--color-accent-text); } &.muted:hover { border-color: var(--color-tone-6a4a4a); color: var(--color-danger); } &.danger { border-color: var(--color-tone-633b3b); color: var(--color-danger); } } }.restore-ignored { margin: 4px 10px 7px; padding: 5px; border: 1px solid var(--color-border-control); border-radius: 4px; background: var(--color-bg-control-alt); color: var(--color-tone-888); font-size: 8px; cursor: pointer; &:hover { color: var(--color-text-secondary); } }
.categories { display: flex; gap: 4px; padding: 2px 9px 7px; overflow-x: auto; button { flex: 0 0 auto; padding: 4px 6px; border: 1px solid var(--color-tone-3d3d3d); border-radius: 4px; background: var(--color-bg-panel); color: var(--color-tone-999); font-size: 8px; cursor: pointer; &.active { border-color: var(--color-accent-border); background: var(--color-accent-surface); color: var(--color-accent-text); } } }.training-items li { align-items: center; div > span { color: var(--color-text-faint); font-size: 8px; } > button { padding: 5px 8px; border: 1px solid var(--color-tone-3b6e90); border-radius: 4px; background: var(--color-accent-surface-hover); color: var(--color-accent-text); font-size: 9px; &:disabled { opacity: .4; } } }.pagination { display: flex; justify-content: center; align-items: center; gap: 9px; padding: 6px; border-top: 1px solid var(--color-bg-subtle); color: var(--color-text-faint); font-size: 9px; button { width: 25px; border: 1px solid var(--color-border-control); border-radius: 3px; background: var(--color-bg-control-alt); color: var(--color-text-secondary); cursor: pointer; &:disabled { opacity: .3; } } }
.contest-items { flex: 1; min-height: 0; overflow-y: auto; list-style: none; margin: 0; padding: 0 8px 10px; li { display: flex; align-items: stretch; gap: 4px; margin: 6px 0; border: 1px solid var(--color-border-soft); border-radius: 7px; background: var(--color-bg-panel); &:hover { border-color: var(--color-tone-536f85); } }.contest-open { display: grid; min-width: 0; flex: 1; grid-template-columns: 54px 1fr; align-items: center; gap: 11px; padding: 12px 14px; border: 0; background: transparent; color: var(--color-tone-ccc); text-align: left; cursor: pointer; > span { display: grid; place-items: center; min-height: 37px; border-radius: 6px; background: var(--color-accent-surface); color: var(--color-accent-text); font-size: 11px; } > div { display: flex; min-width: 0; flex-direction: column; gap: 6px; } strong { overflow: hidden; color: var(--color-text-strong); font-size: 14px; text-overflow: ellipsis; white-space: nowrap; } small { display: flex; align-items: center; gap: 10px; min-width: 0; color: var(--color-text-faint); font: 10px Consolas, monospace; > span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } em { flex: 0 0 auto; padding: 2px 6px; border-radius: 4px; background: var(--color-bg-subtle); color: var(--color-text-secondary); font: 10px var(--font-ui); font-style: normal; &.complete { background: var(--color-success-surface); color: var(--color-success); } } } }.contest-remove { width: 34px; border: 0; border-left: 1px solid var(--color-border-soft); background: transparent; color: var(--color-text-faint); cursor: pointer; &:hover { color: var(--color-danger); } } }
.contest-tabs { display: flex; gap: 5px; padding: 0 10px 8px; button { flex: 1; padding: 7px; border: 1px solid var(--color-border-control); border-radius: 5px; background: var(--color-bg-control-alt); color: var(--color-tone-888); font-size: 11px; cursor: pointer; &.active { border-color: var(--color-accent-border); background: var(--color-accent-surface); color: var(--color-accent-text); } } }.contest-section-title { padding: 4px 12px; color: var(--color-text-soft); font-size: 11px; }.contest-catalog-items { flex: 1; }.contest-pagination { flex: 0 0 auto; }.contest-favorite { width: 40px; border: 0; border-left: 1px solid var(--color-border-soft); background: transparent; color: var(--color-tone-888); font-size: 19px; cursor: pointer; &.active { color: var(--color-warning); } }.contest-problem-items { flex: 1; }.contest-problem-items > li > button { color: var(--color-tone-75beff); }
.bottom-search { display: flex; align-items: center; gap: 5px; flex: 0 0 auto; padding: 8px 9px; border-top: 1px solid var(--color-border); background: var(--color-bg-panel); color: var(--color-text-faint); input { min-width: 0; flex: 1; padding: 6px 7px; border: 1px solid var(--color-border-control); border-radius: 4px; background: var(--color-bg-app); color: var(--color-text-strong); font-size: 10px; outline: none; &:focus { border-color: var(--color-accent); } } button { padding: 5px 8px; border: 0; border-radius: 3px; background: var(--color-accent-strong); color: var(--color-text-on-accent); font-size: 9px; cursor: pointer; } }.notice, .error { padding: 4px 10px; font-size: 9px; }.notice { color: var(--color-success); }.error { color: var(--color-danger); word-break: break-all; }.empty { padding: 28px 12px; color: var(--color-text-faint); text-align: center; font-size: 10px; }
</style>

<style scoped>
.group-path button.drop-into { background: var(--color-accent-surface-hover); outline: 1px solid var(--color-accent); color: var(--color-accent-text); }
.drag-handle { touch-action: none; }
</style>

<style scoped>
.collection-checkbox { flex: 0 0 14px; width: 14px; height: 14px; margin: 0 5px; accent-color: var(--color-accent); cursor: pointer; }
.set-edit-toolbar { display: flex; align-items: center; justify-content: space-between; padding: 6px 11px; font-size: 11px; }
.editing-status { color: var(--color-accent-text); }
.detail-header .edit-set.active { background: var(--color-accent-surface); border-color: var(--color-accent-border); color: var(--color-accent-text); }
.set-export { position: relative; }
.set-export summary { list-style: none; border: 1px solid var(--color-border-control); border-radius: 4px; padding: 5px 9px; cursor: pointer; color: var(--color-text-secondary); }
.set-export summary::-webkit-details-marker { display: none; }
.set-export summary[aria-disabled='true'] { opacity: .45; cursor: default; }
.set-export__menu { position: absolute; top: calc(100% + 4px); right: 0; z-index: 60; width: 175px; padding: 4px; border: 1px solid var(--color-border-control); border-radius: 5px; background: var(--color-bg-panel); box-shadow: 0 5px 18px var(--color-overlay); }
.set-export__menu button { display: block; width: 100%; padding: 8px; text-align: left; background: transparent; border: 0; color: var(--color-text-secondary); font-size: 12px; cursor: pointer; }
.set-export__menu button:hover { background: var(--color-bg-hover); }
.set-problem-items > li { position: relative; display: block; padding: 0; border: 0; border-radius: 0; contain-intrinsic-size: 40px; cursor: default; }
.set-problem-items > li:hover { background: var(--color-bg-hover); }
.set-problem-items > li.moving { opacity: .4; }
.set-problem-items > li.drop-before::before, .set-problem-items > li.drop-after::after { content: ''; position: absolute; left: 0; right: 0; height: 2px; background: var(--color-accent); z-index: 1; }
.set-problem-items > li.drop-before::before { top: 0; }
.set-problem-items > li.drop-after::after { bottom: 0; }
.set-problem-items > li > .set-problem-line { display: flex; flex-direction: row; align-items: center; gap: 7px; min-height: 40px; padding: 4px 5px; }
.set-problem-line button { border: 0; background: transparent; color: var(--color-text-strong); cursor: pointer; }
.set-problem-line .set-problem-name { display: flex; flex-direction: column; gap: 3px; min-width: 0; flex: 1; padding: 3px 0; overflow: hidden; text-align: left; }
.set-problem-name small { color: var(--color-text-muted); font: 10px/1.3 Consolas, monospace; }
.set-problem-name strong { font-size: 13px; line-height: 1.4; font-weight: 600; }
.set-problem-name small, .set-problem-name strong { display: block; max-width: 100%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.set-problem-line .set-problem-name:hover { color: var(--color-accent-text); }
.set-problem-line .problem-grip { flex: 0 0 20px; padding: 2px 0; color: var(--color-text-muted); cursor: grab; touch-action: none; }
.set-problem-line .problem-grip:active { cursor: grabbing; }
.set-problem-line .problem-remove { flex: 0 0 20px; padding: 0; color: var(--color-text-muted); font-size: 19px; }
.set-problem-line .problem-remove:hover { color: var(--color-danger); }
.set-problem-difficulty, .set-problem-rating { flex: 0 0 auto; border-radius: 3px; padding: 3px 5px; font-size: 11px; white-space: nowrap; }
.set-problem-difficulty { color: #fff; }
.set-problem-rating { color: var(--color-warning); font-weight: 600; }
.set-problem-solved { color: var(--color-success); font-size: 12px; }
.set-problem-items > li > .set-problem-tags { display: flex; flex-direction: row; flex-wrap: wrap; gap: 4px; padding: 0 5px 6px; }
.set-problem-tags span { padding: 1px 4px; border-radius: 3px; background: var(--color-bg-subtle); color: var(--color-text-muted); font-size: 10px; }
</style>
