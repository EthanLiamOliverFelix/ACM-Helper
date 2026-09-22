import { computed, reactive, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import type { DraftFileInfo, Language, Platform, Problem } from '../types'
import { getDataCenterValue, saveDataCenterValue } from '../dataCenter'
import { useProblemStore } from './problemStore'
import { useNoteStore } from './noteStore'

export type ActivityId = 'problems' | 'files' | 'learning' | 'ai' | 'runner' | 'notes'
export type RunnerTool = 'tests' | 'submission' | 'debugger'
export type WorkbenchTabKind = 'code' | 'statement' | 'problem-note' | 'ai' | 'learning' | 'notes'

export interface WorkbenchContextRef {
  kind: 'problem' | 'local-file'
  contextId: string
  platform: Platform
  problemId: string
  title: string
  url?: string
  path?: string
  language: Language
}

export interface WorkbenchTab {
  id: string
  kind: WorkbenchTabKind
  title: string
  context?: WorkbenchContextRef
  preview?: boolean
  /** Transient UI state. It is deliberately cleared when a saved workspace is restored. */
  loading?: boolean
  loadError?: string
}

export interface EditorGroupState {
  id: string
  tabs: WorkbenchTab[]
  activeTabId: string | null
}

/** Return the object as stored by Vue so later loading updates stay reactive. */
export function upsertWorkbenchTab(group: EditorGroupState, tab: WorkbenchTab) {
  const existing = group.tabs.find(item => item.id === tab.id)
  if (existing) {
    Object.assign(existing, tab)
    return existing
  }
  group.tabs.push(tab)
  return group.tabs[group.tabs.length - 1]
}

export type WorkbenchLayoutNode =
  | { type: 'group'; groupId: string }
  | { type: 'split'; direction: 'horizontal' | 'vertical'; ratio: number; first: WorkbenchLayoutNode; second: WorkbenchLayoutNode }

interface PersistedWorkbenchState {
  version: 1
  activity: ActivityId
  runnerTool: RunnerTool
  sidebarVisible: boolean
  sidebarWidth: number
  noteSidebarWidth: number
  bottomPanelHeight: number
  splitRatio: number
  activeGroupId: string
  groups: EditorGroupState[]
  layoutTree: WorkbenchLayoutNode
}

const DEFAULT_STATE: PersistedWorkbenchState = {
  version: 1,
  activity: 'problems',
  runnerTool: 'tests',
  sidebarVisible: true,
  sidebarWidth: 300,
  noteSidebarWidth: 290,
  bottomPanelHeight: 190,
  splitRatio: 58,
  activeGroupId: 'group-1',
  groups: [{ id: 'group-1', tabs: [], activeTabId: null }],
  layoutTree: { type: 'group', groupId: 'group-1' },
}

function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T }
function appendGroupToLayout(layout: WorkbenchLayoutNode, groupId: string): WorkbenchLayoutNode {
  return { type: 'split', direction: 'horizontal', ratio: 50, first: layout, second: { type: 'group', groupId } }
}
function normalizeLayout(value: unknown, groupIds: string[]): WorkbenchLayoutNode {
  const used = new Set<string>()
  function visit(candidate: unknown): WorkbenchLayoutNode | null {
    const node = candidate as Partial<WorkbenchLayoutNode> | null
    if (!node || typeof node !== 'object') return null
    if (node.type === 'group') {
      const groupId = String((node as { groupId?: string }).groupId ?? '')
      if (!groupIds.includes(groupId) || used.has(groupId)) return null
      used.add(groupId)
      return { type: 'group', groupId }
    }
    if (node.type !== 'split') return null
    const split = node as Partial<Extract<WorkbenchLayoutNode, { type: 'split' }>>
    const first = visit(split.first)
    const second = visit(split.second)
    if (!first) return second
    if (!second) return first
    return {
      type: 'split',
      direction: split.direction === 'vertical' ? 'vertical' : 'horizontal',
      ratio: Math.min(90, Math.max(10, Number(split.ratio) || 50)),
      first,
      second,
    }
  }
  let result = visit(value) ?? { type: 'group', groupId: groupIds[0] } as WorkbenchLayoutNode
  for (const groupId of groupIds) if (!used.has(groupId) && groupId !== groupIds[0]) result = appendGroupToLayout(result, groupId)
  return result
}
export function normalizeWorkbenchState(value: unknown): PersistedWorkbenchState {
  const saved = value as Partial<PersistedWorkbenchState> | null
  if (!saved || saved.version !== 1 || !Array.isArray(saved.groups)) return clone(DEFAULT_STATE)
  const validTabKinds: WorkbenchTabKind[] = ['code', 'statement', 'problem-note', 'ai', 'learning', 'notes']
  const groups: EditorGroupState[] = saved.groups.slice(0, 12).filter(group => group && Array.isArray(group.tabs)).map((group, index) => ({
    id: typeof group.id === 'string' ? group.id : `group-${index + 1}`,
    tabs: group.tabs
      .filter(tab => tab && typeof tab.id === 'string' && validTabKinds.includes(tab.kind as WorkbenchTabKind))
      .map(tab => ({ ...tab, loading: false, loadError: undefined })),
    activeTabId: null as string | null,
  })).filter((group, index) => index === 0 || group.tabs.length > 0)
  for (const group of groups) group.activeTabId = group.tabs.some(tab => tab.id === saved.groups?.find(item => item.id === group.id)?.activeTabId)
    ? saved.groups?.find(item => item.id === group.id)?.activeTabId ?? null
    : group.tabs[0]?.id ?? null
  if (!groups.length) groups.push(clone(DEFAULT_STATE.groups[0]))
  const legacyActivity = String(saved.activity)
  const runnerTool: RunnerTool = ['tests', 'submission', 'debugger'].includes(String(saved.runnerTool))
    ? saved.runnerTool as RunnerTool
    : ['tests', 'submission', 'debugger'].includes(legacyActivity) ? legacyActivity as RunnerTool : 'tests'
  const legacyLayout: WorkbenchLayoutNode = groups[1]
    ? { type: 'split', direction: 'horizontal', ratio: Math.min(75, Math.max(25, Number(saved.splitRatio) || 58)), first: { type: 'group', groupId: groups[0].id }, second: { type: 'group', groupId: groups[1].id } }
    : { type: 'group', groupId: groups[0].id }
  return {
    version: 1,
    activity: legacyActivity === 'runner' || ['tests', 'submission', 'debugger'].includes(legacyActivity) ? 'runner' : ['problems', 'files'].includes(legacyActivity) ? legacyActivity as ActivityId : 'problems',
    runnerTool,
    sidebarVisible: saved.sidebarVisible !== false,
    sidebarWidth: Math.min(520, Math.max(220, Number(saved.sidebarWidth) || 300)),
    noteSidebarWidth: Math.min(520, Math.max(180, Number(saved.noteSidebarWidth) || 290)),
    bottomPanelHeight: Math.min(600, Math.max(110, Number(saved.bottomPanelHeight) || 190)),
    splitRatio: Math.min(75, Math.max(25, Number(saved.splitRatio) || 58)),
    activeGroupId: groups.some(group => group.id === saved.activeGroupId) ? saved.activeGroupId! : groups[0].id,
    groups,
    layoutTree: normalizeLayout(saved.layoutTree ?? legacyLayout, groups.map(group => group.id)),
  }
}

