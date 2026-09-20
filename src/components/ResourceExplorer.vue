<script setup lang="ts">
import { invoke } from '@tauri-apps/api/core'
import { revealItemInDir } from '@tauri-apps/plugin-opener'
import { onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { useProblemStore } from '../stores/problemStore'
import type { DraftFileInfo, Language, WorkspaceEntry } from '../types'
import ResourceTreeNode from './ResourceTreeNode.vue'
import { useLongPressMove } from '../composables/useLongPressMove'
import { useWorkbenchStore } from '../stores/workbenchStore'
import { getDataCenterValue, saveDataCenterValue } from '../dataCenter'

const store = useProblemStore()
const workbench = useWorkbenchStore()
const entries = ref<WorkspaceEntry[]>([])
const rootPath = ref('')
const loading = ref(false)
const error = ref('')
const notice = ref('')
const savedTreeState = getDataCenterValue<{ version: 1; expandedPaths: string[] } | null>('workspace-tree-state', null)
const expandedPaths = ref(new Set(savedTreeState?.version === 1 ? savedTreeState.expandedPaths : []))
let treeStateInitialized = savedTreeState?.version === 1
const contextMenu = ref<{ x: number; y: number; entry: WorkspaceEntry | null } | null>(null)
const fileClipboard = ref<{ entry: WorkspaceEntry; cut: boolean } | null>(null)
const dialog = reactive({ open: false, mode: '' as 'file' | 'folder' | 'rename' | 'delete' | '', target: null as WorkspaceEntry | null, parentPath: '', name: '', language: 'cpp' as Language })

function findEntry(path: string, list = entries.value): WorkspaceEntry | null {
  for (const entry of list) {
    if (entry.path === path) return entry
    const child = findEntry(path, entry.children)
    if (child) return child
  }
  return null
}

function directoryPaths(list = entries.value): string[] {
  return list.flatMap((entry) => entry.isDirectory ? [entry.path, ...directoryPaths(entry.children)] : [])
}

function persistTreeState() {
  void saveDataCenterValue('workspace-tree-state', { version: 1, expandedPaths: [...expandedPaths.value] })
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

async function refresh() {
  loading.value = true
  error.value = ''
  try {
    ;[entries.value, rootPath.value] = await Promise.all([
      invoke<WorkspaceEntry[]>('list_workspace_entries'),
      invoke<string>('workspace_root_path'),
    ])
    const availableDirectories = new Set(directoryPaths())
    if (!treeStateInitialized) {
      expandedPaths.value = availableDirectories
      treeStateInitialized = true
      persistTreeState()
    } else {
      const existing = new Set([...expandedPaths.value].filter((path) => availableDirectories.has(path)))
      if (existing.size !== expandedPaths.value.size) {
        expandedPaths.value = existing
        persistTreeState()
      }
    }
    await store.loadDraftFiles()
  } catch (cause) { error.value = String(cause) }
  finally { loading.value = false }
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
  dialog.parentPath = mode === 'file' && !entry ? '' : mode === 'file' || mode === 'folder' ? parentOf(entry) : ''
  dialog.name = mode === 'rename' && entry ? entry.name : ''
  dialog.language = 'cpp'
}

function closeDialog() { dialog.open = false; dialog.mode = ''; dialog.target = null; dialog.name = '' }

async function submitDialog() {
  error.value = ''
  try {
    if (dialog.mode === 'file') {
      const file = await invoke<DraftFileInfo>('create_workspace_file', { parentPath: dialog.parentPath || null, name: dialog.name, language: dialog.language })
      closeDialog()
      await refresh()
      await store.openDraftFile(file)
    } else if (dialog.mode === 'folder') {
      await invoke('create_workspace_folder', { parentPath: dialog.parentPath || null, name: dialog.name })
      closeDialog()
      await refresh()
    } else if (dialog.mode === 'rename' && dialog.target) {
      const oldPath = dialog.target.path
      const newPath = await invoke<string>('rename_workspace_entry', { path: oldPath, newName: dialog.name })
      store.workspacePathChanged(oldPath, newPath)
      if (dialog.target.isDirectory) replaceExpandedPath(oldPath, newPath)
      closeDialog()
      await refresh()
    } else if (dialog.mode === 'delete' && dialog.target) {
      const deletedPath = dialog.target.path
      await invoke('delete_workspace_entry', { path: deletedPath })
      await store.workspacePathDeleted(deletedPath)
      if (dialog.target.isDirectory) replaceExpandedPath(deletedPath)
      closeDialog()
      await refresh()
    }
  } catch (cause) { error.value = String(cause) }
}

async function openEntry(entry: WorkspaceEntry) {
  if (holdMove.shouldSuppressClick()) return
  if (entry.draft) await store.openDraftFile(entry.draft).then(() => workbench.openCurrentCode()).catch((cause) => { error.value = String(cause) })
}

async function moveEntry(source: WorkspaceEntry, targetPath: string | null) {
  const target = targetPath ? findEntry(targetPath) : null
  const destinationPath = target?.isDirectory ? target.path : target ? parentOf(target) : rootPath.value
  try {
    const newPath = await invoke<string>('paste_workspace_entry', { sourcePath: source.path, destinationPath, cut: true })
    store.workspacePathChanged(source.path, newPath)
    if (source.isDirectory) replaceExpandedPath(source.path, newPath)
    notice.value = `已移动：${source.name}`
    await refresh()
  } catch (cause) { error.value = String(cause) }
}

const holdMove = useLongPressMove<WorkspaceEntry>({ targetAttribute: 'data-workspace-path', onMove: moveEntry })

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
    const destinationPath = destination?.isDirectory ? destination.path : parentOf(destination)
    const newPath = await invoke<string>('paste_workspace_entry', { sourcePath: source.entry.path, destinationPath, cut: source.cut })
    if (source.cut) {
      store.workspacePathChanged(source.entry.path, newPath)
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

function dismissMenu() { contextMenu.value = null }

onMounted(() => {
  refresh()
  window.addEventListener('click', dismissMenu)
  window.addEventListener('blur', dismissMenu)
})
onBeforeUnmount(() => {
  window.removeEventListener('click', dismissMenu)
  window.removeEventListener('blur', dismissMenu)
})
</script>

<template>
  <div class="explorer" @contextmenu.prevent="openContext(null, $event)">
    <div class="explorer__toolbar">
      <strong>本地代码</strong>
      <button title="新建文件" @click.stop="openDialog('file', null)">📄＋</button>
      <button title="新建文件夹" @click.stop="openDialog('folder', null)">📁＋</button>
      <button title="刷新" :disabled="loading" @click.stop="refresh">↻</button>
    </div>
    <div class="explorer__root" :title="rootPath">{{ rootPath || 'solutions' }}</div>
    <div v-if="notice" class="explorer__notice">{{ notice }}</div>
    <div v-if="error" class="explorer__error">{{ error }}</div>
    <div v-if="loading && !entries.length" class="explorer__empty">正在读取本地文件…</div>
    <div v-else-if="!entries.length" class="explorer__empty">尚无本地代码。右键空白处即可新建。</div>
    <div class="explorer__tree">
      <ResourceTreeNode v-for="entry in entries" :key="entry.path" :entry="entry" :active-path="store.draftPath" :moving-path="holdMove.movingPath.value" :target-path="holdMove.targetPath.value" :expanded-paths="expandedPaths" @open="openEntry" @context="openContext" @hold="holdMove.begin" @toggle="setFolderExpanded" />
    </div>
    <div v-if="holdMove.movingPath.value" class="explorer__move-hint">移动到目标文件夹后松开</div>

    <div v-if="contextMenu" class="context-menu" :style="{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px` }" @click.stop>
      <button v-if="contextMenu.entry && !contextMenu.entry.isDirectory" @click="openEntry(contextMenu.entry); contextMenu = null">打开</button>
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
    </div>

    <div v-if="dialog.open" class="entry-dialog" @click.self="closeDialog">
      <form @submit.prevent="submitDialog">
        <h3>{{ dialog.mode === 'file' ? '新建代码文件' : dialog.mode === 'folder' ? '新建文件夹' : dialog.mode === 'rename' ? '重命名' : '确认删除' }}</h3>
        <template v-if="dialog.mode !== 'delete'">
          <label>名称<input v-model="dialog.name" autofocus :placeholder="dialog.mode === 'file' ? '例如 solution 或 solution.cpp' : '输入名称'" /></label>
          <label v-if="dialog.mode === 'file'">语言<select v-model="dialog.language"><option value="cpp">C++</option><option value="python">Python</option><option value="java">Java</option></select></label>
          <p v-if="dialog.mode === 'file' || dialog.mode === 'folder'">建立位置：{{ dialog.parentPath || (dialog.mode === 'file' ? '今天的日期文件夹' : rootPath) }}</p>
        </template>
        <p v-else class="delete-warning">将永久删除“{{ dialog.target?.name }}”<template v-if="dialog.target?.isDirectory">及其中的全部文件</template>。此操作无法在应用内撤销。</p>
        <div class="entry-dialog__actions"><button type="button" @click="closeDialog">取消</button><button type="submit" :class="{ danger: dialog.mode === 'delete' }" :disabled="dialog.mode !== 'delete' && !dialog.name.trim()">{{ dialog.mode === 'delete' ? '确认删除' : '确定' }}</button></div>
      </form>
    </div>
  </div>
</template>

<style scoped lang="scss">
.explorer { position: relative; height: 100%; display: flex; flex-direction: column; min-height: 0; color: var(--color-tone-ccc); }
.explorer__toolbar { display: flex; align-items: center; gap: 4px; padding: 8px 9px; border-bottom: 1px solid var(--color-bg-subtle); strong { flex: 1; font-size: 13px; } button { padding: 4px 6px; border: 0; border-radius: 3px; background: transparent; color: var(--color-text-soft); font-size: 12px; cursor: pointer; &:hover { background: var(--color-bg-selected); color: var(--color-text-on-subtle-selection); } } }
.explorer__root { overflow: hidden; padding: 5px 9px; border-bottom: 1px solid var(--color-bg-raised); color: var(--color-text-disabled); font: 8px Consolas, monospace; text-overflow: ellipsis; white-space: nowrap; }
.explorer__tree { flex: 1; overflow: auto; padding: 8px 8px 18px; }
.explorer__move-hint { position: absolute; right: 7px; bottom: 7px; left: 7px; z-index: 5; padding: 6px; border: 1px solid var(--color-accent); border-radius: 4px; background: var(--color-accent-surface-hover); color: var(--color-accent-text); text-align: center; font-size: 9px; }
.explorer__error, .explorer__notice { padding: 6px 9px; font-size: 10px; line-height: 1.4; }.explorer__error { color: var(--color-danger); background: var(--color-danger-surface); }.explorer__notice { color: var(--color-tone-76c99b); background: var(--color-tone-1d3025); }
.explorer__empty { padding: 30px 12px; text-align: center; color: var(--color-text-disabled); font-size: 12px; }
.context-menu { position: fixed; z-index: 1900; width: 220px; padding: 6px; border: 1px solid var(--color-border-strong); border-radius: 6px; background: var(--color-bg-panel); box-shadow: 0 8px 24px var(--color-overlay); font-family: var(--font-ui); button { display: block; width: 100%; min-height: 32px; padding: 7px 11px; border: 0; border-radius: 4px; background: transparent; color: var(--color-text-strong); text-align: left; font-size: 13px; cursor: pointer; span { display: block; overflow: hidden; color: var(--color-text-faint); font-size: 11px; text-overflow: ellipsis; white-space: nowrap; } &:hover:not(:disabled) { background: var(--color-tone-094771); color: var(--color-text-on-accent); } &:disabled { color: var(--color-text-disabled); cursor: default; } &.danger { color: var(--color-danger); &:hover { background: var(--color-tone-6b2525); color: var(--color-text-on-accent); } } } &__line { height: 1px; margin: 4px 6px; background: var(--color-border-control); } }
.entry-dialog { position: fixed; inset: 0; z-index: 1950; display: flex; align-items: center; justify-content: center; background: var(--color-tone-0008); form { width: min(360px, 86vw); padding: 16px; border: 1px solid var(--color-border-strong); border-radius: 7px; background: var(--color-bg-panel); box-shadow: 0 15px 40px var(--color-overlay); } h3 { margin: 0 0 13px; font-size: 14px; } label { display: block; margin-bottom: 9px; color: var(--color-text-soft); font-size: 10px; } input, select { box-sizing: border-box; width: 100%; margin-top: 4px; padding: 7px; border: 1px solid var(--color-border-input); border-radius: 4px; outline: none; background: var(--color-bg-deep); color: var(--color-text-strong); &:focus { border-color: var(--color-accent); } } p { overflow-wrap: anywhere; color: var(--color-text-faint); font-size: 9px; line-height: 1.5; } &__actions { display: flex; justify-content: space-between; gap: 7px; margin-top: 14px; button { padding: 6px 13px; border: 0; border-radius: 4px; background: var(--color-border-control); color: var(--color-text-on-accent); cursor: pointer; &[type='submit'] { background: var(--color-accent-strong); } &.danger { background: var(--color-tone-9a3535); } &:disabled { opacity: .4; } } } .delete-warning { color: var(--color-tone-e6b1a8); font-size: 11px; } }
</style>
