<script setup lang="ts">
import { invoke } from '@tauri-apps/api/core'
import { revealItemInDir } from '@tauri-apps/plugin-opener'
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { useProblemStore } from '../stores/problemStore'
import type { DraftFileInfo, Language, WorkspaceEntry } from '../types'
import ResourceTreeNode from './ResourceTreeNode.vue'
import { flattenTree, topLevelEntries } from '../utils/multiSelection'
import { useMultiSelection } from '../composables/useMultiSelection'
import { batchDirectoryDropTarget, directoryDropTarget } from '../utils/directoryDrop'
import { useLongPressMove } from '../composables/useLongPressMove'
import { useWorkbenchStore } from '../stores/workbenchStore'
import { getDataCenterValue, saveDataCenterValue } from '../dataCenter'
import '@vscode/codicons/dist/codicon.css'

const store = useProblemStore()
const workbench = useWorkbenchStore()
const entries = ref<WorkspaceEntry[]>([])
const rootPath = ref('')
type WorkspaceRoot = { path: string; name: string; builtin: boolean }
const roots = ref<WorkspaceRoot[]>([])
const savedRoot = getDataCenterValue<string>('workspace-active-root', '')
let activeRootInitialized = false
const currentRoot = computed(() => roots.value.find(root => root.path === rootPath.value))
const textFile = reactive({ open: false, path: '', text: '', original: '', busy: false, error: '' })
let refreshTimer: ReturnType<typeof setInterval> | undefined
const loading = ref(false)
const error = ref('')
const notice = ref('')
const savedTreeState = getDataCenterValue<{ version: 1; expandedPaths: string[]; showHidden?: boolean } | null>('workspace-tree-state', null)
const showHidden = ref(savedTreeState?.showHidden ?? false)
const expandedPaths = ref(new Set(savedTreeState?.version === 1 ? savedTreeState.expandedPaths : []))
let treeStateInitialized = savedTreeState?.version === 1
const selectionMode = ref(false)
const movingBusy = ref(false)
const allEntries = computed(() => flattenTree(entries.value))
const visibleEntries = computed(() => flattenTree(entries.value, expandedPaths.value))
const selection = useMultiSelection(() => visibleEntries.value.map(entry => entry.path), () => allEntries.value.map(entry => entry.path))
const contextMenu = ref<{ x: number; y: number; entry: WorkspaceEntry | null } | null>(null)
const fileClipboard = ref<{ entry: WorkspaceEntry; cut: boolean } | null>(null)
const dialog = reactive({ open: false, mode: '' as 'file' | 'folder' | 'rename' | 'delete' | '', target: null as WorkspaceEntry | null, parentPath: '', name: '', language: 'cpp' as Language | 'text' })

function findEntry(path: string, list = entries.value): WorkspaceEntry | null {
  for (const entry of list) {
    if (entry.path === path) return entry
    const child = findEntry(path, entry.children)
    if (child) return child
  }
  return null
}

function persistTreeState() {
  void saveDataCenterValue('workspace-tree-state', { version: 1, expandedPaths: [...expandedPaths.value], showHidden: showHidden.value })
}

function setFolderExpanded(path: string, expanded: boolean) {
  const next = new Set(expandedPaths.value)
  if (expanded) next.add(path); else next.delete(path)
  expandedPaths.value = next
  persistTreeState()
}

function replaceExpandedPath(oldPath: string, newPath?: string) {
  const oldLower = oldPath.toLowerCase()
  const next = new Set<string>()
  for (const path of expandedPaths.value) {
    const lower = path.toLowerCase()
    if (lower === oldLower || lower.startsWith(`${oldLower}\\`)) {
      if (newPath) next.add(`${newPath}${path.slice(oldPath.length)}`)
    } else next.add(path)
  }
  expandedPaths.value = next
  persistTreeState()
}

