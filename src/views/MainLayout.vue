<script setup lang="ts">
import { onBeforeUnmount, onMounted } from 'vue'
import TopBar from '../components/TopBar.vue'
import ActivityBar from '../workbench/ActivityBar.vue'
import PrimarySidebar from '../workbench/PrimarySidebar.vue'
import EditorLayoutNode from '../workbench/EditorLayoutNode.vue'
import CompileWorkbench from '../components/CompileWorkbench.vue'
import { useProblemStore } from '../stores/problemStore'
import { useLearningStore } from '../stores/learningStore'
import { useWorkbenchStore } from '../stores/workbenchStore'
import { usePointerResize } from '../composables/usePointerResize'
import { useAppZoom } from '../composables/useAppZoom'
import { isToggleSidebarShortcut } from '../workbenchShortcuts'

const problems = useProblemStore()
const learning = useLearningStore()
const workbench = useWorkbenchStore()
const { startPointerResize } = usePointerResize()
useAppZoom()

function startResize(event: PointerEvent) {
  const startX = event.clientX
  const startValue = workbench.sidebarWidth
  startPointerResize(event, { axis: 'x', onMove: current => workbench.setSidebarWidth(startValue + current.clientX - startX) })
}
function handleWorkbenchShortcut(event: KeyboardEvent) {
  if (!isToggleSidebarShortcut(event)) return
  if (event.target instanceof Element && event.target.closest('[data-sidebar-shortcut-ignore]')) return
  event.preventDefault()
  event.stopPropagation()
  workbench.toggleSidebar()
}

onMounted(() => {
  window.addEventListener('keydown', handleWorkbenchShortcut, true)
  // Let the shell paint and its resize handles become interactive before
  // restoring the last editor context and starting catalog/network initialization.
  // Session restoration must not depend on optional network/account warmups:
  // otherwise one rejected startup request leaves persisted tabs visible while
  // the shared problem/code store is still empty.
  requestAnimationFrame(() => requestAnimationFrame(() => {
    void workbench.restore().catch(error => console.error('恢复上次工作区失败', error))
    void Promise.allSettled([problems.initApp(), learning.init()])
  }))
})

onBeforeUnmount(() => window.removeEventListener('keydown', handleWorkbenchShortcut, true))
</script>

<template>
  <div class="main-layout">
    <TopBar />
    <div class="main-layout__body">
      <ActivityBar />
      <PrimarySidebar v-if="workbench.sidebarVisible" :style="{ width: `${workbench.sidebarWidth}px`, minWidth: `${workbench.sidebarWidth}px` }" />
      <div v-if="workbench.sidebarVisible" class="resize-handle resize-handle--x" @pointerdown="startResize($event)" />
      <div class="workbench-column">
        <main class="workbench-area">
          <EditorLayoutNode :node="workbench.layoutTree" />
        </main>
        <CompileWorkbench />
      </div>
    </div>
  </div>
</template>

<style scoped lang="scss">
.main-layout { width: 100vw; height: 100vh; display: flex; flex-direction: column; overflow: hidden; background: var(--color-bg-app); &__body { min-height: 0; flex: 1; display: flex; overflow: hidden; } }.workbench-column { min-width: 0; min-height: 0; flex: 1; display: flex; flex-direction: column; overflow: hidden; }.workbench-area { min-width: 0; min-height: 0; flex: 1; overflow: hidden; }.resize-handle { position: relative; z-index: 20; flex: 0 0 5px; margin: 0 -2px; background: transparent; cursor: col-resize; touch-action: none; &:hover { background: var(--color-accent); } }
</style>
