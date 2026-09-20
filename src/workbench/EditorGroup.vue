<script setup lang="ts">
import { computed, defineAsyncComponent, ref } from 'vue'
import { useWorkbenchStore } from '../stores/workbenchStore'
import { useProblemStore } from '../stores/problemStore'
import CodeEditor from '../components/CodeEditor.vue'
import ProblemDesc from '../components/ProblemDesc.vue'
import ProblemNoteTab from './ProblemNoteTab.vue'

const props = defineProps<{ groupId: string }>()
const workbench = useWorkbenchStore()
const problems = useProblemStore()
const dropZone = ref<'center' | 'left' | 'right' | 'top' | 'bottom' | null>(null)
const AiAssistant = defineAsyncComponent(() => import('../components/AiAssistant.vue'))
const LearningPanel = defineAsyncComponent(() => import('../components/LearningPanel.vue'))
const NoteManager = defineAsyncComponent(() => import('../components/NoteManager.vue'))
const group = computed(() => workbench.groups.find(item => item.id === props.groupId)!)
const tab = computed(() => group.value.tabs.find(item => item.id === group.value.activeTabId) ?? null)

function isDirty(item: typeof group.value.tabs[number]) {
  if (item.kind !== 'code' || !item.context || !problems.draftDirty || !problems.currentProblem) return false
  const sameProblem = item.context.platform === problems.currentProblem.platform && item.context.problemId === problems.currentProblem.id
  const samePath = !item.context.path || item.context.path.toLowerCase() === problems.draftPath.toLowerCase()
  return sameProblem && samePath && item.context.language === problems.currentLanguage
}
function startTabDrag(event: DragEvent, tabId: string) {
  event.dataTransfer?.setData('application/x-acm-workbench-tab', JSON.stringify({ groupId: props.groupId, tabId }))
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
}
function updateDropZone(event: DragEvent) {
  const bounds = (event.currentTarget as HTMLElement).getBoundingClientRect()
  const localY = event.clientY - bounds.top
  const x = (event.clientX - bounds.left) / bounds.width
  const y = localY / bounds.height
  const edge = .24
  dropZone.value = localY <= 45 ? 'center' : x < edge ? 'left' : x > 1 - edge ? 'right' : y < edge ? 'top' : y > 1 - edge ? 'bottom' : 'center'
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
}
function dropTab(event: DragEvent) {
  const raw = event.dataTransfer?.getData('application/x-acm-workbench-tab')
  const zone = dropZone.value
  dropZone.value = null
  if (!raw || !zone) return
  try {
    const source = JSON.parse(raw) as { groupId: string; tabId: string }
    workbench.moveTab(source.groupId, source.tabId, props.groupId, zone)
  } catch { /* Ignore drags from outside the workbench. */ }
}
function leaveDropZone(event: DragEvent) {
  const current = event.currentTarget as HTMLElement
  const next = event.relatedTarget as Node | null
  if (!next || !current.contains(next)) dropZone.value = null
}
</script>
<template>
  <section class="editor-group" :class="[{ active: workbench.activeGroupId === groupId }, dropZone ? `drop-${dropZone}` : '']" @pointerdown.capture="workbench.activeGroupId = groupId" @dragover.prevent="updateDropZone" @dragleave="leaveDropZone" @drop.prevent="dropTab">
    <div class="editor-tabs">
      <button v-for="item in group.tabs" :key="item.id" class="editor-tab" :class="{ active: item.id === group.activeTabId, dirty: isDirty(item) }" :title="item.title" draggable="true" @dragstart="startTabDrag($event, item.id)" @dragend="dropZone = null" @click="workbench.activateTab(groupId, item.id)">
        <span>{{ item.kind === 'code' ? '⌨' : item.kind === 'statement' ? '▤' : item.kind === 'problem-note' || item.kind === 'notes' ? '▧' : item.kind === 'ai' ? '✦' : '◇' }}</span><b>{{ item.title }}</b>
        <i :title="isDirty(item) ? '尚未保存' : '关闭'" @click.stop="workbench.closeTab(groupId, item.id)">{{ isDirty(item) ? '●' : '×' }}</i>
      </button>
      <div class="editor-tabs__spacer" />
      <button v-if="tab?.context" class="companion" title="在侧边打开题面" @click="workbench.openStatement">▤</button>
    </div>
    <div class="editor-group__content">
      <template v-if="tab?.kind === 'code'">
        <CodeEditor />
      </template>
      <ProblemDesc v-else-if="tab?.kind === 'statement'" />
      <ProblemNoteTab v-else-if="tab?.kind === 'problem-note'" />
      <AiAssistant v-else-if="tab?.kind === 'ai'" />
      <LearningPanel v-else-if="tab?.kind === 'learning'" />
      <NoteManager v-else-if="tab?.kind === 'notes'" />
      <div v-else class="empty-group"><strong>ACM Helper</strong><p>从左侧题库或资源管理器打开代码。</p><div><button @click="workbench.openLearning">技能树</button><button @click="workbench.openAi">AI 辅助</button><button @click="workbench.openNotes">算法笔记</button></div></div>
    </div>
    <div v-if="dropZone" class="drop-preview"><span>放置到{{ dropZone === 'center' ? '当前组' : dropZone === 'left' ? '左侧' : dropZone === 'right' ? '右侧' : dropZone === 'top' ? '上方' : '下方' }}</span></div>
  </section>