async function refresh(quiet = false) {
  if (loading.value) return
  loading.value = true
  if (!quiet) error.value = ''
  let requestedRoot = ''
  try {
    roots.value = await invoke<WorkspaceRoot[]>('list_workspace_roots')
    if (!activeRootInitialized) { rootPath.value = savedRoot; activeRootInitialized = true }
    if (!roots.value.some(root => root.path === rootPath.value)) rootPath.value = roots.value[0]?.path ?? ''
    requestedRoot = rootPath.value
    const next = await invoke<WorkspaceEntry[]>('list_workspace_entries', { rootPath: requestedRoot, showHidden: showHidden.value })
    if (rootPath.value !== requestedRoot) return
    if (JSON.stringify(entries.value) !== JSON.stringify(next)) entries.value = next
    if (!treeStateInitialized) {
      expandedPaths.value = new Set(entries.value.filter(entry => entry.isDirectory).map(entry => entry.path))
      treeStateInitialized = true
      persistTreeState()
    }
    if (!quiet) await store.loadDraftFiles()
  } catch (cause) { error.value = String(cause) }
  finally { loading.value = false; if (requestedRoot && requestedRoot !== rootPath.value) void refresh(true) }
}

async function selectRoot() {
  selection.clear()
  entries.value = []
  await saveDataCenterValue('workspace-active-root', rootPath.value)
  await refresh()
}
function collapseFolders() {
  const paths = new Set(allEntries.value.filter(entry => entry.isDirectory).map(entry => entry.path))
  expandedPaths.value = new Set([...expandedPaths.value].filter(path => !paths.has(path)))
  persistTreeState()
}
function dismissMenus() { contextMenu.value = null }
function handleEscape(event: KeyboardEvent) { if (event.key === 'Escape') dismissMenus() }
async function addRoot() {
  try {
    const path = await invoke<string | null>('add_workspace_root')
    if (path) { rootPath.value = path; activeRootInitialized = true; await selectRoot() }
  } catch (cause) { error.value = String(cause) }
}
async function removeRoot() {
  if (currentRoot.value?.builtin) return
  try {
    if (store.draftPath.toLowerCase().startsWith(`${rootPath.value.toLowerCase()}\\`)) await store.persistDraft()
    await store.workspacePathDeleted(rootPath.value)
    workbench.workspacePathRemoved(rootPath.value)
    await invoke('remove_workspace_root', { path: rootPath.value })
    rootPath.value = roots.value[0]?.path ?? ''
    notice.value = '已移出工作区，磁盘文件未删除'
    await selectRoot()
  } catch (cause) { error.value = String(cause) }
}
async function openTextFile(path: string) {
  if (textFile.open && textFile.text !== textFile.original && !window.confirm('放弃当前文本文件的未保存修改？')) return
  try {
    const text = await invoke<string>('read_workspace_text', { path })
    Object.assign(textFile, { open: true, path, text, original: text, error: '' })
  } catch (cause) { error.value = String(cause) }
}
function closeTextFile() {
  if (textFile.text !== textFile.original && !window.confirm('放弃未保存的修改？')) return
  textFile.open = false
}
async function saveTextFile() {
  if (textFile.busy) return
  textFile.busy = true
  textFile.error = ''
  try {
    await invoke('save_workspace_text', { path: textFile.path, text: textFile.text, expected: textFile.original })
    textFile.original = textFile.text
  } catch (cause) { textFile.error = String(cause) }
  finally { textFile.busy = false }
}
async function openSystem(entry: WorkspaceEntry) {
  contextMenu.value = null
  try { await invoke('open_workspace_system', { path: entry.path }) }
  catch (cause) { error.value = String(cause) }
}

function parentOf(entry: WorkspaceEntry | null) {
  if (!entry) return rootPath.value
  if (entry.isDirectory) return entry.path
  const separator = Math.max(entry.path.lastIndexOf('\\'), entry.path.lastIndexOf('/'))
  return separator >= 0 ? entry.path.slice(0, separator) : rootPath.value
}

function openContext(entry: WorkspaceEntry | null, event: MouseEvent) {
  contextMenu.value = { x: Math.min(event.clientX, window.innerWidth - 230), y: Math.max(4, Math.min(event.clientY, window.innerHeight - 430)), entry }
}

function openDialog(mode: typeof dialog.mode, entry: WorkspaceEntry | null = contextMenu.value?.entry ?? null) {
  contextMenu.value = null
  dialog.open = true
  dialog.mode = mode
  dialog.target = entry
  dialog.parentPath = mode === 'file' && !entry && currentRoot.value?.builtin ? '' : mode === 'file' || mode === 'folder' ? parentOf(entry) : ''
  dialog.name = mode === 'rename' && entry ? entry.name : ''
  dialog.language = 'cpp'
}

