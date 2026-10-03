<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useProblemStore } from '../stores/problemStore'
import { useWorkbenchStore } from '../stores/workbenchStore'

const store = useProblemStore()
const workbench = useWorkbenchStore()
const root = ref<HTMLElement>()
const open = ref(false)
const label = computed(() => workbench.terminalRunMode === 'run' ? '运行' : '编译后运行')
function dismiss(event: PointerEvent) {
  if (event.target instanceof Node && !root.value?.contains(event.target)) open.value = false
}
function run() {
  open.value = false
  workbench.openTerminal(workbench.terminalRunMode === 'run' ? 'run-existing' : 'run')
}
onMounted(() => document.addEventListener('pointerdown', dismiss))
onBeforeUnmount(() => document.removeEventListener('pointerdown', dismiss))
</script>

<template>
  <div ref="root" class="editor-run" @keydown.esc="open = false">
    <button :title="`${label}（终端）`" :aria-label="label" :disabled="workbench.terminalRunning || !store.currentCode.trim()" @click="run"><i class="codicon codicon-play" aria-hidden="true" /></button>
    <button class="editor-run__arrow" title="选择运行方式" aria-label="选择运行方式" :aria-expanded="open" aria-haspopup="menu" @click="open = !open"><i class="codicon codicon-chevron-down" aria-hidden="true" /></button>
    <div v-if="open" class="editor-run__menu" role="menu">
      <button v-for="mode in (['run', 'compile-run'] as const)" :key="mode" role="menuitemradio" :aria-checked="workbench.terminalRunMode === mode" @click="workbench.terminalRunMode = mode; open = false">{{ mode === 'run' ? '运行' : '编译后运行' }}<span v-if="workbench.terminalRunMode === mode">✓</span></button>
    </div>
  </div>
</template>

<style scoped>
.editor-run { position: relative; display: flex; align-items: center; }
.editor-run > button { display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; border: 0; border-radius: 3px; padding: 0; background: transparent; color: var(--color-text-secondary); cursor: pointer; }
.editor-run > button:hover:not(:disabled) { background: var(--color-bg-hover); color: var(--color-text-primary); }
.editor-run > button:disabled { opacity: .4; cursor: not-allowed; }
.editor-run .codicon { font-size: 18px; }
.editor-run > .editor-run__arrow { width: 20px; }
.editor-run__menu { position: absolute; top: calc(100% + 6px); right: 0; z-index: 60; width: 155px; padding: 4px; border: 1px solid var(--color-border-control); border-radius: 4px; background: var(--color-bg-panel); box-shadow: 0 4px 14px var(--color-overlay); }
.editor-run__menu button { display: flex; align-items: center; justify-content: space-between; width: 100%; border: 0; padding: 7px 9px; background: transparent; color: var(--color-text-primary); cursor: pointer; text-align: left; }
.editor-run__menu button:hover { background: var(--color-bg-hover); }
</style>
