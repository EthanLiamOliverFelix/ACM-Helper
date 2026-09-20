<script setup lang="ts">
import { defineAsyncComponent } from 'vue'
import { useWorkbenchStore } from '../stores/workbenchStore'
import ProblemList from '../components/ProblemList.vue'
import RunnerSidebar from './RunnerSidebar.vue'
import '@vscode/codicons/dist/codicon.css'
const ResourceExplorer = defineAsyncComponent(() => import('../components/ResourceExplorer.vue'))
const workbench = useWorkbenchStore()
const titles = { problems: '题库与题单', files: '资源管理器', learning: '技能树与 VP', ai: 'AI 辅助', runner: '运行工具', notes: '算法笔记' }
</script>
<template>
  <aside class="primary-sidebar">
    <header v-if="workbench.activity !== 'runner'"><strong>{{ titles[workbench.activity] }}</strong><button title="收起侧边栏" @click="workbench.toggleSidebar">×</button></header>
    <div class="primary-sidebar__content">
      <ProblemList v-if="workbench.activity === 'problems'" :show-files="false" />
      <ResourceExplorer v-else-if="workbench.activity === 'files'" />
      <RunnerSidebar v-else-if="workbench.activity === 'runner'" />
      <div v-else class="activity-summary">
        <i class="codicon" :class="workbench.activity === 'learning' ? 'codicon-type-hierarchy' : workbench.activity === 'ai' ? 'codicon-sparkle' : 'codicon-notebook'" />
        <strong>{{ titles[workbench.activity] }}</strong>
        <p>完整功能已在编辑器标签中打开，可与代码并排使用。</p>
        <button v-if="workbench.activity === 'learning'" @click="workbench.openLearning">打开技能树</button>
        <button v-else-if="workbench.activity === 'ai'" @click="workbench.openAi">打开 AI 辅助</button>
        <button v-else @click="workbench.openNotes">打开笔记本</button>
      </div>
    </div>
  </aside>
</template>
<style scoped lang="scss">
.primary-sidebar { height: 100%; min-width: 0; display: flex; flex-direction: column; border-right: 1px solid var(--color-border); background: var(--color-bg-app); overflow: hidden; > header { height: 40px; flex: 0 0 40px; display: flex; align-items: center; padding: 0 10px 0 13px; border-bottom: 1px solid var(--color-border); strong { flex: 1; color: var(--color-text-secondary); font-size: 13px; font-weight: 600; text-transform: uppercase; } button { border: 0; background: transparent; color: var(--color-text-faint); font-size: 19px; cursor: pointer; } } &__content { flex: 1; min-height: 0; overflow: hidden; } }.activity-summary { height: 100%; display: grid; place-content: center; justify-items: center; padding: 22px; text-align: center; color: var(--color-text-faint); > .codicon { font-size: 34px; color: var(--color-accent-text); } strong { margin-top: 8px; color: var(--color-text-strong); font-size: 15px; } p { max-width: 230px; font-size: 12px; line-height: 1.65; } button { padding: 8px 12px; border: 1px solid var(--color-accent-border); border-radius: 4px; background: var(--color-accent-surface); color: var(--color-accent-text); cursor: pointer; } }
</style>
