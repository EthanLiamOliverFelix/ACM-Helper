<script setup lang="ts">
import { computed } from 'vue'
import type { WorkspaceEntry } from '../types'

defineOptions({ name: 'ResourceTreeNode' })
const props = defineProps<{ entry: WorkspaceEntry; activePath?: string; movingPath?: string; targetPath?: string; expandedPaths?: Set<string>; selectedPaths?: Set<string>; selectionMode?: boolean; movingPaths?: Set<string> }>()
const expanded = computed(() => props.expandedPaths?.has(props.entry.path) ?? true)
const languageMark = computed(() => {
  const extension = props.entry.name.split('.').pop()?.toLowerCase() ?? ''
  const marks: Record<string, string> = { cpp: 'C++', cc: 'C++', cxx: 'C++', hpp: 'C++', c: 'C', h: 'C', python: 'Py', py: 'Py', java: 'Java', js: 'JS', jsx: 'JS', ts: 'TS', tsx: 'TS', vue: 'Vue', rs: 'Rs' }
  return marks[props.entry.language ?? ''] ?? marks[extension] ?? ''
})
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
    <summary @click="emit('open', entry, $event)" :data-workspace-path="entry.path" :class="{ selected: selectedPaths?.has(entry.path), moving: movingPaths?.has(entry.path) || movingPath === entry.path, target: targetPath === entry.path }" draggable="true" @dragstart.stop="emit('drag', entry, $event)" @pointerdown="emit('hold', entry, $event)"><input v-if="selectionMode" class="selection-checkbox" type="checkbox" :checked="selectedPaths?.has(entry.path)" :aria-label="`选择 ${entry.name}`" @pointerdown.stop @dragstart.stop.prevent @click.stop="emit('select', entry, $event)" /><span class="tree-icon codicon codicon-chevron-down" @pointerdown.stop @click.stop.prevent="emit('toggle', entry.path, !expanded)" aria-hidden="true" /><span class="tree-name">{{ entry.name }}</span></summary>
    <div class="tree-folder__children">
      <ResourceTreeNode v-for="child in entry.children" :key="child.path" :entry="child" :active-path="activePath" :moving-path="movingPath" :moving-paths="movingPaths" :selected-paths="selectedPaths" :selection-mode="selectionMode" :target-path="targetPath" :expanded-paths="expandedPaths" @open="(item, event) => emit('open', item, event)" @select="(item, event) => emit('select', item, event)" @context="(item, event) => emit('context', item, event)" @hold="(item, event) => emit('hold', item, event)" @drag="(item, event) => emit('drag', item, event)" @toggle="(path, open) => emit('toggle', path, open)" />
      <div v-if="!entry.children.length" class="tree-empty">空文件夹</div>
    </div>
  </details>
  <div v-else role="button" tabindex="0" @keydown.enter.self.prevent="($event.currentTarget as HTMLElement).click()" @keydown.space.self.prevent="($event.currentTarget as HTMLElement).click()" class="tree-file" :class="{ active: activePath?.toLowerCase() === entry.path.toLowerCase(), selected: selectedPaths?.has(entry.path), moving: movingPaths?.has(entry.path) || movingPath === entry.path, target: targetPath === entry.path }" :data-workspace-path="entry.path" :title="entry.path" draggable="true" @dragstart.stop="emit('drag', entry, $event)" @pointerdown="emit('hold', entry, $event)" @click="emit('open', entry, $event)" @contextmenu.stop.prevent="emit('context', entry, $event)">
    <input v-if="selectionMode" class="selection-checkbox" type="checkbox" :checked="selectedPaths?.has(entry.path)" :aria-label="`选择 ${entry.name}`" @pointerdown.stop @dragstart.stop.prevent @click.stop="emit('select', entry, $event)" />
    <span v-if="languageMark" class="tree-language tree-language--mark" :data-mark="languageMark" aria-hidden="true">{{ languageMark }}</span>
    <span v-else class="tree-language codicon codicon-file" aria-hidden="true" />
    <span class="tree-name">{{ entry.name }}</span>
  </div>
</template>

<style scoped lang="scss">
.tree-folder { margin: 0; }
.tree-folder > summary, .tree-file {
  box-sizing: border-box;
  display: flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
  width: 100%;
  height: 24px;
  padding: 0 8px;
  border: 0;
  border-radius: 0;
  background: transparent;
  color: var(--color-text-secondary);
  font: 13px/24px var(--font-ui);
  text-align: left;
  cursor: pointer;
  &:hover { background: var(--color-bg-hover); }
  &.selected, &.active { background: var(--color-bg-selected); color: var(--color-text-on-subtle-selection); }
  &.target { background: var(--color-accent-surface-hover); box-shadow: inset 0 0 0 1px var(--color-accent); }
  &.moving { opacity: .45; }
  &:focus-visible { outline: 1px solid var(--color-accent); outline-offset: -1px; }
}
.tree-folder > summary { list-style: none; }
.tree-folder > summary::-webkit-details-marker { display: none; }
.tree-icon { flex: 0 0 16px; width: 16px; font-size: 16px; color: var(--color-text-soft); }
.tree-folder:not([open]) > summary .tree-icon { transform: rotate(-90deg); }
.tree-folder__children { margin-left: 15px; border-left: 1px solid var(--color-bg-subtle); }
.tree-language { flex: 0 0 16px; width: 16px; font-size: 16px; color: var(--color-text-muted); }
.tree-language--mark { flex-basis: 28px; width: 28px; text-align: center; font: 600 10px/16px var(--font-ui); color: var(--color-accent-text); }
.tree-language--mark[data-mark='Py'], .tree-language--mark[data-mark='JS'] { color: var(--color-warning); }
.tree-language--mark[data-mark='Java'] { color: var(--color-danger); }
.tree-language--mark[data-mark='Vue'] { color: var(--color-success); }
.tree-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tree-empty { padding: 1px 8px 1px 29px; color: var(--color-text-disabled); font-size: 11px; line-height: 24px; }
.selection-checkbox { flex: 0 0 14px; width: 14px; height: 14px; margin: 0 1px 0 0; accent-color: var(--color-accent); cursor: pointer; }
</style>
