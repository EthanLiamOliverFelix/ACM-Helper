<script setup lang="ts">
import { computed } from 'vue'
import type { WorkspaceEntry } from '../types'

defineOptions({ name: 'ResourceTreeNode' })
const props = defineProps<{ entry: WorkspaceEntry; activePath?: string; movingPath?: string; targetPath?: string; expandedPaths?: Set<string>; selectedPaths?: Set<string>; selectionMode?: boolean; movingPaths?: Set<string> }>()
const expanded = computed(() => props.expandedPaths?.has(props.entry.path) ?? true)
const emit = defineEmits<{
  open: [entry: WorkspaceEntry, event: MouseEvent]
  select: [entry: WorkspaceEntry, event: MouseEvent]
  context: [entry: WorkspaceEntry, event: MouseEvent]
  hold: [entry: WorkspaceEntry, event: PointerEvent]
  drag: [entry: WorkspaceEntry, event: DragEvent]
  toggle: [path: string, expanded: boolean]
}>()

function reportToggle(event: Event) {
  emit('toggle', props.entry.path, (event.currentTarget as HTMLDetailsElement).open)
}
</script>

<template>
  <details v-if="entry.isDirectory" class="tree-folder" :open="expanded" @toggle="reportToggle" @contextmenu.stop.prevent="emit('context', entry, $event)">
    <summary @click="emit('open', entry, $event)" :data-workspace-path="entry.path" :class="{ selected: selectedPaths?.has(entry.path), moving: movingPaths?.has(entry.path) || movingPath === entry.path, target: targetPath === entry.path }" draggable="true" @dragstart.stop="emit('drag', entry, $event)" @pointerdown="emit('hold', entry, $event)"><input v-if="selectionMode" class="selection-checkbox" type="checkbox" :checked="selectedPaths?.has(entry.path)" :aria-label="`选择 ${entry.name}`" @pointerdown.stop @dragstart.stop.prevent @click.stop="emit('select', entry, $event)" /><span class="tree-icon" @pointerdown.stop @click.stop.prevent="emit('toggle', entry.path, !expanded)">▾</span><span>📁</span><span class="tree-name">{{ entry.name }}</span></summary>
    <div class="tree-folder__children">
      <ResourceTreeNode v-for="child in entry.children" :key="child.path" :entry="child" :active-path="activePath" :moving-path="movingPath" :moving-paths="movingPaths" :selected-paths="selectedPaths" :selection-mode="selectionMode" :target-path="targetPath" :expanded-paths="expandedPaths" @open="(item, event) => emit('open', item, event)" @select="(item, event) => emit('select', item, event)" @context="(item, event) => emit('context', item, event)" @hold="(item, event) => emit('hold', item, event)" @drag="(item, event) => emit('drag', item, event)" @toggle="(path, open) => emit('toggle', path, open)" />
      <div v-if="!entry.children.length" class="tree-empty">空文件夹</div>
    </div>
  </details>
  <div v-else role="button" tabindex="0" @keydown.enter.self.prevent="($event.currentTarget as HTMLElement).click()" @keydown.space.self.prevent="($event.currentTarget as HTMLElement).click()" class="tree-file" :class="{ active: activePath?.toLowerCase() === entry.path.toLowerCase(), selected: selectedPaths?.has(entry.path), moving: movingPaths?.has(entry.path) || movingPath === entry.path, target: targetPath === entry.path }" :data-workspace-path="entry.path" :title="entry.path" draggable="true" @dragstart.stop="emit('drag', entry, $event)" @pointerdown="emit('hold', entry, $event)" @click="emit('open', entry, $event)" @contextmenu.stop.prevent="emit('context', entry, $event)">
    <input v-if="selectionMode" class="selection-checkbox" type="checkbox" :checked="selectedPaths?.has(entry.path)" :aria-label="`选择 ${entry.name}`" @pointerdown.stop @dragstart.stop.prevent @click.stop="emit('select', entry, $event)" />
    <span class="tree-language">{{ entry.language === 'cpp' ? 'C++' : entry.language === 'python' ? 'Py' : 'J' }}</span>
    <span class="tree-name">{{ entry.name }}</span>
  </div>
</template>

<style scoped lang="scss">
.tree-folder { margin: 2px 0; summary { display: flex; align-items: center; gap: 7px; min-width: 0; min-height: 30px; padding: 5px 7px; border-radius: 4px; color: var(--color-text-secondary); font-family: var(--font-ui); font-size: 13px; cursor: pointer; list-style: none; &:hover, &.target { background: var(--color-bg-hover); color: var(--color-text-on-subtle-selection); } &.target { outline: 1px solid var(--color-accent); background: var(--color-accent-surface-hover); } &.moving { opacity: .45; } } &[open] > summary .tree-icon { transform: rotate(0); } &:not([open]) > summary .tree-icon { transform: rotate(-90deg); } }
.tree-icon { width: 10px; color: var(--color-text-faint); transition: transform .1s; }
.tree-folder__children { margin-left: 12px; padding-left: 9px; border-left: 1px solid var(--color-bg-subtle); }
.tree-file { display: flex; align-items: center; gap: 7px; width: 100%; min-width: 0; min-height: 30px; padding: 6px 8px; border: 0; border-radius: 4px; background: transparent; color: var(--color-text-secondary); text-align: left; font-family: var(--font-ui); font-size: 13px; cursor: pointer; &:hover, &.target { background: var(--color-bg-hover); color: var(--color-text-on-subtle-selection); } &.active { background: var(--color-bg-selected); color: var(--color-text-on-subtle-selection); outline: 1px solid var(--color-tone-45627a); } &.target { outline: 1px solid var(--color-accent); background: var(--color-accent-surface-hover); } &.moving { opacity: .45; } }
.tree-language { flex: 0 0 29px; color: var(--color-accent-text); font-size: 10px; font-weight: 700; }
.tree-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tree-empty { padding: 6px 11px; color: var(--color-border-strong); font-size: 11px; font-style: italic; }
</style>

<style scoped>
.selected { background: var(--color-accent-surface) !important; outline: 1px solid var(--color-accent-border); }
.selection-checkbox { flex: 0 0 14px; width: 14px; height: 14px; margin: 0 2px 0 0; accent-color: var(--color-accent); cursor: pointer; }
</style>
