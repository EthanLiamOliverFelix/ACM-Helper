<script setup lang="ts">
import { computed, defineAsyncComponent, ref, watch } from 'vue'
import { useProblemStore } from '../stores/problemStore'
import { useWorkbenchStore } from '../stores/workbenchStore'
import { getRunDiagnostic } from '../utils/runDiagnostics'
import { usePointerResize } from '../composables/usePointerResize'

const store = useProblemStore()
const workbench = useWorkbenchStore()
const { startPointerResize } = usePointerResize()
const copied = ref(false)
const TerminalPanel = defineAsyncComponent(() => import('./TerminalPanel.vue'))
const terminalCreated = ref(false)
const activePanel = ref<'problems' | 'terminal'>('problems')
watch(() => workbench.terminalRequest.sequence, () => { terminalCreated.value = true; activePanel.value = 'terminal' })
const diagnostic = computed(() => getRunDiagnostic(store.runResult, store.currentLanguage))
const message = computed(() => diagnostic.value?.message ?? '')
watch(message, value => { if (value) activePanel.value = 'problems' })
const visible = computed(() => !!message.value || workbench.terminalVisible)
const diagnosticDuration = computed(() => store.runResult?.compileFailed
  ? store.runResult.compileDurationMs
  : store.runResult?.durationMs)

async function copyMessage() {
  if (!message.value) return
  await navigator.clipboard.writeText(message.value)
  copied.value = true
  window.setTimeout(() => { copied.value = false }, 1200)
}

function close() {
  if (diagnostic.value) store.runResult = null
  workbench.terminalVisible = false
}

function startResize(event: PointerEvent) {
  const startY = event.clientY
  const startHeight = workbench.bottomPanelHeight
  const available = (event.currentTarget as HTMLElement).closest('.compile-workbench')?.parentElement?.clientHeight ?? window.innerHeight
  startPointerResize(event, { axis: 'y', onMove: current => workbench.setBottomPanelHeight(Math.min(available - 140, startHeight - current.clientY + startY)) })
}
</script>

<template>
  <section v-show="visible" class="compile-workbench" :style="{ flexBasis: `${workbench.bottomPanelHeight}px` }">
    <div class="compile-workbench__divider" title="拖动调整底部面板高度" role="separator" aria-label="调整底部面板高度" aria-orientation="horizontal" @pointerdown="startResize" />
    <header>
      <div role="tablist" aria-label="底部面板">
        <button role="tab" :aria-selected="activePanel === 'problems'" @click="activePanel = 'problems'">{{ diagnostic?.title || '问题' }}</button>
        <button role="tab" :aria-selected="activePanel === 'terminal'" @click="workbench.openTerminal()">终端</button>
        <small v-if="activePanel === 'problems' && diagnosticDuration != null">{{ diagnosticDuration }} ms</small>
      </div>
      <div><div id="terminal-panel-actions" v-show="activePanel === 'terminal'" /><button v-if="activePanel === 'problems' && message" type="button" @click="copyMessage">{{ copied ? '已复制' : '复制全部' }}</button><button type="button" class="close" title="隐藏底部面板" @click="close">×</button></div>
    </header>
    <pre v-show="activePanel === 'problems'">{{ message || '暂无问题信息' }}</pre>
    <TerminalPanel v-if="terminalCreated" v-show="activePanel === 'terminal'" :visible="visible && activePanel === 'terminal'" />
  </section>
</template>

<style scoped lang="scss">
.compile-workbench {
  position: relative;
  display: flex;
  flex: 0 0 190px;
  min-height: 110px;
  flex-direction: column;
  overflow: hidden;
  border-top: 1px solid var(--color-tone-5a3535);
  background: var(--color-bg-deep);
  color: var(--color-text-primary);

  header { display: flex; flex: 0 0 auto; align-items: center; justify-content: space-between; min-height: 32px; padding: 0 9px 0 11px; border-bottom: 1px solid var(--color-tone-353535); background: var(--color-bg-panel-alt); font-size: 11px; > div { display: flex; align-items: center; gap: 7px; } strong { color: var(--color-tone-f0b1a6); } small { color: var(--color-text-muted); } button { padding: 3px 7px; border: 1px solid var(--color-tone-484848); border-radius: 3px; background: var(--color-tone-2d2d2d); color: var(--color-tone-ccc); font-size: 10px; cursor: pointer; } button.close { border: 0; background: transparent; color: var(--color-text-soft); font-size: 17px; } }
  header button[role='tab'] { border: 0; border-radius: 0; background: transparent; color: var(--color-text-muted); padding: 7px 6px; font-size: 12px; }
  header button[role='tab'][aria-selected='true'] { color: var(--color-text-primary); box-shadow: inset 0 -2px var(--color-accent); }
  pre { flex: 1; min-height: 0; overflow: auto; margin: 0; padding: 10px 12px 14px; color: var(--color-danger); font: 11px/1.55 Consolas, "Cascadia Mono", monospace; white-space: pre-wrap; word-break: break-word; user-select: text; }
  &__icon { display: inline-flex; width: 15px; height: 15px; align-items: center; justify-content: center; border-radius: 50%; background: var(--color-tone-a33b3b); color: var(--color-text-on-accent); font-size: 12px; font-weight: 700; }
  &__divider { position: absolute; z-index: 15; top: 0; right: 0; left: 0; height: 6px; background: transparent; cursor: row-resize; touch-action: none; &:hover { background: var(--color-accent); } }
}
</style>