function closeDialog() { dialog.open = false; dialog.mode = ''; dialog.target = null; dialog.name = '' }

async function submitDialog() {
  error.value = ''
  try {
    if (dialog.mode === 'file') {
      if (dialog.language === 'text') {
        const path = await invoke<string>('create_workspace_text', { parentPath: dialog.parentPath || rootPath.value, name: dialog.name })
        closeDialog(); await refresh(); await openTextFile(path); return
      }
      const file = await invoke<DraftFileInfo>('create_workspace_file', { parentPath: dialog.parentPath || null, name: dialog.name, language: dialog.language })
      closeDialog()
      await refresh()
      await workbench.openDraftFile(file)
    } else if (dialog.mode === 'folder') {
      await invoke('create_workspace_folder', { parentPath: dialog.parentPath || null, name: dialog.name })
      closeDialog()
      await refresh()
    } else if (dialog.mode === 'rename' && dialog.target) {
      await store.persistDraft()
      const oldPath = dialog.target.path
      const newPath = await invoke<string>('rename_workspace_entry', { path: oldPath, newName: dialog.name })
      store.workspacePathChanged(oldPath, newPath)
      workbench.workspacePathChanged(oldPath, newPath)
      if (dialog.target.isDirectory) replaceExpandedPath(oldPath, newPath)
      closeDialog()
      await refresh()
    } else if (dialog.mode === 'delete' && dialog.target) {
      const deletedPath = dialog.target.path
      await invoke('delete_workspace_entry', { path: deletedPath })
      await store.workspacePathDeleted(deletedPath)
      workbench.workspacePathRemoved(deletedPath)
      if (dialog.target.isDirectory) replaceExpandedPath(deletedPath)
      closeDialog()
      await refresh()
    }
  } catch (cause) { error.value = String(cause) }
}

function selectEntry(entry: WorkspaceEntry, event?: MouseEvent, checkbox = false) {
  if (holdMove.shouldSuppressClick()) { event?.preventDefault(); return true }
  const selecting = checkbox || selectionMode.value || !!(event?.ctrlKey || event?.metaKey || event?.shiftKey)
  selection.click(entry.path, event, checkbox || selectionMode.value)
  if (selecting) { selectionMode.value = true; event?.preventDefault() }
  return selecting
}
function toggleSelectionMode() { selectionMode.value = !selectionMode.value; selection.clear() }
function beginEntryMove(entry: WorkspaceEntry, event: PointerEvent) {
  if (!movingBusy.value && !event.ctrlKey && !event.metaKey && !event.shiftKey) holdMove.begin(entry, event)
}
async function openEntry(entry: WorkspaceEntry, event?: MouseEvent) {
  if (event && selectEntry(entry, event)) return
  if (holdMove.shouldSuppressClick() || entry.isDirectory) return
  if (entry.draft) {
    try {
      const file = await invoke<DraftFileInfo>('get_workspace_draft_info', { path: entry.path })
      await workbench.openDraftFile(file)
    } catch (cause) { error.value = String(cause) }
  } else await openTextFile(entry.path)
}

async function moveEntries(sources: WorkspaceEntry[], destinationPath: string) {
  if (movingBusy.value) return
  movingBusy.value = true
  error.value = ''
  let moved = 0
  const failures: string[] = []
  try {
    await store.persistDraft()
    const target = findEntry(destinationPath)
    for (const source of sources) {
      if (!directoryDropTarget(source, target, rootPath.value)) continue
      try {
        const newPath = await invoke<string>('paste_workspace_entry', { sourcePath: source.path, destinationPath, cut: true })
        store.workspacePathChanged(source.path, newPath)
        workbench.workspacePathChanged(source.path, newPath)
        if (source.isDirectory) replaceExpandedPath(source.path, newPath)
        moved++
      } catch (cause) { failures.push(`${source.name}：${String(cause)}`) }
    }
    await refresh()
    notice.value = `已移动 ${moved} 项`
    if (failures.length) error.value = failures.join('；')
  } finally { movingBusy.value = false }
}
const holdMove = useLongPressMove<WorkspaceEntry>({
  targetAttribute: 'data-workspace-path', rootSelector: '.explorer',
  getSources: source => {
    if (!selection.selected.has(source.path)) selection.replace([source.path])
    return topLevelEntries(allEntries.value.filter(entry => selection.selected.has(entry.path)))
  },
  resolveTarget: (source, path) => directoryDropTarget(source, path ? findEntry(path) : null, rootPath.value),
  resolveTargets: (sources, path) => batchDirectoryDropTarget(sources, path ? findEntry(path) : null, rootPath.value),
  onMove: (source, destination) => moveEntries([source], destination || rootPath.value),
  onMoveMany: moveEntries,
})