export const useWorkbenchStore = defineStore('workbench', () => {
  const saved = normalizeWorkbenchState(getDataCenterValue('ui-workbench', DEFAULT_STATE))
  const activity = ref<ActivityId>(saved.activity)
  const runnerTool = ref<RunnerTool>(saved.runnerTool)
  const sidebarVisible = ref(saved.sidebarVisible)
  const sidebarWidth = ref(saved.sidebarWidth)
  const noteSidebarWidth = ref(saved.noteSidebarWidth)
  const bottomPanelHeight = ref(saved.bottomPanelHeight)
  const splitRatio = ref(saved.splitRatio)
  const activeGroupId = ref(saved.activeGroupId)
  const groups = reactive<EditorGroupState[]>(saved.groups)
  const layoutTree = ref<WorkbenchLayoutNode>(saved.layoutTree)
  const restoring = ref(false)
  let saveTimer: ReturnType<typeof setTimeout> | null = null
  let activationSequence = 0

  const activeGroup = computed(() => groups.find(group => group.id === activeGroupId.value) ?? groups[0])
  const activeTab = computed(() => activeGroup.value?.tabs.find(tab => tab.id === activeGroup.value.activeTabId) ?? null)
  const activeContext = computed(() => activeTab.value?.context ?? groups.flatMap(group => group.tabs).find(tab => tab.kind === 'code' && tab.context)?.context)
  function snapshot(): PersistedWorkbenchState {
    return clone({ version: 1, activity: activity.value, runnerTool: runnerTool.value, sidebarVisible: sidebarVisible.value, sidebarWidth: sidebarWidth.value, noteSidebarWidth: noteSidebarWidth.value, bottomPanelHeight: bottomPanelHeight.value,
      splitRatio: splitRatio.value, activeGroupId: activeGroupId.value, groups, layoutTree: layoutTree.value })
  }
  function queueSave() {
    if (restoring.value) return
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => void saveDataCenterValue('ui-workbench', snapshot()), 350)
  }
  watch([activity, runnerTool, sidebarVisible, sidebarWidth, noteSidebarWidth, bottomPanelHeight, splitRatio, activeGroupId, groups, layoutTree], queueSave, { deep: true })

  function contextFromCurrent(): WorkbenchContextRef | null {
    const store = useProblemStore()
    const problem = store.currentProblem
    if (!problem) return null
    return {
      kind: store.draftPath ? 'local-file' : 'problem',
      contextId: store.draftPath ? `file:${store.draftPath.toLowerCase()}` : `problem:${problem.platform}:${problem.id.toUpperCase()}`,
      platform: problem.platform,
      problemId: problem.id,
      title: problem.title,
      url: problem.url,
      path: store.draftPath || undefined,
      language: store.currentLanguage,
    }
  }

  function contextFromProblem(problem: Problem): WorkbenchContextRef {
    return {
      kind: 'problem',
      contextId: `problem:${problem.platform}:${problem.id.toUpperCase()}`,
      platform: problem.platform,
      problemId: problem.id,
      title: problem.title,
      url: problem.url,
      language: useProblemStore().currentLanguage,
    }
  }

  function replaceLayoutGroup(node: WorkbenchLayoutNode, groupId: string, replacement: WorkbenchLayoutNode): WorkbenchLayoutNode {
    if (node.type === 'group') return node.groupId === groupId ? replacement : node
    return { ...node, first: replaceLayoutGroup(node.first, groupId, replacement), second: replaceLayoutGroup(node.second, groupId, replacement) }
  }

  function removeLayoutGroup(node: WorkbenchLayoutNode, groupId: string): WorkbenchLayoutNode | null {
    if (node.type === 'group') return node.groupId === groupId ? null : node
    const first = removeLayoutGroup(node.first, groupId)
    const second = removeLayoutGroup(node.second, groupId)
    if (!first) return second
    if (!second) return first
    return { ...node, first, second }
  }

  function nextGroupId() {
    let index = 1
    while (groups.some(group => group.id === `group-${index}`)) index++
    return `group-${index}`
  }

  function createGroupBeside(targetGroupId: string, edge: 'left' | 'right' | 'top' | 'bottom') {
    const group: EditorGroupState = { id: nextGroupId(), tabs: [], activeTabId: null }
    groups.push(group)
    const target: WorkbenchLayoutNode = { type: 'group', groupId: targetGroupId }
    const created: WorkbenchLayoutNode = { type: 'group', groupId: group.id }
    const before = edge === 'left' || edge === 'top'
    layoutTree.value = replaceLayoutGroup(layoutTree.value, targetGroupId, {
      type: 'split',
      direction: edge === 'top' || edge === 'bottom' ? 'vertical' : 'horizontal',
      ratio: 50,
      first: before ? created : target,
      second: before ? target : created,
    })
    return group
  }

  function ensureSecondGroup() {
    if (groups.length < 2) return createGroupBeside(groups[0].id, 'right')
    return groups[1]
  }

  function addTab(group: EditorGroupState, tab: WorkbenchTab) {
    const mountedTab = upsertWorkbenchTab(group, tab)
    group.activeTabId = tab.id
    activeGroupId.value = group.id
    return mountedTab
  }

  function openCurrentCode() {
    const context = contextFromCurrent()
    if (!context) return
    const group = groups[0]
    addTab(group, { id: `code:${context.contextId}:${context.language}`, kind: 'code', title: `${context.title}.${context.language === 'cpp' ? 'cpp' : context.language === 'python' ? 'py' : 'java'}`, context })
    void syncFollowingTabs(context)
  }

  /**
   * Makes navigation feel immediate: mount and activate the destination tab first,
   * then hydrate its editor/statement content in the background.
   */
  async function openProblem(problem: Problem) {
    const requestSequence = ++activationSequence
    const context = contextFromProblem(problem)
    const codeTab: WorkbenchTab = {
      id: `code:${context.contextId}:${context.language}`,
      kind: 'code',
      title: `${context.title}.${context.language === 'cpp' ? 'cpp' : context.language === 'python' ? 'py' : 'java'}`,
      context,
      loading: true,
    }
    const mountedCodeTab = addTab(groups[0], codeTab)
    const followerTabs = groups.slice(1).flatMap(group => group.tabs).filter(tab => tab.id.startsWith('following:'))
    for (const follower of followerTabs) {
      follower.context = { ...context }
      follower.title = `${context.problemId} · ${follower.kind === 'statement' ? '题面' : follower.kind === 'problem-note' ? '笔记' : 'AI'}`
      follower.loading = follower.kind === 'statement' || follower.kind === 'problem-note'
      follower.loadError = undefined
    }
    try {
      // Code/draft hydration is fast and belongs to navigation. The remote
      // statement continues in the background so it cannot block another tab.
      await useProblemStore().selectProblem(problem, { waitForDetail: false })
      mountedCodeTab.loading = false
      if (requestSequence === activationSequence) {
        for (const follower of followerTabs) {
          if (follower.context?.contextId === context.contextId) follower.loading = false
        }
        await syncFollowingTabs(context)
      }
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      mountedCodeTab.loading = false
      mountedCodeTab.loadError = message
      for (const follower of followerTabs) {
        if (follower.context?.contextId !== context.contextId) continue
        follower.loading = false
        follower.loadError = message
      }
      throw cause
    }
  }

  async function openDraftFile(file: DraftFileInfo) {
    const requestSequence = ++activationSequence
    const context: WorkbenchContextRef = {
      kind: 'local-file',
      contextId: `file:${file.path.toLowerCase()}`,
      platform: file.platform,
      problemId: file.problemId,
      title: file.title || file.problemId,
      path: file.path,
      language: file.language,
    }
    const mountedTab = addTab(groups[0], {
      id: `code:${context.contextId}:${context.language}`,
      kind: 'code',
      title: file.path.split(/[\\/]/).pop() || `${context.title}.${context.language}`,
      context,
      loading: true,
    })
    const followerTabs = groups.slice(1).flatMap(group => group.tabs).filter(tab => tab.id.startsWith('following:'))
    for (const follower of followerTabs) {
      follower.context = { ...context }
      follower.title = `${context.problemId} · ${follower.kind === 'statement' ? '题面' : follower.kind === 'problem-note' ? '笔记' : 'AI'}`
      follower.loading = follower.kind === 'statement' || follower.kind === 'problem-note'
      follower.loadError = undefined
    }
    try {
      await useProblemStore().openDraftFile(file)
      mountedTab.loading = false
      if (requestSequence === activationSequence) {
        for (const follower of followerTabs) {
          if (follower.context?.contextId === context.contextId) follower.loading = false
        }
        await syncFollowingTabs(context)
      }
    } catch (cause) {
      mountedTab.loading = false
      mountedTab.loadError = cause instanceof Error ? cause.message : String(cause)
      for (const follower of followerTabs) {
        if (follower.context?.contextId !== context.contextId) continue
        follower.loading = false
        follower.loadError = mountedTab.loadError
      }
      throw cause
    }
  }

  async function setCurrentLanguage(language: Language) {
    const store = useProblemStore()
    const group = groups.find(item => item.id === activeGroupId.value)
    const tab = group?.tabs.find(item => item.id === group.activeTabId)
    await store.setLanguage(language)
    if (!tab || tab.kind !== 'code' || !tab.context) return
    tab.context.language = language
    tab.id = `code:${tab.context.contextId}:${language}`
    tab.title = `${tab.context.title}.${language === 'cpp' ? 'cpp' : language === 'python' ? 'py' : 'java'}`
    group!.activeTabId = tab.id
  }

  function openStatement() {
    const context = contextFromCurrent()
    if (!context) return
    addTab(ensureSecondGroup(), { id: 'following:statement', kind: 'statement', title: `${context.problemId} · 题面`, context })
  }

  async function openProblemNote() {
    const context = contextFromCurrent()
    const problem = useProblemStore().currentProblem
    if (!context || !problem) return
    await useNoteStore().openProblemNote(problem)
    addTab(ensureSecondGroup(), { id: 'following:problem-note', kind: 'problem-note', title: `${context.problemId} · 笔记`, context })
  }

  function openAi() {
    const context = contextFromCurrent() ?? undefined
    const target = context ? ensureSecondGroup() : activeGroup.value
    addTab(target, { id: context ? 'following:ai' : 'global:ai', kind: 'ai', title: context ? `${context.problemId} · AI` : 'AI 辅助', context })
  }
  function openRunner(tool: RunnerTool = runnerTool.value) { runnerTool.value = tool; activity.value = 'runner'; sidebarVisible.value = true }
  function openTests() { openRunner('tests') }
  function openSubmission() { openRunner('submission') }
  function openDebugger() { openRunner('debugger') }
  function preferredFeatureGroup() {
    return groups[0].tabs.some(tab => tab.kind === 'code') ? ensureSecondGroup() : activeGroup.value
  }
  function openLearning() { addTab(preferredFeatureGroup(), { id: 'global:learning', kind: 'learning', title: '技能树与 VP' }) }
  function openNotes() { addTab(preferredFeatureGroup(), { id: 'global:notes', kind: 'notes', title: '算法笔记本' }) }

  async function syncFollowingTabs(context: WorkbenchContextRef) {
    const followerTabs = groups.slice(1).flatMap(group => group.tabs).filter(tab => tab.id.startsWith('following:'))
    for (const tab of followerTabs) {
      tab.context = { ...context }
      tab.title = `${context.problemId} · ${tab.kind === 'statement' ? '题面' : tab.kind === 'problem-note' ? '笔记' : 'AI'}`
      if (tab.kind === 'problem-note' && useProblemStore().currentProblem) await useNoteStore().openProblemNote(useProblemStore().currentProblem!)
    }
  }

  async function activateContext(context?: WorkbenchContextRef) {
    if (!context) return true
    const sequence = ++activationSequence
    const store = useProblemStore()
    const sameProblem = store.currentProblem?.platform === context.platform && store.currentProblem?.id === context.problemId
    const samePath = !context.path || store.draftPath.toLowerCase() === context.path.toLowerCase()
    if (sameProblem && samePath && store.currentLanguage === context.language) return true
    if (context.kind === 'local-file' && context.path) {
      if (!store.draftFiles.length) await store.loadDraftFiles()
      const file = store.draftFiles.find(item => item.path.toLowerCase() === context.path!.toLowerCase())
      if (file) await store.openDraftFile(file)
    } else {
      const known = [...store.problems, ...store.importedProblems].find(item => item.platform === context.platform && item.id === context.problemId)
      const fallback: Problem = known ?? { id: context.problemId, title: context.title, platform: context.platform, tags: [], url: context.url }
      await store.selectProblem(fallback, { waitForDetail: false })
      if (store.currentLanguage !== context.language) await store.setLanguage(context.language)
    }
    return sequence === activationSequence
  }

  async function activateTab(groupId: string, tabId: string) {
    const group = groups.find(item => item.id === groupId)
    const tab = group?.tabs.find(item => item.id === tabId)
    if (!group || !tab) return
    group.activeTabId = tabId
    activeGroupId.value = groupId
    const store = useProblemStore()
    const needsHydration = Boolean(tab.context && (
      store.currentProblem?.platform !== tab.context.platform
      || store.currentProblem?.id !== tab.context.problemId
      || (tab.kind === 'code' && store.currentLanguage !== tab.context.language)
    ))
    if (needsHydration) { tab.loading = true; tab.loadError = undefined }
    try {
      const isCurrent = await activateContext(tab.context)
      if (!isCurrent) return
      if (tab.kind === 'code' && tab.context) await syncFollowingTabs(tab.context)
      if (tab.kind === 'problem-note' && store.currentProblem) await useNoteStore().openProblemNote(store.currentProblem)
    } catch (cause) {
      tab.loadError = cause instanceof Error ? cause.message : String(cause)
    } finally {
      tab.loading = false
    }
  }

  function closeTab(groupId: string, tabId: string) {
    const group = groups.find(item => item.id === groupId)
    if (!group) return
    const index = group.tabs.findIndex(tab => tab.id === tabId)
    if (index < 0) return
    const wasActive = group.activeTabId === tabId
    group.tabs.splice(index, 1)
    if (wasActive) group.activeTabId = group.tabs[Math.min(index, group.tabs.length - 1)]?.id ?? null
    if (groups.length > 1 && !group.tabs.length) {
      const groupIndex = groups.indexOf(group)
      groups.splice(groupIndex, 1)
      layoutTree.value = removeLayoutGroup(layoutTree.value, groupId) ?? { type: 'group', groupId: groups[0].id }
    }
    if (!groups.some(item => item.id === activeGroupId.value)) activeGroupId.value = groups[0].id
    const nextGroup = groups.find(item => item.id === groupId) ?? groups[0]
    // The tab and its pane have already disappeared at this point. Restoring the
    // newly revealed context is intentionally fire-and-forget.
    if (wasActive && nextGroup.activeTabId) void activateTab(nextGroup.id, nextGroup.activeTabId)
  }

  function moveTab(groupId: string, tabId: string, targetGroupId: string, edge: 'center' | 'left' | 'right' | 'top' | 'bottom', targetIndex?: number) {
    const source = groups.find(item => item.id === groupId)
    const tab = source?.tabs.find(item => item.id === tabId)
    const existingTarget = groups.find(item => item.id === targetGroupId)
    if (!source || !tab || !existingTarget) return
    const target = edge === 'center' ? existingTarget : createGroupBeside(targetGroupId, edge)
    const sourceIndex = source.tabs.indexOf(tab)
    source.tabs.splice(sourceIndex, 1)
    if (source.activeTabId === tabId) source.activeTabId = source.tabs[Math.min(sourceIndex, source.tabs.length - 1)]?.id ?? null
    if (edge === 'center' && targetIndex != null) {
      let insertionIndex = Math.max(0, Math.min(target.tabs.length, targetIndex))
      if (source === target && sourceIndex < targetIndex) insertionIndex--
      target.tabs.splice(Math.max(0, insertionIndex), 0, tab)
      target.activeTabId = tab.id
      activeGroupId.value = target.id
    } else addTab(target, tab)
    if (!source.tabs.length && groups.length > 1) {
      groups.splice(groups.indexOf(source), 1)
      layoutTree.value = removeLayoutGroup(layoutTree.value, source.id) ?? { type: 'group', groupId: target.id }
    }
  }

  function setActivity(next: ActivityId) {
    if (next === 'learning') { openLearning(); return }
    if (next === 'ai') { openAi(); return }
    if (next === 'notes') { openNotes(); return }
    if (activity.value === next) sidebarVisible.value = !sidebarVisible.value
    else { activity.value = next; sidebarVisible.value = true }
  }

  function setSplitRatio(value: number) { splitRatio.value = Math.min(75, Math.max(25, value)) }
  function setSidebarWidth(value: number) { sidebarWidth.value = Math.min(520, Math.max(220, value)) }
  function setNoteSidebarWidth(value: number) { noteSidebarWidth.value = Math.min(520, Math.max(180, value)) }
  function setBottomPanelHeight(value: number) { bottomPanelHeight.value = Math.min(600, Math.max(110, value)) }
  function toggleSidebar() { sidebarVisible.value = !sidebarVisible.value }

  async function restore() {
    restoring.value = true
    try {
      const group = groups.find(item => item.id === activeGroupId.value) ?? groups[0]
      const tab = group.tabs.find(item => item.id === group.activeTabId) ?? group.tabs[0]
      if (tab) await activateTab(group.id, tab.id)
    } finally { restoring.value = false }
  }

  return { activity, runnerTool, sidebarVisible, sidebarWidth, noteSidebarWidth, bottomPanelHeight, splitRatio, activeGroupId, groups, activeGroup, activeTab, activeContext, layoutTree,
    setActivity, toggleSidebar, setSidebarWidth, setNoteSidebarWidth, setBottomPanelHeight, setSplitRatio, openProblem, openDraftFile, openCurrentCode, setCurrentLanguage, openStatement, openProblemNote, openAi, openRunner, openTests, openSubmission, openDebugger, openLearning, openNotes,
    activateTab, closeTab, moveTab, restore, snapshot }
})
