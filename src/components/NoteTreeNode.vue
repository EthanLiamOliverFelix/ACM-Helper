<script setup lang="ts">
import type { NoteEntry } from '../types'

defineOptions({ name: 'NoteTreeNode' })
defineProps<{ entry: NoteEntry; activePath?: string; movingPath?: string; targetPath?: string }>()
const emit = defineEmits<{
  open: [entry: NoteEntry]
  context: [entry: NoteEntry, event: MouseEvent]
  hold: [entry: NoteEntry, event: PointerEvent]
}>()
</script>

<template>
  <details v-if="entry.isDirectory" class="note-folder" open>
    <summary
      :data-note-path="entry.path"
      :class="{ moving: movingPath === entry.path, target: targetPath === entry.path }"
      @pointerdown="emit('hold', entry, $event)"
      @contextmenu.stop.prevent="emit('context', entry, $event)"
    ><span class="arrow">▾</span><span>📁</span><span class="name">{{ entry.name }}</span></summary>
    <div class="note-folder__children">
      <NoteTreeNode
        v-for="child in entry.children"
        :key="child.path"
        :entry="child"
        :active-path="activePath"
        :moving-path="movingPath"
        :target-path="targetPath"
        @open="emit('open', $event)"
        @context="(item, event) => emit('context', item, event)"
        @hold="(item, event) => emit('hold', item, event)"
      />
      <div v-if="!entry.children.length" class="empty">空文件夹</div>
    </div>
  </details>
  <button
    v-else
    class="note-file"
    :class="{ active: activePath?.toLowerCase() === entry.path.toLowerCase(), moving: movingPath === entry.path, target: targetPath === entry.path }"
    :data-note-path="entry.path"
    :title="entry.path"
    @pointerdown="emit('hold', entry, $event)"
    @click="emit('open', entry)"
    @contextmenu.stop.prevent="emit('context', entry, $event)"
  ><span class="icon">M↓</span><span class="name">{{ entry.name.replace(/\.md$/i, '') }}</span></button>
</template>

<style scoped lang="scss">
.note-folder { margin: 1px 0; summary { display: flex; align-items: center; gap: 5px; min-width: 0; padding: 5px 6px; border-radius: 3px; color: #bbb; font-size: 11px; cursor: pointer; list-style: none; &:hover, &.target { background: #2a2d2e; color: white; } &.target { outline: 1px solid #569cd6; } &.moving { opacity: .45; } } &:not([open]) > summary .arrow { transform: rotate(-90deg); } }
.arrow { width: 8px; color: #777; transition: transform .1s; }.name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.note-folder__children { margin-left: 9px; padding-left: 7px; border-left: 1px solid #333; }
.note-file { display: flex; align-items: center; gap: 6px; width: 100%; min-width: 0; padding: 5px 6px; border: 0; border-radius: 3px; background: transparent; color: #bbb; text-align: left; font-size: 11px; cursor: pointer; &:hover, &.target { background: #2a2d2e; color: white; } &.active { background: #37373d; color: white; outline: 1px solid #45627a; } &.target { outline: 1px solid #569cd6; } &.moving { opacity: .45; } }.icon { flex: 0 0 24px; color: #9cdcfe; font: 8px Consolas, monospace; }.empty { padding: 4px 9px; color: #555; font-size: 9px; font-style: italic; }
</style>