async function copyText(value: string, message: string) {
  await navigator.clipboard.writeText(value)
  notice.value = message
  contextMenu.value = null
  window.setTimeout(() => { if (notice.value === message) notice.value = '' }, 1600)
}

function stageEntry(entry: WorkspaceEntry, cut: boolean) {
  fileClipboard.value = { entry, cut }
  notice.value = cut ? `已剪切：${entry.name}` : `已复制：${entry.name}`
  contextMenu.value = null
}

async function pasteEntry(destination: WorkspaceEntry | null) {
  if (!fileClipboard.value) return
  const source = fileClipboard.value
  try {
    if (source.cut) await store.persistDraft()
    const destinationPath = destination?.isDirectory ? destination.path : parentOf(destination)
    const newPath = await invoke<string>('paste_workspace_entry', { sourcePath: source.entry.path, destinationPath, cut: source.cut })
    if (source.cut) {
      store.workspacePathChanged(source.entry.path, newPath)
      workbench.workspacePathChanged(source.entry.path, newPath)
      if (source.entry.isDirectory) replaceExpandedPath(source.entry.path, newPath)
      fileClipboard.value = null
    }
    notice.value = source.cut ? '移动完成' : '复制完成'
    contextMenu.value = null
    await refresh()
  } catch (cause) { error.value = String(cause) }
}

function fileUrl(path: string) {
  const normalized = path.replace(/\\/g, '/')
  return encodeURI(`file:///${normalized.replace(/^\/+/, '')}`)
}

function dismissMenu() { dismissMenus() }

onMounted(() => {
  refresh()
  refreshTimer = setInterval(() => { if (!document.hidden && !movingBusy.value && !dialog.open && !textFile.open) void refresh(true) }, 5000)
  window.addEventListener('click', dismissMenu)
  window.addEventListener('blur', dismissMenu)
  window.addEventListener('keydown', handleEscape)
})
onBeforeUnmount(() => {
  if (refreshTimer) clearInterval(refreshTimer)
  window.removeEventListener('click', dismissMenu)
  window.removeEventListener('blur', dismissMenu)
  window.removeEventListener('keydown', handleEscape)
})
</script>

