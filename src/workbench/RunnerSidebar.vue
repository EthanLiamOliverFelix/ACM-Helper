<script setup lang="ts">
import { defineAsyncComponent } from 'vue'
import { useWorkbenchStore, type RunnerTool } from '../stores/workbenchStore'
import TestExplorerPanel from './TestExplorerPanel.vue'

const workbench = useWorkbenchStore()
const SubmitPanel = defineAsyncComponent(() => import('../components/SubmitPanel.vue'))
const DebugPanel = defineAsyncComponent(() => import('../components/DebugPanel.vue'))
const tools: Array<{ id: RunnerTool; label: string }> = [
  { id: 'tests', label: '评测点' },
  { id: 'submission', label: '提交' },
  { id: 'debugger', label: '调试' },
]
</script>

<template>
  <section class="runner-sidebar">
    <nav aria-label="运行工具">
      <button v-for="tool in tools" :key="tool.id" :class="{ active: workbench.runnerTool === tool.id }" @click="workbench.runnerTool = tool.id">{{ tool.label }}</button>
    </nav>
    <div class="runner-sidebar__content">
      <TestExplorerPanel v-if="workbench.runnerTool === 'tests'" />
      <SubmitPanel v-else-if="workbench.runnerTool === 'submission'" submission-only />
      <DebugPanel v-else />
    </div>
  </section>
</template>

<style scoped lang="scss">
.runner-sidebar { height: 100%; min-height: 0; display: flex; flex-direction: column; > nav { height: 40px; flex: 0 0 40px; display: grid; grid-template-columns: repeat(3, 1fr); border-bottom: 1px solid var(--color-border); background: var(--color-bg-deep); button { position: relative; min-width: 0; border: 0; border-right: 1px solid var(--color-border-soft); background: transparent; color: var(--color-text-faint); font-size: 13px; font-weight: 500; cursor: pointer; &:last-child { border-right: 0; } &:hover { color: var(--color-text-strong); background: var(--color-bg-hover); } &.active { color: var(--color-text-strong); background: var(--color-bg-app); &::after { content: ''; position: absolute; inset: auto 8px 0; height: 2px; border-radius: 2px 2px 0 0; background: var(--color-accent); } } } } &__content { min-height: 0; flex: 1; overflow: hidden; } }
</style>
