<script setup lang="ts">
import { computed } from 'vue'
import type { NoteEntry } from '../types'

defineOptions({ name: 'NoteTreeNode' })
const props = defineProps<{ entry: NoteEntry; activePath?: string; movingPath?: string; targetPath?: string; expandedPaths?: Set<string>; selectedPaths?: Set<string>; selectionMode?: boolean; movingPaths?: Set<string> }>()
const expanded = computed(() => props.expandedPaths?.has(props.entry.path) ?? true)
const emit = defineEmits<{
  open: [entry: NoteEntry, event: MouseEvent]
  select: [entry: NoteEntry, event: MouseEvent]
  context: [entry: NoteEntry, event: MouseEvent]
  hold: [entry: NoteEntry, event: PointerEvent]
  drag: [entry: NoteEntry, event: DragEvent]
  toggle: [path: string, expanded: boolean]
}>()
function reportToggle(event: Event) { emit('toggle', props.entry.path, (event.currentTarget as HTMLDetailsElement).open) }
</script>

<template>
  <details v-if="entry.isDirectory" class="note-folder" :open="expanded" @toggle="reportToggle">
    <summary @click="emit('open', entry, $event)"
      :data-note-path="entry.path"
      :class="{ selected: selectedPaths?.has(entry.path), moving: movingPaths?.has(entry.path) || movingPath === entry.path, target: targetPath === entry.path }"
      draggable="true" @dragstart.stop="emit('drag', entry, $event)" @pointerdown="emit('hold', entry, $event)"
      @contextmenu.stop.prevent="emit('context', entry, $event)"
    ><input v-if="selectionMode" class="selection-checkbox" type="checkbox" :checked="selectedPaths?.has(entry.path)" :aria-label="`选择 ${entry.name}`" @pointerdown.stop @dragstart.stop.prevent @click.stop="emit('select', entry, $event)" /><span class="arrow" @pointerdown.stop @click.stop.prevent="emit('toggle', entry.path, !expanded)">▾</span><span>📁</span><span class="name">{{ entry.name }}</span></summary>
    <div class="note-folder__children">
      <NoteTreeNode
        v-for="child in entry.children"
        :key="child.path"
        :entry="child"
        :active-path="activePath"
        :moving-path="movingPath" :moving-paths="movingPaths" :selected-paths="selectedPaths" :selection-mode="selectionMode"
        :target-path="targetPath" :expanded-paths="expandedPaths" @toggle="(path, open) => emit('toggle', path, open)"
        @open="(item, event) => emit('open', item, event)" @select="(item, event) => emit('select', item, event)"
        @context="(item, event) => emit('context', item, event)"
        @hold="(item, event) => emit('hold', item, event)" @drag="(item, event) => emit('drag', item, event)"
      />
      <div v-if="!entry.children.length" class="empty">空文件夹</div>
    </div>
  </details>
  <div role="button" tabindex="0" @keydown.enter.self.prevent="($event.currentTarget as HTMLElement).click()" @keydown.space.self.prevent="($event.currentTarget as HTMLElement).click()"
    v-else
    class="note-file"
    :class="{ active: activePath?.toLowerCase() === entry.path.toLowerCase(), selected: selectedPaths?.has(entry.path), moving: movingPaths?.has(entry.path) || movingPath === entry.path, target: targetPath === entry.path }"
    :data-note-path="entry.path"
    :title="entry.path"
    draggable="true" @dragstart.stop="emit('drag', entry, $event)" @pointerdown="emit('hold', entry, $event)"
    @click="emit('open', entry, $event)"
    @contextmenu.stop.prevent="emit('context', entry, $event)"
  ><input v-if="selectionMode" class="selection-checkbox" type="checkbox" :checked="selectedPaths?.has(entry.path)" :aria-label="`选择 ${entry.name}`" @pointerdown.stop @dragstart.stop.prevent @click.stop="emit('select', entry, $event)" /><span class="icon">M↓</span><span class="name">{{ entry.name.replace(/\.md$/i, '') }}</span></div>
</template>

<style scoped lang="scss">
.note-folder { margin: 1px 0; summary { display: flex; align-items: center; gap: 5px; min-width: 0; padding: 5px 6px; border-radius: 3px; color: var(--color-text-secondary); font-size: 11px; cursor: pointer; list-style: none; &:hover, &.target { background: var(--color-bg-hover); color: var(--color-text-on-subtle-selection); } &.target { outline: 1px solid var(--color-accent); background: var(--color-accent-surface-hover); } &.moving { opacity: .45; } } &:not([open]) > summary .arrow { transform: rotate(-90deg); } }
.arrow { width: 8px; color: var(--color-text-faint); transition: transform .1s; }.name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.note-folder__children { margin-left: 9px; padding-left: 7px; border-left: 1px solid var(--color-bg-subtle); }
.note-file { display: flex; align-items: center; gap: 6px; width: 100%; min-width: 0; padding: 5px 6px; border: 0; border-radius: 3px; background: transparent; color: var(--color-text-secondary); text-align: left; font-size: 11px; cursor: pointer; &:hover, &.target { background: var(--color-bg-hover); color: var(--color-text-on-subtle-selection); } &.active { background: var(--color-bg-selected); color: var(--color-text-on-subtle-selection); outline: 1px solid var(--color-tone-45627a); } &.target { outline: 1px solid var(--color-accent); background: var(--color-accent-surface-hover); } &.moving { opacity: .45; } }.icon { flex: 0 0 24px; color: var(--color-accent-text); font: 8px Consolas, monospace; }.empty { padding: 4px 9px; color: var(--color-border-strong); font-size: 9px; font-style: italic; }
</style>

<style scoped>
.selected { background: var(--color-accent-surface) !important; outline: 1px solid var(--color-accent-border); }
.selection-checkbox { flex: 0 0 14px; width: 14px; height: 14px; margin: 0 2px 0 0; accent-color: var(--color-accent); cursor: pointer; }
</style>