<template>
  <div class="explorer" @dragover.prevent="holdMove.nativeOver" @drop.prevent="holdMove.nativeDrop" @dragend="holdMove.cancel" @dragleave="holdMove.nativeLeave" @click.capture="holdMove.suppressEvent" @contextmenu.prevent="openContext(null, $event)">
    <div class="explorer__toolbar">
      <strong>资源管理器</strong>
      <button class="icon-button" title="新建文件" aria-label="新建文件" @click.stop="openDialog('file', null)"><i class="codicon codicon-new-file" aria-hidden="true" /></button>
      <button class="icon-button" title="新建文件夹" aria-label="新建文件夹" @click.stop="openDialog('folder', null)"><i class="codicon codicon-new-folder" aria-hidden="true" /></button>
      <button class="icon-button" :title="selectionMode ? '退出多选' : '多选文件和文件夹'" aria-label="多选文件和文件夹" :aria-pressed="selectionMode" @click.stop="toggleSelectionMode"><i class="codicon" :class="selectionMode ? 'codicon-check' : 'codicon-checklist'" aria-hidden="true" /></button>
    </div>
    <div class="workspace-selector" :data-workspace-path="rootPath" :class="{ target: holdMove.targetPath.value === rootPath && !!rootPath }"><select v-model="rootPath" aria-label="当前工作区" :title="rootPath" :disabled="loading || movingBusy" @change="selectRoot"><option v-for="root in roots" :key="root.path" :value="root.path">{{ root.name }}</option></select></div>
    <div v-if="selectionMode" class="tree-selection-bar"><button :disabled="!selection.scope.length || movingBusy" @click="selection.toggleAll()">{{ selection.allSelected ? '取消全选' : '全选' }}</button><span>已选 {{ selection.selected.size }} 项</span></div>
    <div v-if="notice" class="explorer__notice">{{ notice }}</div>
    <div v-if="error" class="explorer__error">{{ error }}</div>
    <div v-if="allEntries.length >= 10000" class="explorer__notice">目录较大，仅显示前 10000 项。可单独添加子文件夹。</div>
    <div v-if="loading && !entries.length" class="explorer__empty">正在读取本地文件…</div>
    <div v-else-if="!entries.length" class="explorer__empty">尚无本地代码。右键空白处即可新建。</div>
    <div class="explorer__tree" data-directory-drop-area>
      <ResourceTreeNode v-for="entry in entries" :key="entry.path" :entry="entry" :active-path="store.draftPath" :moving-path="holdMove.movingPath.value" :moving-paths="holdMove.movingPaths.value" :selected-paths="selection.selected" :selection-mode="selectionMode" :target-path="holdMove.targetPath.value" :expanded-paths="expandedPaths" @open="openEntry" @context="openContext" @select="(entry, event) => selectEntry(entry, event, true)" @hold="beginEntryMove" @drag="holdMove.startNative" @toggle="setFolderExpanded" />
    </div>
    <div v-if="holdMove.movingPath.value" class="explorer__move-hint">移动 {{ holdMove.movingCount.value }} 项到目标文件夹后松开</div>

    <div v-if="contextMenu" class="context-menu" :style="{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px` }" @click.stop>
      <button v-if="contextMenu.entry && !contextMenu.entry.isDirectory" @click="openEntry(contextMenu.entry); contextMenu = null">打开</button>
      <button v-if="contextMenu.entry && !contextMenu.entry.isDirectory" @click="openSystem(contextMenu.entry)">使用系统应用打开</button>
      <button @click="addRoot(); contextMenu = null">添加工作区文件夹…</button>
      <button @click="openDialog('file')">新建文件…</button>
      <button @click="openDialog('folder')">新建文件夹…</button>
      <div v-if="contextMenu.entry" class="context-menu__line" />
      <button v-if="contextMenu.entry" @click="openDialog('rename')">重命名…</button>
      <button v-if="contextMenu.entry" class="danger" @click="openDialog('delete')">删除…</button>
      <div class="context-menu__line" />
      <button v-if="contextMenu.entry" @click="stageEntry(contextMenu.entry, true)">剪切</button>
      <button v-if="contextMenu.entry" @click="stageEntry(contextMenu.entry, false)">复制</button>
      <button :disabled="!fileClipboard" @click="pasteEntry(contextMenu.entry)">粘贴<span v-if="fileClipboard">“{{ fileClipboard.entry.name }}”</span></button>
      <div class="context-menu__line" />
      <button @click="copyText(contextMenu.entry?.path || rootPath, '路径已复制')">复制路径</button>
      <button @click="copyText(fileUrl(contextMenu.entry?.path || rootPath), '文件链接已复制')">复制文件链接</button>
      <button @click="revealItemInDir(contextMenu.entry?.path || rootPath); contextMenu = null">在文件资源管理器中显示</button>
      <button @click="refresh(); contextMenu = null">刷新</button>
      <button @click="collapseFolders(); contextMenu = null">全部折叠</button>
      <button :disabled="loading" @click="showHidden = !showHidden; persistTreeState(); contextMenu = null; refresh()">{{ showHidden ? '隐藏系统文件' : '显示隐藏文件' }}</button>
      <button v-if="currentRoot && !currentRoot.builtin" @click="contextMenu = null; removeRoot()">移出当前工作区（保留文件）</button>
      <button @click="contextMenu = null; workbench.toggleSidebar()">收起侧边栏</button>
    </div>

    <div v-if="dialog.open" class="entry-dialog" @click.self="closeDialog">
      <form @submit.prevent="submitDialog">
        <h3>{{ dialog.mode === 'file' ? '新建文件' : dialog.mode === 'folder' ? '新建文件夹' : dialog.mode === 'rename' ? '重命名' : '确认删除' }}</h3>
        <template v-if="dialog.mode !== 'delete'">
          <label>名称<input v-model="dialog.name" autofocus :placeholder="dialog.mode === 'file' ? '例如 solution 或 solution.cpp' : '输入名称'" /></label>
          <label v-if="dialog.mode === 'file'">类型<select v-model="dialog.language"><option value="cpp">C++</option><option value="python">Python</option><option value="java">Java</option><option value="text">文本 / 配置文件（保留输入的文件名）</option></select></label>
          <p v-if="dialog.mode === 'file' || dialog.mode === 'folder'">建立位置：{{ dialog.parentPath || (dialog.mode === 'file' ? '今天的日期文件夹' : rootPath) }}</p>
        </template>
        <p v-else class="delete-warning">将“{{ dialog.target?.name }}”<template v-if="dialog.target?.isDirectory">及其中的全部文件</template>移到系统回收站，可通过系统回收站恢复。</p>
        <div class="entry-dialog__actions"><button type="button" @click="closeDialog">取消</button><button type="submit" :class="{ danger: dialog.mode === 'delete' }" :disabled="dialog.mode !== 'delete' && !dialog.name.trim()">{{ dialog.mode === 'delete' ? '确认删除' : '确定' }}</button></div>
      </form>
    </div>
    <div v-if="textFile.open" class="text-file-dialog" @keydown.ctrl.s.prevent="saveTextFile" @keydown.meta.s.prevent="saveTextFile">
      <section><header><strong :title="textFile.path">{{ textFile.path.split(/[\\/]/).pop() }}{{ textFile.text !== textFile.original ? ' ●' : '' }}</strong><button :disabled="textFile.busy" @click="saveTextFile">保存</button><button :disabled="textFile.busy" @click="closeTextFile">关闭</button></header><p v-if="textFile.error" class="explorer__error">{{ textFile.error }}</p><textarea v-model="textFile.text" :readonly="textFile.busy" spellcheck="false" aria-label="文件内容" /><footer>{{ textFile.path }} · UTF-8 · 此文件不绑定题目或测试点</footer></section>
    </div>
  </div>
