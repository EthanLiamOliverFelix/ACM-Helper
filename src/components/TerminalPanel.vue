<script setup lang="ts">
import { computed, markRaw, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { Channel, invoke } from '@tauri-apps/api/core'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { useProblemStore } from '../stores/problemStore'
import { useWorkbenchStore } from '../stores/workbenchStore'
import { usePointerResize } from '../composables/usePointerResize'

const props = defineProps<{ visible: boolean }>()
const store = useProblemStore()
const workbench = useWorkbenchStore()
const { startPointerResize } = usePointerResize()
type Session = { key: number; id?: number; label: string; directory: string; terminal: Terminal; fit: FitAddon; host?: HTMLElement; observer?: ResizeObserver; busy: boolean; exited: boolean; disposed: boolean; error: string; pending: string; queue: Promise<void>; starting?: Promise<void> }
const sessions = ref<Session[]>([])
const selected = ref(0)
const active = computed(() => sessions.value.find(session => session.key === selected.value))
const error = ref('')
const listWidth = ref(180)
const body = ref<HTMLElement>()
let nextKey = 0
let disposed = false
let lastRequest = 0
let themeObserver: MutationObserver | undefined

function updateTheme(session: Session) {
  if (!session.host) return
  const style = getComputedStyle(session.host)
  session.terminal.options.theme = { background: style.getPropertyValue('--color-bg-deep').trim(), foreground: style.getPropertyValue('--color-text-primary').trim(), cursor: style.getPropertyValue('--color-text-primary').trim() }
}
function resize(session = active.value) {
  if (!session || session.disposed || !props.visible || session.key !== selected.value || !session.host?.clientWidth || !session.host.clientHeight) return
  session.fit.fit()
  if (session.id != null && !session.exited) void invoke('resize_terminal', { id: session.id, cols: session.terminal.cols, rows: session.terminal.rows }).catch(cause => { session.error = String(cause) })
}
async function send(session: Session, data: string) {
  if (session.disposed || session.exited) return
  if (session.id == null) { if (session.busy) session.pending += data; return }
  const id = session.id
  session.queue = session.queue.then(() => session.disposed ? undefined : invoke<void>('write_terminal', { id, data })).catch(cause => { if (!session.disposed) session.error = String(cause) })
  await session.queue
}
function mountHost(session: Session, element: unknown) {
  if (!(element instanceof HTMLElement) || session.host) return
  session.host = markRaw(element)
  session.terminal.open(element)
  updateTheme(session)
  session.terminal.onData(data => { void send(session, data) })
  session.observer = markRaw(new ResizeObserver(() => resize(session)))
  session.observer.observe(element)
}
async function createSession() {
  error.value = ''
  const path = store.draftPath || null
  const key = ++nextKey
  const terminal = markRaw(new Terminal({ fontSize: 13, fontFamily: '"Cascadia Mono", Consolas, monospace', cursorBlink: true, scrollback: 5000 }))
  const fit = markRaw(new FitAddon())
  terminal.loadAddon(fit)
  const session = reactive<Session>({ key, label: `${path?.split(/[\\/]/).pop() || 'PowerShell'} · ${key}`, directory: '', terminal, fit, busy: true, exited: false, disposed: false, error: '', pending: '', queue: markRaw(Promise.resolve()) })
  sessions.value.push(session)
  selected.value = key
  session.starting = markRaw((async () => {
    try {
      await nextTick()
      if (session.disposed) return
      resize(session)
      const output = new Channel<{ data: number[]; exited: boolean }>()
      output.onmessage = message => {
        if (session.disposed) return
        if (message.data.length) terminal.write(new Uint8Array(message.data))
        if (message.exited) { session.exited = true; terminal.writeln('\r\n[终端已结束]') }
      }
      const result = await invoke<{ id: number; directory: string }>('start_terminal', { path, cols: terminal.cols, rows: terminal.rows, output })
      if (session.disposed || disposed) { await invoke('close_terminal', { id: result.id }); return }
      session.id = result.id
      session.directory = result.directory
      if (session.pending) { const pending = session.pending; session.pending = ''; await send(session, pending) }
      if (selected.value === key && props.visible) terminal.focus()
    } catch (cause) { if (!session.disposed) session.error = String(cause) }
    finally { session.busy = false }
  })())
  await session.starting
  return session
}
async function removeSession(session: Session) {
  session.disposed = true
  const index = sessions.value.findIndex(item => item.key === session.key)
  sessions.value.splice(index, 1)
  session.observer?.disconnect()
  session.terminal.dispose()
  if (selected.value === session.key) selected.value = sessions.value[Math.min(index, sessions.value.length - 1)]?.key ?? 0
  if (session.id != null) await invoke('close_terminal', { id: session.id }).catch(cause => { error.value = String(cause) })
}
async function run(action: 'run' | 'compile-run' | 'compile') {
  if (workbench.terminalRunning || active.value?.busy) return
  workbench.terminalRunning = true
  error.value = ''
  let session = active.value
  try {
    await store.persistDraft()
    if (!store.draftPath) throw new Error('请先修改并保存代码，再运行')
    if (!session || session.exited || session.id == null) session = await createSession()
    if (session.id == null || session.exited || session.disposed) return
    session.busy = true
    session.error = ''
    const command = await invoke<string>('terminal_run_command', { path: store.draftPath, language: store.currentLanguage, action })
    await send(session, command)
    session.terminal.focus()
  } catch (cause) { error.value = String(cause) }
  finally { workbench.terminalRunning = false; if (session) session.busy = false }
}
function resizeList(event: PointerEvent) {
  const startX = event.clientX
  const startWidth = listWidth.value
  const maximum = Math.max(110, (body.value?.clientWidth ?? 500) - 180)
  startPointerResize(event, { axis: 'x', onMove: current => { listWidth.value = Math.max(110, Math.min(maximum, startWidth + startX - current.clientX)) } })
}
async function handleRequest() {
  const request = { ...workbench.terminalRequest }
  if (request.sequence <= lastRequest) return
  lastRequest = request.sequence
  if (active.value?.starting) await active.value.starting
  if (disposed) return
  if (request.action !== 'show') await run(request.action === 'run' ? 'compile-run' : request.action === 'run-existing' ? 'run' : 'compile')
  else { if (!active.value) await createSession(); resize(); active.value?.terminal.focus() }
}
watch(() => workbench.terminalRequest.sequence, () => { void handleRequest() })
watch([selected, () => props.visible, () => sessions.value.length], async () => { await nextTick(); resize(); if (props.visible) active.value?.terminal.focus() })
onMounted(async () => {
  themeObserver = new MutationObserver(() => sessions.value.forEach(updateTheme))
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
  await createSession()
  if (!disposed) await handleRequest()
})
onBeforeUnmount(() => {
  disposed = true
  themeObserver?.disconnect()
  for (const session of [...sessions.value]) void removeSession(session)
})
</script>
<template>
  <div class="terminal-panel" data-sidebar-shortcut-ignore>
    <Teleport to="#terminal-panel-actions">
      <div v-show="visible" class="terminal-actions" data-sidebar-shortcut-ignore>
        <button title="清屏" aria-label="清屏" :disabled="!active" @click="active?.terminal.clear(); active?.terminal.focus()"><i class="codicon codicon-clear-all" /></button>
        <button title="新建终端" aria-label="新建终端" @click="createSession()"><i class="codicon codicon-add" /></button>
        <button title="终止并删除终端" aria-label="终止并删除终端" :disabled="!active" @click="active && removeSession(active)"><i class="codicon codicon-trash" /></button>
      </div>
    </Teleport>
    <div v-if="error || active?.error" class="terminal-error" role="alert">{{ error || active?.error }}</div>
    <div ref="body" class="terminal-body">
      <div class="terminal-content">
        <div v-for="session in sessions" v-show="selected === session.key" :key="session.key" :ref="element => mountHost(session, element)" class="terminal-host" />
        <div v-if="!sessions.length" class="terminal-empty">点击 + 新建终端</div>
      </div>
      <template v-if="sessions.length > 1">
        <div class="terminal-list-divider" role="separator" aria-label="调整终端列表宽度" aria-orientation="vertical" title="拖动调整终端列表宽度" @pointerdown="resizeList" />
        <div class="terminal-list" :style="{ width: `${listWidth}px` }" role="tablist" aria-label="终端列表">
          <div v-for="session in sessions" :key="session.key" class="terminal-list-row" :class="{ selected: selected === session.key }">
            <button role="tab" :aria-selected="selected === session.key" :title="session.directory || session.label" @click="selected = session.key"><i class="codicon codicon-terminal" /><span>{{ session.label }}</span></button>
            <button class="terminal-row-delete" :title="`终止并删除 ${session.label}`" :aria-label="`终止并删除 ${session.label}`" @click="removeSession(session)"><i class="codicon codicon-trash" /></button>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>
<style scoped>
.terminal-panel { display:flex; flex:1; flex-direction:column; min-height:0; overflow:hidden; }
.terminal-actions { display:flex; align-items:center; gap:2px; }
.terminal-actions button, .terminal-list button { border:0; background:transparent; color:var(--color-text-secondary); cursor:pointer; }
.terminal-actions button { display:flex; align-items:center; justify-content:center; width:26px; height:26px; border-radius:3px; }
.terminal-actions button:hover, .terminal-list-row:hover { background:var(--color-bg-control); }
.terminal-actions button:disabled { opacity:.4; cursor:default; }
.terminal-actions .codicon { font-size:17px; }
.terminal-body { display:flex; flex:1; min-height:0; }
.terminal-content { flex:1; min-width:0; display:flex; }
.terminal-host { flex:1; min-width:0; min-height:0; padding:6px 10px; overflow:hidden; }
.terminal-host :deep(.xterm) { height:100%; }
.terminal-error { padding:4px 10px; color:var(--color-danger); font-size:12px; }
.terminal-empty { margin:auto; color:var(--color-text-muted); font-size:12px; }
.terminal-list { flex-shrink:0; overflow:auto; padding:4px 0; }
.terminal-list-divider { width:5px; flex-shrink:0; border-left:1px solid var(--color-tone-353535); cursor:col-resize; touch-action:none; }
.terminal-list-divider:hover { background:var(--color-accent); }
.terminal-list-row { display:flex; align-items:center; height:30px; border-left:2px solid transparent; }
.terminal-list-row.selected { border-left-color:var(--color-accent); background:var(--color-bg-control); }
.terminal-list-row > button:first-child { display:flex; align-items:center; gap:7px; flex:1; min-width:0; height:100%; text-align:left; padding:0 6px; }
.terminal-list-row span { white-space:nowrap; overflow:hidden; text-overflow:ellipsis; font-size:12px; }
.terminal-row-delete { opacity:0; width:26px; height:26px; flex-shrink:0; }
.terminal-list-row:hover .terminal-row-delete, .terminal-list-row:focus-within .terminal-row-delete { opacity:1; }
</style>
