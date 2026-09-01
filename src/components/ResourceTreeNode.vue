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
.tree-folder { margin: 1px 0; summary { display: flex; align-items: center; gap: 5px; min-width: 0; padding: 4px 5px; border-radius: 3px; color: #bbb; font-size: 11px; cursor: pointer; list-style: none; &:hover, &.target { background: #2a2d2e; color: white; } &.target { outline: 1px solid #569cd6; } &.moving { opacity: .45; } } &[open] > summary .tree-icon { transform: rotate(0); } &:not([open]) > summary .tree-icon { transform: rotate(-90deg); } }
.tree-icon { width: 8px; color: #777; transition: transform .1s; }
.tree-folder__children { margin-left: 9px; padding-left: 7px; border-left: 1px solid #333; }
.tree-file { display: flex; align-items: center; gap: 6px; width: 100%; min-width: 0; padding: 5px 6px; border: 0; border-radius: 3px; background: transparent; color: #bbb; text-align: left; font-size: 11px; cursor: pointer; &:hover, &.target { background: #2a2d2e; color: white; } &.active { background: #37373d; color: white; outline: 1px solid #45627a; } &.target { outline: 1px solid #569cd6; } &.moving { opacity: .45; } }
.tree-language { flex: 0 0 24px; color: #9cdcfe; font-size: 8px; font-weight: 700; }
.tree-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tree-empty { padding: 4px 9px; color: #555; font-size: 9px; font-style: italic; }
</style>
