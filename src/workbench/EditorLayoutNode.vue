<script setup lang="ts">
import { ref } from 'vue'
import type { WorkbenchLayoutNode } from '../stores/workbenchStore'
import { usePointerResize } from '../composables/usePointerResize'
import EditorGroup from './EditorGroup.vue'

defineOptions({ name: 'EditorLayoutNode' })
const props = defineProps<{ node: WorkbenchLayoutNode }>()
const splitElement = ref<HTMLElement | null>(null)
const { startPointerResize } = usePointerResize()

function startResize(event: PointerEvent) {
  if (props.node.type !== 'split' || !splitElement.value) return
  const bounds = splitElement.value.getBoundingClientRect()
  const horizontal = props.node.direction === 'horizontal'
  const total = horizontal ? bounds.width : bounds.height
  const startPosition = horizontal ? event.clientX : event.clientY
  const startRatio = props.node.ratio
  const minimumPercent = Math.min(35, Math.max(10, 140 / Math.max(total, 1) * 100))
  startPointerResize(event, {
    axis: horizontal ? 'x' : 'y',
    onMove: current => {
      if (props.node.type !== 'split') return
      const position = horizontal ? current.clientX : current.clientY
      const next = startRatio + (position - startPosition) / Math.max(total, 1) * 100
      props.node.ratio = Math.min(100 - minimumPercent, Math.max(minimumPercent, next))
    },
  })
}
</script>

<template>
  <EditorGroup v-if="node.type === 'group'" :group-id="node.groupId" />
  <section v-else ref="splitElement" class="layout-split" :class="`layout-split--${node.direction}`">
    <div class="layout-split__pane" :style="{ flexBasis: `${node.ratio}%` }"><EditorLayoutNode :node="node.first" /></div>
    <div class="layout-split__separator" :title="node.direction === 'horizontal' ? '拖动调整左右编辑区宽度' : '拖动调整上下编辑区高度'" @pointerdown="startResize" />
    <div class="layout-split__pane" :style="{ flexBasis: `${100 - node.ratio}%` }"><EditorLayoutNode :node="node.second" /></div>
  </section>
</template>

<style scoped lang="scss">
.layout-split { width: 100%; height: 100%; min-width: 0; min-height: 0; display: flex; overflow: hidden; &--horizontal { flex-direction: row; > .layout-split__separator { width: 5px; height: 100%; margin: 0 -2px; cursor: col-resize; } } &--vertical { flex-direction: column; > .layout-split__separator { width: 100%; height: 5px; margin: -2px 0; cursor: row-resize; } } &__pane { min-width: 0; min-height: 0; flex-grow: 1; flex-shrink: 1; overflow: hidden; } &__separator { position: relative; z-index: 12; flex: 0 0 5px; background: transparent; touch-action: none; transition: background .1s; &:hover { background: var(--color-accent); } } }
</style>
