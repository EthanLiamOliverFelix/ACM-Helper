<script setup lang="ts">
import { computed, watch, onBeforeUnmount } from 'vue'
import { VueMonacoEditor } from '@guolao/vue-monaco-editor'
import { configureMonaco, monaco } from '../monaco'
import { useSettingsStore } from '../stores/settingsStore'
import { useTextFileStore } from '../stores/textFileStore'

const props = defineProps<{ path: string }>()
const files = useTextFileStore()
const settings = useSettingsStore()
const doc = computed(() => files.document(props.path))
configureMonaco()
watch(() => props.path, path => { void files.load(path) }, { immediate: true })
let saveAction: { dispose: () => void } | undefined
function mount(editor: any) {
  saveAction?.dispose()
  saveAction = editor.addAction({
    id: 'acm.save-text', label: '保存文件', precondition: 'editorTextFocus',
    keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS],
    run: () => files.save(props.path),
  })
}
onBeforeUnmount(() => saveAction?.dispose())
const options = { automaticLayout: true, fontSize: 14, fontFamily: "Consolas, 'Courier New', monospace", minimap: { enabled: false }, scrollBeyondLastLine: false, contextmenu: false }
</script>

<template>
  <section class="plain-text-editor" @keydown.ctrl.s.stop.prevent="files.save(path)" @keydown.meta.s.stop.prevent="files.save(path)">
    <div class="plain-text-editor__toolbar"><button :disabled="!doc.loaded || doc.saving || !files.isDirty(path)" :aria-busy="doc.saving" title="保存 (Ctrl+S)" aria-label="保存文本文件" @click="files.save(path)"><i class="codicon codicon-save" aria-hidden="true" /></button></div>
    <div v-if="doc.error" class="plain-text-editor__error" role="alert">{{ doc.error }}<button v-if="!doc.loaded" @click="files.load(path)">重试</button></div>
    <div v-if="doc.loading" class="plain-text-editor__loading">正在读取文件…</div>
    <div v-else-if="doc.loaded" class="plain-text-editor__body"><VueMonacoEditor :key="path" language="plaintext" :value="doc.text" :theme="settings.resolvedTheme === 'light' ? 'vs' : 'vs-dark'" :options="options" @mount="mount" @change="(value: string) => doc.text = value" /></div>
    <footer :title="path">{{ path }} · UTF-8</footer>
  </section>
</template>

<style scoped>
.plain-text-editor { height:100%; display:flex; flex-direction:column; min-height:0; }
.plain-text-editor__toolbar { display:flex; align-items:center; justify-content:flex-end; gap:10px; padding:4px 12px; color:var(--color-text-muted); font-size:11px; }
.plain-text-editor__toolbar button { display:grid; place-items:center; width:28px; height:28px; border:0; background:transparent; color:var(--color-text-secondary); cursor:pointer; }
.plain-text-editor__toolbar button:disabled { opacity:.4; cursor:default; }
.plain-text-editor__toolbar button:hover:not(:disabled) { background:var(--color-bg-hover); }
.plain-text-editor__body { flex:1; min-height:0; overflow:hidden; }
.plain-text-editor__error { padding:8px 12px; color:var(--color-danger); font-size:12px; overflow-wrap:anywhere; }
.plain-text-editor__loading { flex:1; padding:20px; color:var(--color-text-muted); }
footer { margin-top:auto; padding:5px 12px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:var(--color-text-muted); font-size:11px; }
</style>
