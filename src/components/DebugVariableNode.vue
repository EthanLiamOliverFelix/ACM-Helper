<script setup lang="ts">
import { computed } from 'vue'
import { parseDebugValue } from '../utils/debugValue'

const props = withDefaults(defineProps<{
  name: string
  value?: string
  error?: string | null
  nodeKey: string
  expanded: Set<string>
  depth?: number
}>(), { depth: 0 })
const emit = defineEmits<{ toggle: [key: string] }>()
const view = computed(() => parseDebugValue(props.error ? '' : props.value))
const isOpen = computed(() => props.expanded.has(props.nodeKey))
</script>

<template>
  <div class="variable-tree">
    <div class="variable-row">
      <code :title="name"><button v-if="view.expandable && depth < 20" type="button" class="variable-row__toggle" :aria-label="`${isOpen ? '收起' : '展开'} ${name}`" :aria-expanded="isOpen" @click="emit('toggle', nodeKey)">{{ isOpen ? '⌄' : '›' }}</button>{{ name }}</code>
      <span :class="{ error }" :title="value">{{ error || view.summary }}</span>
      <slot />
    </div>
    <div v-if="isOpen && !error && depth < 20" class="variable-tree__children">
      <DebugVariableNode v-for="(child, index) in view.children" :key="index" :name="child.name" :value="child.value" :node-key="`${nodeKey}/${index}`" :expanded="expanded" :depth="depth + 1" @toggle="emit('toggle', $event)" />
    </div>
  </div>
</template>

<style scoped lang="scss">
.variable-row { display: grid; grid-template-columns: minmax(65px, .8fr) minmax(0, 1.3fr) auto; align-items: start; gap: 6px; padding: 7px 6px; border-bottom: 1px solid var(--color-bg-raised); background: var(--color-tone-222); font: 13px/1.45 Consolas, monospace;
  code { overflow-wrap: anywhere; color: var(--color-accent-text); font: inherit; }
  span { overflow-wrap: anywhere; white-space: pre-wrap; color: var(--color-code); font: inherit; &.error { color: var(--color-danger); } }
  :slotted(button) { border: 0; background: transparent; color: var(--color-text-faint); cursor: pointer; &:hover { color: var(--color-danger); } }
}
.variable-row__toggle { width: 18px; padding: 0; border: 0; background: transparent; color: var(--color-accent-text); font-size: 16px; text-align: left; cursor: pointer; }
.variable-tree__children { border-left: 1px solid var(--color-border-input); margin-left: 10px; }
</style>
