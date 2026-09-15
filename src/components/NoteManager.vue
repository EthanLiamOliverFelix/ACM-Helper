<script setup lang="ts">
import { onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { revealItemInDir } from '@tauri-apps/plugin-opener'
import type { NoteEntry } from '../types'
import { useNoteStore } from '../stores/noteStore'
import { useLongPressMove } from '../composables/useLongPressMove'
import NoteTreeNode from './NoteTreeNode.vue'
import MarkdownNoteEditor from './MarkdownNoteEditor.vue'

const emit = defineEmits<{ close: [] }>()
const notes = useNoteStore()
const mode = ref<'read' | 'edit'>('read')
const notice = ref('')
const contextMenu = ref<{ x: number; y: number; entry: NoteEntry | null } | null>(null)
const clipboard = ref<{ entry: NoteEntry; cut: boolean } | null>(null)
const dialog = reactive({ open: false, mode: '' as 'file' | 'folder' | 'rename' | 'delete' | '', target: null as NoteEntry | null, parentPath: '', name: '' })

function flash(message: string) {
  notice.value = message
  window.setTimeout(() => { if (notice.value === message) notice.value = '' }, 1800)
}

function parentOf(entry: NoteEntry | null) {
  if (!entry) return notes.rootPath
  if (entry.isDirectory) return entry.path
  const separator = Math.max(entry.path.lastIndexOf('\\'), entry.path.lastIndexOf('/'))
  return separator >= 0 ? entry.path.slice(0, separator) : notes.rootPath
}

function findEntry(path: string, list = notes.entries): NoteEntry | null {
  for (const entry of list) {
    if (entry.path === path) return entry
    const child = findEntry(path, entry.children)
    if (child) return child
  }
  return null
}

async function moveEntry(source: NoteEntry, targetPath: string | null) {
  const target = targetPath ? findEntry(targetPath) : null
  const destination = target?.isDirectory ? target.path : parentOf(target)
  try {
    await notes.pasteEntry(source.path, destination || null, true)
    flash(`已移动：${source.name}`)
  } catch (cause) { notes.error = String(cause) }
}

const holdMove = useLongPressMove<NoteEntry>({ targetAttribute: 'data-note-path', onMove: moveEntry })

async function openEntry(entry: NoteEntry) {
  if (holdMove.shouldSuppressClick() || entry.isDirectory) return
  try { await notes.openPath(entry.path); mode.value = 'read' }
  catch (cause) { notes.error = String(cause) }
}

function openContext(entry: NoteEntry | null, event: MouseEvent) {
  contextMenu.value = { x: Math.min(event.clientX, window.innerWidth - 195), y: Math.max(42, Math.min(event.clientY, window.innerHeight - 360)), entry }
}

function openDialog(kind: typeof dialog.mode, entry: NoteEntry | null = contextMenu.value?.entry ?? null) {
  contextMenu.value = null
  dialog.open = true
  dialog.mode = kind
  dialog.target = entry
  dialog.parentPath = kind === 'file' || kind === 'folder' ? parentOf(entry) : ''
  dialog.name = kind === 'rename' && entry ? entry.name.replace(/\.md$/i, '') : ''
}

function closeDialog() { dialog.open = false; dialog.mode = ''; dialog.target = null; dialog.name = '' }

async function submitDialog() {
  notes.error = ''
  try {
    if (dialog.mode === 'file') {
      await notes.createFile(dialog.parentPath || null, dialog.name)
      mode.value = 'edit'
    } else if (dialog.mode === 'folder') await notes.createFolder(dialog.parentPath || null, dialog.name)
    else if (dialog.mode === 'rename' && dialog.target) await notes.renameEntry(dialog.target.path, dialog.name)
    else if (dialog.mode === 'delete' && dialog.target) await notes.deleteEntry(dialog.target.path)
    closeDialog()
  } catch (cause) { notes.error = String(cause) }
}

function stage(entry: NoteEntry, cut: boolean) {
  clipboard.value = { entry, cut }
  flash(`${cut ? '已剪切' : '已复制'}：${entry.name}`)
  contextMenu.value = null
}

async function paste(destination: NoteEntry | null) {
  if (!clipboard.value) return
  try {
    await notes.pasteEntry(clipboard.value.entry.path, parentOf(destination) || null, clipboard.value.cut)
    flash(clipboard.value.cut ? '移动完成' : '复制完成')
    if (clipboard.value.cut) clipboard.value = null
    contextMenu.value = null
  } catch (cause) { notes.error = String(cause) }
}

async function copyPath(path: string) {
  await navigator.clipboard.writeText(path)
  flash('路径已复制')
  contextMenu.value = null
}

function fileUrl(path: string) {
  const normalized = path.replace(/\\/g, '/')
  return encodeURI(`file:///${normalized.replace(/^\/+/, '')}`)
}

async function copyFileUrl(path: string) {
  await navigator.clipboard.writeText(fileUrl(path))
  flash('文件链接已复制')
  contextMenu.value = null
}

async function closeManager() {
  await notes.saveActive().catch(() => undefined)
  emit('close')
}

function dismissMenu() { contextMenu.value = null }
onMounted(() => {
  notes.refresh()
  window.addEventListener('click', dismissMenu)
  window.addEventListener('blur', dismissMenu)
})
onBeforeUnmount(() => {
  window.removeEventListener('click', dismissMenu)
  window.removeEventListener('blur', dismissMenu)
})
</script>

<template>
  <section class="note-manager">
    <header class="note-manager__header">
      <div><h2>算法笔记本</h2><span>所有笔记保存在本地 Markdown 文件中</span></div>
      <button class="close" @click="closeManager">×</button>
    </header>
    <div class="note-manager__body">
      <aside class="note-sidebar" @contextmenu.prevent="openContext(null, $event)">
        <div class="note-sidebar__toolbar"><strong>笔记目录</strong><button title="新建笔记" @click.stop="openDialog('file', null)">📄＋</button><button title="新建文件夹" @click.stop="openDialog('folder', null)">📁＋</button><button title="刷新" @click.stop="notes.refresh">↻</button></div>
        <div class="note-sidebar__root" :title="notes.rootPath">{{ notes.rootPath || 'notes' }}</div>
        <div v-if="notice" class="notice">{{ notice }}</div><div v-if="notes.error" class="error">{{ notes.error }}</div>
        <div v-if="notes.loading && !notes.entries.length" class="empty">正在读取笔记…</div>
        <div v-else-if="!notes.entries.length" class="empty">还没有笔记。点击上方按钮即可创建。</div>
        <div class="note-tree">
          <NoteTreeNode v-for="entry in notes.entries" :key="entry.path" :entry="entry" :active-path="notes.activeNote?.path" :moving-path="holdMove.movingPath.value" :target-path="holdMove.targetPath.value" @open="openEntry" @context="openContext" @hold="holdMove.begin" />
        </div>
        <div v-if="holdMove.movingPath.value" class="move-hint">移动到目标文件夹后松开</div>
      </aside>
      <main class="note-workspace">
        <template v-if="notes.activeNote">
          <header class="note-workspace__header">
            <div><strong>{{ notes.activeNote.name.replace(/\.md$/i, '') }}</strong><span :title="notes.activeNote.path">{{ notes.activeNote.path }}</span></div>
            <div class="mode-tabs"><button :class="{ active: mode === 'read' }" @click="notes.saveActive(); mode = 'read'">只读</button><button :class="{ active: mode === 'edit' }" @click="mode = 'edit'">编辑</button><button v-if="mode === 'edit'" class="save" :disabled="notes.saving || !notes.dirty" @click="notes.saveActive">{{ notes.saving ? '保存中…' : notes.dirty ? '保存' : '已保存' }}</button></div>
          </header>
          <MarkdownNoteEditor :model-value="notes.activeNote.content" :mode="mode" :note-path="notes.activeNote.path" @update:model-value="notes.updateContent" @save="notes.saveActive" />
        </template>
        <div v-else class="welcome"><strong>选择一篇笔记</strong><p>左侧可以创建笔记和文件夹；题目标题栏创建的笔记会先放进“未归档”。</p><p>长按文件或文件夹，再拖到目标位置即可移动。</p></div>
      </main>
    </div>

    <div v-if="contextMenu" class="context-menu" :style="{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px` }" @click.stop>
      <button v-if="contextMenu.entry && !contextMenu.entry.isDirectory" @click="openEntry(contextMenu.entry); contextMenu = null">打开</button>
      <button @click="openDialog('file')">新建笔记…</button><button @click="openDialog('folder')">新建文件夹…</button>
      <div v-if="contextMenu.entry" class="line" /><button v-if="contextMenu.entry" @click="openDialog('rename')">重命名…</button><button v-if="contextMenu.entry" class="danger" @click="openDialog('delete')">删除…</button>
      <div class="line" /><button v-if="contextMenu.entry" @click="stage(contextMenu.entry, true)">剪切</button><button v-if="contextMenu.entry" @click="stage(contextMenu.entry, false)">复制</button><button :disabled="!clipboard" @click="paste(contextMenu.entry)">粘贴</button>
      <div class="line" /><button @click="copyPath(contextMenu.entry?.path || notes.rootPath)">复制路径</button><button @click="copyFileUrl(contextMenu.entry?.path || notes.rootPath)">复制文件链接</button><button @click="revealItemInDir(contextMenu.entry?.path || notes.rootPath); contextMenu = null">在文件资源管理器中显示</button>
    </div>

    <div v-if="dialog.open" class="note-dialog" @click.self="closeDialog">
      <form @submit.prevent="submitDialog"><h3>{{ dialog.mode === 'file' ? '新建笔记' : dialog.mode === 'folder' ? '新建文件夹' : dialog.mode === 'rename' ? '重命名' : '确认删除' }}</h3>
        <template v-if="dialog.mode !== 'delete'"><label>名称<input v-model="dialog.name" autofocus :placeholder="dialog.mode === 'file' ? '例如 最短路总结' : '输入文件夹名称'" /></label><p>位置：{{ dialog.parentPath || notes.rootPath }}</p></template>
        <p v-else class="warning">将永久删除“{{ dialog.target?.name }}”<template v-if="dialog.target?.isDirectory">及其中全部笔记</template>。此操作无法在应用内撤销。</p>
        <div class="actions"><button type="button" @click="closeDialog">取消</button><button type="submit" :class="{ danger: dialog.mode === 'delete' }" :disabled="dialog.mode !== 'delete' && !dialog.name.trim()">{{ dialog.mode === 'delete' ? '确认删除' : '确定' }}</button></div>
      </form>
    </div>
  </section>
</template>

<style scoped lang="scss">
.note-manager { height: 100%; display: flex; flex-direction: column; overflow: hidden; background: var(--color-bg-deep); color: var(--color-text-primary); &__header { display: flex; align-items: center; padding: 12px 18px; border-bottom: 1px solid var(--color-border); background: var(--color-bg-app); > div { min-width: 0; flex: 1; } h2 { margin: 0; font-size: 18px; } span { color: var(--color-text-faint); font-size: 10px; } .close { border: 0; background: transparent; color: var(--color-text-soft); font-size: 25px; cursor: pointer; } } &__body { min-height: 0; flex: 1; display: grid; grid-template-columns: minmax(220px, 290px) 1fr; } }
.note-sidebar { position: relative; min-width: 0; display: flex; flex-direction: column; border-right: 1px solid var(--color-border); background: var(--color-bg-app); &__toolbar { display: flex; align-items: center; gap: 3px; padding: 7px 8px; border-bottom: 1px solid var(--color-bg-subtle); strong { flex: 1; font-size: 11px; } button { padding: 3px 5px; border: 0; border-radius: 3px; background: transparent; color: var(--color-text-soft); cursor: pointer; &:hover { background: var(--color-bg-selected); color: var(--color-text-on-subtle-selection); } } } &__root { overflow: hidden; padding: 5px 9px; border-bottom: 1px solid var(--color-bg-raised); color: var(--color-text-disabled); font: 8px Consolas, monospace; text-overflow: ellipsis; white-space: nowrap; } }.note-tree { min-height: 0; flex: 1; overflow: auto; padding: 6px 7px 20px; }.move-hint { position: absolute; right: 8px; bottom: 8px; left: 8px; padding: 6px; border: 1px solid var(--color-accent); border-radius: 4px; background: var(--color-accent-surface-hover); color: var(--color-accent-text); text-align: center; font-size: 9px; }
.note-workspace { min-width: 0; min-height: 0; display: flex; flex-direction: column; &__header { display: flex; align-items: center; gap: 12px; padding: 8px 12px; border-bottom: 1px solid var(--color-border); background: var(--color-bg-panel); > div:first-child { min-width: 0; flex: 1; display: flex; flex-direction: column; } strong { font-size: 13px; } span { overflow: hidden; color: var(--color-text-faint); font: 8px Consolas, monospace; text-overflow: ellipsis; white-space: nowrap; } } }.mode-tabs { display: flex; flex-direction: row !important; gap: 3px; button { padding: 5px 9px; border: 1px solid var(--color-border-control); border-radius: 4px; background: var(--color-bg-control-alt); color: var(--color-text-soft); font-size: 10px; cursor: pointer; &.active { border-color: var(--color-accent-border); background: var(--color-accent-surface-hover); color: var(--color-accent-text); } &.save { border-color: var(--color-tone-39704f); background: var(--color-tone-20372a); color: var(--color-tone-8ad0a1); } &:disabled { opacity: .55; } } }.welcome { display: grid; place-content: center; height: 100%; padding: 30px; color: var(--color-text-faint); text-align: center; strong { color: var(--color-text-secondary); font-size: 17px; } p { max-width: 470px; margin: 8px 0 0; font-size: 11px; } }
.notice, .error { padding: 6px 9px; font-size: 9px; }.notice { color: var(--color-tone-76c99b); background: var(--color-tone-1d3025); }.error { color: var(--color-danger); background: var(--color-danger-surface); overflow-wrap: anywhere; }.empty { padding: 25px 12px; color: var(--color-text-disabled); text-align: center; font-size: 10px; }
.context-menu { position: fixed; z-index: 1900; width: 185px; padding: 4px; border: 1px solid var(--color-border-strong); border-radius: 5px; background: var(--color-bg-panel); box-shadow: 0 8px 24px var(--color-overlay); button { display: block; width: 100%; padding: 6px 9px; border: 0; border-radius: 3px; background: transparent; color: var(--color-text-strong); text-align: left; font-size: 10px; cursor: pointer; &:hover:not(:disabled) { background: var(--color-tone-094771); color: var(--color-text-on-accent); } &:disabled { color: var(--color-text-disabled); } &.danger { color: var(--color-danger); } } .line { height: 1px; margin: 3px 5px; background: var(--color-border-control); } }
.note-dialog { position: fixed; inset: 0; z-index: 1950; display: grid; place-items: center; background: var(--color-tone-0008); form { width: min(370px, 86vw); padding: 16px; border: 1px solid var(--color-border-strong); border-radius: 7px; background: var(--color-bg-panel); box-shadow: 0 15px 40px var(--color-overlay); } h3 { margin: 0 0 13px; font-size: 14px; } label { color: var(--color-text-soft); font-size: 10px; } input { box-sizing: border-box; width: 100%; margin-top: 5px; padding: 7px; border: 1px solid var(--color-border-input); border-radius: 4px; outline: none; background: var(--color-bg-deep); color: var(--color-text-strong); &:focus { border-color: var(--color-accent); } } p { color: var(--color-text-faint); font-size: 9px; overflow-wrap: anywhere; } .warning { color: var(--color-tone-e6b1a8); font-size: 11px; } .actions { display: flex; justify-content: space-between; margin-top: 14px; button { padding: 6px 13px; border: 0; border-radius: 4px; background: var(--color-border-control); color: var(--color-text-on-accent); cursor: pointer; &[type='submit'] { background: var(--color-accent-strong); } &.danger { background: var(--color-tone-9a3535); } &:disabled { opacity: .4; } } } }
:global(body.is-longpress-moving) { cursor: grabbing !important; user-select: none !important; }
</style>
