<script setup lang="ts">
import { ref } from 'vue'
import { useNoteStore } from '../stores/noteStore'
import MarkdownNoteEditor from '../components/MarkdownNoteEditor.vue'
const notes = useNoteStore()
const mode = ref<'read' | 'edit'>('edit')
</script>
<template>
  <section class="problem-note-tab">
    <header v-if="notes.activeNote"><div><strong>{{ notes.activeNote.name.replace(/\.md$/i, '') }}</strong><small :title="notes.activeNote.path">{{ notes.activeNote.path }}</small></div><nav><button :class="{ active: mode === 'read' }" @click="notes.saveActive(); mode = 'read'">只读</button><button :class="{ active: mode === 'edit' }" @click="mode = 'edit'">编辑</button><button :disabled="!notes.dirty || notes.saving" @click="notes.saveActive">{{ notes.saving ? '保存中…' : notes.dirty ? '保存' : '已保存' }}</button></nav></header>
    <MarkdownNoteEditor v-if="notes.activeNote" :model-value="notes.activeNote.content" :mode="mode" :note-path="notes.activeNote.path" @update:model-value="notes.updateContent" @save="notes.saveActive" />
    <div v-else class="empty">正在打开题目笔记…</div>
  </section>
</template>
<style scoped lang="scss">
.problem-note-tab { height: 100%; min-height: 0; display: flex; flex-direction: column; header { display: flex; align-items: center; gap: 10px; padding: 9px 11px; border-bottom: 1px solid var(--color-border); background: var(--color-bg-panel); > div { min-width: 0; flex: 1; display: flex; flex-direction: column; } strong { font-size: 14px; } small { overflow: hidden; color: var(--color-text-faint); font-size: 11px; text-overflow: ellipsis; white-space: nowrap; } nav { display: flex; gap: 4px; } button { padding: 5px 8px; border: 1px solid var(--color-border-control); border-radius: 3px; background: var(--color-bg-control-alt); color: var(--color-text-soft); font-size: 12px; cursor: pointer; &.active { border-color: var(--color-accent); color: var(--color-accent-text); } &:disabled { opacity: .5; } } } }.empty { display: grid; flex: 1; place-content: center; color: var(--color-text-faint); }
</style>
