<script setup lang="ts">
import { useWorkbenchStore, type ActivityId } from '../stores/workbenchStore'
import '@vscode/codicons/dist/codicon.css'

const workbench = useWorkbenchStore()
const items: Array<{ id: ActivityId; icon: string; label: string }> = [
  { id: 'problems', icon: 'codicon-library', label: '题库与题单' },
  { id: 'files', icon: 'codicon-files', label: '资源管理器' },
  { id: 'learning', icon: 'codicon-type-hierarchy', label: '技能树与 VP' },
  { id: 'ai', icon: 'codicon-sparkle', label: 'AI 辅助' },
  { id: 'runner', icon: 'codicon-run-all', label: '评测、提交与调试' },
  { id: 'notes', icon: 'codicon-notebook', label: '算法笔记' },
]
</script>

<template>
  <nav class="activity-bar" aria-label="工作台活动栏">
    <button v-for="item in items" :key="item.id" :class="{ active: workbench.activity === item.id && workbench.sidebarVisible, action: ['learning', 'ai', 'notes'].includes(item.id) }" :title="item.label" :aria-label="item.label" :aria-current="workbench.activity === item.id && workbench.sidebarVisible ? 'page' : undefined" @click="workbench.setActivity(item.id)"><i class="codicon" :class="item.icon" /></button>
    <div class="activity-bar__spacer" />
    <button title="显示或隐藏侧边栏" aria-label="显示或隐藏侧边栏" @click="workbench.toggleSidebar"><i class="codicon codicon-layout-sidebar-left" /></button>
  </nav>
</template>

<style scoped lang="scss">
.activity-bar { width: 48px; flex: 0 0 48px; display: flex; flex-direction: column; align-items: stretch; border-right: 1px solid var(--color-border); background: var(--color-bg-deep); button { position: relative; height: 48px; display: grid; place-items: center; border: 0; background: transparent; color: var(--color-text-faint); cursor: pointer; transition: color .12s ease, background-color .12s ease; &:hover { color: var(--color-text-strong); background: var(--color-bg-hover); } &:focus-visible { outline: 1px solid var(--color-accent); outline-offset: -3px; } &.active { color: var(--color-accent-text); background: color-mix(in srgb, var(--color-accent) 8%, transparent); &::before { content: ''; position: absolute; inset: 7px auto 7px 0; width: 2px; border-radius: 0 2px 2px 0; background: var(--color-accent); } } &.action:active { transform: translateY(1px); } .codicon { font-size: 24px; } } &__spacer { flex: 1; } }
</style>