</template>

<style scoped lang="scss">
.explorer { position: relative; height: 100%; display: flex; flex-direction: column; min-height: 0; color: var(--color-tone-ccc); }
.workspace-selector { padding:0 8px 7px; select { display:block; box-sizing:border-box; width:100%; height:28px; min-width:0; padding:0 7px; border:1px solid var(--color-border-control); border-radius:3px; background:var(--color-bg-panel-alt); color:var(--color-text-secondary); font:12px var(--font-ui); outline:none; &:focus-visible { border-color:var(--color-accent); } } }
.text-file-dialog { position:fixed; inset:0; z-index:1950; display:flex; align-items:center; justify-content:center; background:var(--color-overlay); section { width:min(900px,85vw); height:75vh; display:flex; flex-direction:column; background:var(--color-bg-panel); border:1px solid var(--color-border-strong); border-radius:6px; overflow:hidden; } header { display:flex; gap:10px; padding:10px; strong { flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; } button { background:var(--color-bg-control); color:var(--color-text-primary); border:1px solid var(--color-border); padding:4px 12px; cursor:pointer; } } textarea { flex:1; min-height:0; resize:none; padding:12px; background:var(--color-bg-deep); color:var(--color-text-primary); border:0; outline:none; font:14px/1.6 Consolas,monospace; tab-size:4; white-space:pre; } footer { padding:8px; font-size:11px; color:var(--color-text-muted); overflow-wrap:anywhere; } }
.explorer__toolbar { display:flex; flex:0 0 36px; align-items:center; gap:3px; padding:0 8px 0 12px; strong { flex:1; font-size:12px; font-weight:500; color:var(--color-text-secondary); } .icon-button { display:grid; place-items:center; width:26px; height:26px; padding:0; border:0; border-radius:3px; background:transparent; color:var(--color-text-soft); cursor:pointer; .codicon { font-size:17px; } &:hover { background:var(--color-bg-hover); color:var(--color-text-primary); } &[aria-pressed="true"] { background:var(--color-bg-selected); color:var(--color-accent-text); } &:focus-visible { outline:1px solid var(--color-accent); } } }
.explorer__tree { flex:1; min-height:0; overflow:auto; padding:2px 0 14px; scrollbar-width:thin; }
.explorer__move-hint { position: absolute; right: 7px; bottom: 7px; left: 7px; z-index: 5; padding: 6px; border: 1px solid var(--color-accent); border-radius: 4px; background: var(--color-accent-surface-hover); color: var(--color-accent-text); text-align: center; font-size: 9px; }
.explorer__error, .explorer__notice { padding: 6px 9px; font-size: 10px; line-height: 1.4; }.explorer__error { color: var(--color-danger); background: var(--color-danger-surface); }.explorer__notice { color: var(--color-tone-76c99b); background: var(--color-tone-1d3025); }
.explorer__empty { padding: 30px 12px; text-align: center; color: var(--color-text-disabled); font-size: 12px; }
.context-menu { position: fixed; z-index: 1900; width: 220px; padding: 6px; border: 1px solid var(--color-border-strong); border-radius: 6px; background: var(--color-bg-panel); box-shadow: 0 8px 24px var(--color-overlay); font-family: var(--font-ui); button { display: block; width: 100%; min-height: 32px; padding: 7px 11px; border: 0; border-radius: 4px; background: transparent; color: var(--color-text-strong); text-align: left; font-size: 13px; cursor: pointer; span { display: block; overflow: hidden; color: var(--color-text-faint); font-size: 11px; text-overflow: ellipsis; white-space: nowrap; } &:hover:not(:disabled) { background: var(--color-tone-094771); color: var(--color-text-on-accent); } &:disabled { color: var(--color-text-disabled); cursor: default; } &.danger { color: var(--color-danger); &:hover { background: var(--color-tone-6b2525); color: var(--color-text-on-accent); } } } &__line { height: 1px; margin: 4px 6px; background: var(--color-border-control); } }
.entry-dialog { position: fixed; inset: 0; z-index: 1950; display: flex; align-items: center; justify-content: center; background: var(--color-tone-0008); form { width: min(360px, 86vw); padding: 16px; border: 1px solid var(--color-border-strong); border-radius: 7px; background: var(--color-bg-panel); box-shadow: 0 15px 40px var(--color-overlay); } h3 { margin: 0 0 13px; font-size: 14px; } label { display: block; margin-bottom: 9px; color: var(--color-text-soft); font-size: 10px; } input, select { box-sizing: border-box; width: 100%; margin-top: 4px; padding: 7px; border: 1px solid var(--color-border-input); border-radius: 4px; outline: none; background: var(--color-bg-deep); color: var(--color-text-strong); &:focus { border-color: var(--color-accent); } } p { overflow-wrap: anywhere; color: var(--color-text-faint); font-size: 9px; line-height: 1.5; } &__actions { display: flex; justify-content: space-between; gap: 7px; margin-top: 14px; button { padding: 6px 13px; border: 0; border-radius: 4px; background: var(--color-border-control); color: var(--color-text-on-accent); cursor: pointer; &[type='submit'] { background: var(--color-accent-strong); } &.danger { background: var(--color-tone-9a3535); } &:disabled { opacity: .4; } } } .delete-warning { color: var(--color-tone-e6b1a8); font-size: 11px; } }
</style>

<style scoped>
.workspace-selector.target { background: var(--color-accent-surface-hover); box-shadow: inset 0 0 0 1px var(--color-accent); color: var(--color-accent-text); }
</style>

<style scoped>
.tree-selection-bar { display: flex; align-items: center; gap: 6px; padding: 5px 9px; font-size: 11px; border-bottom: 1px solid var(--color-border); }
.tree-selection-bar span { flex: 1; color: var(--color-text-muted); }
.tree-selection-bar button { border: 0; border-radius: 3px; padding: 4px 6px; background: var(--color-bg-control); color: var(--color-text-secondary); cursor: pointer; }
</style>