</template>
<style scoped lang="scss">
.editor-group { position: relative; width: 100%; height: 100%; min-width: 0; min-height: 0; display: flex; flex-direction: column; border: 1px solid transparent; background: var(--color-bg-app); overflow: hidden; &.active { border-color: var(--color-border-control); } &__content { min-width: 0; min-height: 0; flex: 1; overflow: hidden; } }.editor-tabs { height: 39px; flex: 0 0 39px; display: flex; align-items: stretch; overflow-x: auto; overflow-y: hidden; border-bottom: 1px solid var(--color-border); background: var(--color-bg-deep); scrollbar-width: thin; &__spacer { flex: 1; } }.editor-tab { min-width: 130px; max-width: 260px; display: flex; align-items: center; gap: 7px; padding: 0 9px; border: 0; border-right: 1px solid var(--color-border); background: var(--color-bg-panel-alt); color: var(--color-text-muted); cursor: grab; &.active { background: var(--color-bg-app); color: var(--color-text-strong); box-shadow: inset 0 2px var(--color-accent); } &:active { cursor: grabbing; } span { color: var(--color-accent-text); } b { min-width: 0; flex: 1; overflow: hidden; font-size: 13px; font-weight: 500; text-overflow: ellipsis; white-space: nowrap; } i { flex: 0 0 auto; display: grid; place-items: center; width: 18px; height: 18px; border-radius: 4px; color: var(--color-text-faint); font-size: 15px; font-style: normal; &:hover { color: var(--color-text-strong); background: var(--color-bg-hover); } } &.dirty i { color: var(--color-text-soft); font-size: 10px; } }.companion { width: 38px; flex: 0 0 38px; border: 0; background: transparent; color: var(--color-text-soft); cursor: pointer; }.code-stack { height: 100%; min-height: 0; display: flex; flex-direction: column; &__editor { min-height: 0; flex: 1; } }.empty-group { height: 100%; display: grid; place-content: center; justify-items: center; color: var(--color-text-faint); text-align: center; strong { color: var(--color-text-secondary); font-size: 22px; } p { font-size: 13px; } div { display: flex; gap: 6px; } button { padding: 7px 11px; border: 1px solid var(--color-border-control); border-radius: 4px; background: var(--color-bg-panel); color: var(--color-text-soft); cursor: pointer; } }.drop-preview { position: absolute; z-index: 100; inset: 6px; pointer-events: none; border: 2px solid var(--color-accent); border-radius: 5px; background: color-mix(in srgb, var(--color-accent) 22%, transparent); span { position: absolute; top: 50%; left: 50%; translate: -50% -50%; padding: 5px 9px; border-radius: 4px; background: var(--color-accent-strong); color: white; font-size: 12px; } }.drop-left .drop-preview { right: 50%; }.drop-right .drop-preview { left: 50%; }.drop-top .drop-preview { bottom: 50%; }.drop-bottom .drop-preview { top: 50%; }.drop-center .drop-preview { inset: 38px 6px 6px; }
</style>
