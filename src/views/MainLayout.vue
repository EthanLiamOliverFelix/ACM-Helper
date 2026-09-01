<script setup lang="ts">
import { defineAsyncComponent, onBeforeUnmount, onMounted, reactive, watch } from 'vue'
import { useProblemStore } from '../stores/problemStore'
import Sidebar from '../components/Sidebar.vue'
import ProblemList from '../components/ProblemList.vue'
import { useLearningStore } from '../stores/learningStore'
import TopBar from '../components/TopBar.vue'
import { getDataCenterValue, saveDataCenterValue } from '../dataCenter'

const ProblemDesc = defineAsyncComponent(() => import('../components/ProblemDesc.vue'))
const CodeEditor = defineAsyncComponent(() => import('../components/CodeEditor.vue'))
const CompileWorkbench = defineAsyncComponent(() => import('../components/CompileWorkbench.vue'))
const SubmitPanel = defineAsyncComponent(() => import('../components/SubmitPanel.vue'))
const LearningPanel = defineAsyncComponent(() => import('../components/LearningPanel.vue'))
const AiAssistant = defineAsyncComponent(() => import('../components/AiAssistant.vue'))

const store = useProblemStore()
const learning = useLearningStore()
const savedLayout = getDataCenterValue<{
  sidebar?: number
  right?: number
  statement?: number
  showSidebar?: boolean
  showStatement?: boolean
  showEditor?: boolean
  showRunner?: boolean
}>('ui-layout', {})
const layout = reactive({
  sidebar: savedLayout.sidebar ?? 300,
  right: savedLayout.right ?? 320,
  statement: savedLayout.statement ?? 42,
  showSidebar: savedLayout.showSidebar ?? true,
  showStatement: savedLayout.showStatement ?? true,
  showEditor: savedLayout.showEditor ?? true,
  showRunner: savedLayout.showRunner ?? true,
})
let resizing: null | { kind: 'sidebar' | 'right' | 'statement'; startX: number; startY: number; startValue: number } = null

function saveLayout() { void saveDataCenterValue('ui-layout', layout) }
function startResize(kind: 'sidebar' | 'right' | 'statement', event: PointerEvent) {
  resizing = { kind, startX: event.clientX, startY: event.clientY, startValue: kind === 'statement' ? layout.statement : layout[kind] }
  document.body.classList.add('is-resizing')
  event.preventDefault()
}
function resize(event: PointerEvent) {
  if (!resizing) return
  if (resizing.kind === 'sidebar') layout.sidebar = Math.min(520, Math.max(220, resizing.startValue + event.clientX - resizing.startX))
  else if (resizing.kind === 'right') layout.right = Math.min(560, Math.max(260, resizing.startValue - event.clientX + resizing.startX))
  else {
    const center = document.querySelector('.main-layout__center') as HTMLElement | null
    if (center) layout.statement = Math.min(78, Math.max(20, resizing.startValue + (event.clientY - resizing.startY) / center.clientHeight * 100))
  }
}
function stopResize() { if (!resizing) return; resizing = null; document.body.classList.remove('is-resizing'); saveLayout() }
function toggle(key: 'showSidebar' | 'showStatement' | 'showEditor' | 'showRunner') { layout[key] = !layout[key]; saveLayout() }

watch(() => store.runnerMode, (mode) => {
  if (mode === 'debug' && !layout.showRunner) {
    layout.showRunner = true
    saveLayout()
  }
})

onMounted(() => {
  store.initApp()
  learning.init()
  window.addEventListener('pointermove', resize)
  window.addEventListener('pointerup', stopResize)
})
onBeforeUnmount(() => { window.removeEventListener('pointermove', resize); window.removeEventListener('pointerup', stopResize) })
</script>

<template>
  <div class="main-layout">
    <TopBar :layout="layout" @toggle-view="toggle" />
    <div class="main-layout__body">
    <Sidebar v-if="layout.showSidebar" :style="{ width: `${layout.sidebar}px`, minWidth: `${layout.sidebar}px` }">
      <ProblemList />
    </Sidebar>
    <div v-if="layout.showSidebar && store.activeView === 'workspace'" class="resize-handle resize-handle--x" @pointerdown="startResize('sidebar', $event)" />

    <LearningPanel v-if="store.activeView === 'learning'" class="main-layout__learning" />
    <AiAssistant v-else-if="store.activeView === 'ai'" />

    <div v-else class="main-layout__center">
      <div v-if="layout.showStatement" class="main-layout__desc" :style="{ flexBasis: layout.showEditor ? `${layout.statement}%` : '100%' }">
        <ProblemDesc />
      </div>
      <div v-if="layout.showStatement && layout.showEditor" class="resize-handle resize-handle--y" @pointerdown="startResize('statement', $event)" />
      <div v-if="layout.showEditor" class="main-layout__editor">
        <div class="main-layout__editor-main"><CodeEditor /></div>
        <CompileWorkbench />
      </div>
    </div>

    <div v-if="store.activeView === 'workspace' && layout.showRunner" class="resize-handle resize-handle--x" @pointerdown="startResize('right', $event)" />
    <div v-if="store.activeView === 'workspace' && layout.showRunner" class="main-layout__right" :style="{ width: `${layout.right}px`, minWidth: `${layout.right}px` }">
      <SubmitPanel />
    </div>
    </div>
  </div>
</template>

<style scoped lang="scss">
.main-layout {
  display: flex;
  flex-direction: column;
  width: 100vw;
  height: 100vh;
  background: #1e1e1e;
  overflow: hidden;

  &__body { flex: 1; min-height: 0; display: flex; overflow: hidden; }

  &__center {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
    overflow: hidden;
  }

  &__desc {
    flex: 0 0 42%;
    border-bottom: 1px solid #3c3c3c;
    overflow: hidden;
  }

  &__editor {
    display: flex;
    flex: 1;
    min-height: 0;
    flex-direction: column;
    overflow: hidden;
  }

  &__editor-main { flex: 1; min-height: 0; overflow: hidden; }

  &__right {
    width: 300px;
    min-width: 300px;
    border-left: 1px solid #3c3c3c;
    overflow: hidden;
  }

  &__learning { flex: 1; min-width: 0; }
}
.resize-handle { flex: 0 0 5px; z-index: 20; background: transparent; transition: background .12s; &:hover { background: #569cd6; } &--x { cursor: col-resize; margin: 0 -2px; } &--y { width: 100%; height: 5px; flex-basis: 5px; cursor: row-resize; margin: -2px 0; } }
:global(body.is-resizing) { user-select: none; cursor: col-resize; }
</style>
