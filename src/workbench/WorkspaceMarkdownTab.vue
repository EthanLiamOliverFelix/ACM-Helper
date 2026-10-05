<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import MarkdownNoteEditor from '../components/MarkdownNoteEditor.vue'
import { useTextFileStore } from '../stores/textFileStore'
const props = defineProps<{ path: string }>()
const files = useTextFileStore()
const mode = ref<'read' | 'edit'>('read')
const doc = computed(() => files.document(props.path))
watch(() => props.path, path => { void files.load(path) }, { immediate: true })
</script>
<template>
  <section class="workspace-markdown">
    <header><strong :title="path">{{ path.split(/[\\/]/).pop()?.replace(/\.md$/i, '') }}</strong><nav><button :class="{ active: mode === 'read' }" @click="mode = 'read'">只读</button><button :class="{ active: mode === 'edit' }" @click="mode = 'edit'">编辑</button><button :disabled="!doc.loaded || doc.saving || !files.isDirty(path)" title="保存 (Ctrl+S)" aria-label="保存 Markdown" @click="files.save(path)"><i class="codicon codicon-save" /></button></nav></header>
    <p v-if="doc.error" role="alert">{{ doc.error }}<button v-if="!doc.loaded" @click="files.load(path)">重试</button></p>
    <div v-if="doc.loading" class="loading">正在读取文件…</div>
    <MarkdownNoteEditor v-else-if="doc.loaded" :model-value="doc.text" :mode="mode" :note-path="path" @update:model-value="value => doc.text = value" @save="files.save(path)" />
  </section>
</template>
<style scoped>
.workspace-markdown { height:100%; display:flex; flex-direction:column; min-height:0; }
header { display:flex; align-items:center; gap:12px; padding:8px 12px; border-bottom:1px solid var(--color-border); }
strong { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:14px; }
nav { display:flex; gap:4px; }
button { padding:5px 8px; border:1px solid var(--color-border-control); border-radius:3px; background:var(--color-bg-control-alt); color:var(--color-text-soft); cursor:pointer; }
button.active { border-color:var(--color-accent); color:var(--color-accent-text); }
button:disabled { opacity:.5; cursor:default; }
p { padding:8px 12px; color:var(--color-danger); overflow-wrap:anywhere; }
.loading { padding:20px; color:var(--color-text-muted); }
</style>
