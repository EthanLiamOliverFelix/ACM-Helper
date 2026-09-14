<script setup lang="ts">
import { computed } from 'vue'
import type { WorkspaceEntry } from '../types'

defineOptions({ name: 'ResourceTreeNode' })
const props = defineProps<{ entry: WorkspaceEntry; activePath?: string; movingPath?: string; targetPath?: string; expandedPaths?: Set<string> }>()
const expanded = computed(() => props.expandedPaths?.has(props.entry.path) ?? true)
const emit = defineEmits<{
  open: [entry: WorkspaceEntry]
  context: [entry: WorkspaceEntry, event: MouseEvent]
  hold: [entry: WorkspaceEntry, event: PointerEvent]
  toggle: [path: string, expanded: boolean]
}>()

function reportToggle(event: Event) {
  emit('toggle', props.entry.path, (event.currentTarget as HTMLDetailsElement).open)
}
</script>

<template>
  <details v-if="entry.isDirectory" class="tree-folder" :open="expanded" @toggle="reportToggle" @contextmenu.stop.prevent="emit('context', entry, $event)">
    <summary :data-workspace-path="entry.path" :class="{ moving: movingPath === entry.path, target: targetPath === entry.path }" @pointerdown="emit('hold', entry, $event)"><span class="tree-icon">▾</span><span>📁</span><span class="tree-name">{{ entry.name }}</span></summary>
    <div class="tree-folder__children">
      <ResourceTreeNode v-for="child in entry.children" :key="child.path" :entry="child" :active-path="activePath" :moving-path="movingPath" :target-path="targetPath" :expanded-paths="expandedPaths" @open="emit('open', $event)" @context="(item, event) => emit('context', item, event)" @hold="(item, event) => emit('hold', item, event)" @toggle="(path, open) => emit('toggle', path, open)" />
      <div v-if="!entry.children.length" class="tree-empty">空文件夹</div>
    </div>
  </details>
  <button v-else class="tree-file" :class="{ active: activePath?.toLowerCase() === entry.path.toLowerCase(), moving: movingPath === entry.path, target: targetPath === entry.path }" :data-workspace-path="entry.path" :title="entry.path" @pointerdown="emit('hold', entry, $event)" @click="emit('open', entry)" @contextmenu.stop.prevent="emit('context', entry, $event)">
    <span class="tree-language">{{ entry.language === 'cpp' ? 'C++' : entry.language === 'python' ? 'Py' : 'J' }}</span>
    <span class="tree-name">{{ entry.name }}</span>
  </button>
</template>

<style scoped lang="scss">
.tree-folder { margin: 1px 0; summary { display: flex; align-items: center; gap: 5px; min-width: 0; padding: 4px 5px; border-radius: 3px; color: var(--color-text-secondary); font-size: 11px; cursor: pointer; list-style: none; &:hover, &.target { background: var(--color-bg-hover); color: var(--color-text-on-subtle-selection); } &.target { outline: 1px solid var(--color-accent); } &.moving { opacity: .45; } } &[open] > summary .tree-icon { transform: rotate(0); } &:not([open]) > summary .tree-icon { transform: rotate(-90deg); } }
.tree-icon { width: 8px; color: var(--color-text-faint); transition: transform .1s; }
.tree-folder__children { margin-left: 9px; padding-left: 7px; border-left: 1px solid var(--color-bg-subtle); }
.tree-file { display: flex; align-items: center; gap: 6px; width: 100%; min-width: 0; padding: 5px 6px; border: 0; border-radius: 3px; background: transparent; color: var(--color-text-secondary); text-align: left; font-size: 11px; cursor: pointer; &:hover, &.target { background: var(--color-bg-hover); color: var(--color-text-on-subtle-selection); } &.active { background: var(--color-bg-selected); color: var(--color-text-on-subtle-selection); outline: 1px solid var(--color-tone-45627a); } &.target { outline: 1px solid var(--color-accent); } &.moving { opacity: .45; } }
.tree-language { flex: 0 0 24px; color: var(--color-accent-text); font-size: 8px; font-weight: 700; }
.tree-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tree-empty { padding: 4px 9px; color: var(--color-border-strong); font-size: 9px; font-style: italic; }
</style>
