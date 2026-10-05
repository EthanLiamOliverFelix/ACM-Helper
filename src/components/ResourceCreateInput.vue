<script setup lang="ts">
import { nextTick, onMounted, ref, watch } from 'vue'
const props = defineProps<{ kind: 'file' | 'folder'; busy: boolean; error: string }>()
const emit = defineEmits<{ submit: [name: string]; cancel: [] }>()
const name = ref('')
const input = ref<HTMLInputElement | null>(null)
function submit() {
  if (props.busy) return
  if (!name.value.trim()) { emit('cancel'); return }
  emit('submit', name.value.trim())
}
function keydown(event: KeyboardEvent) {
  if (event.isComposing) return
  if (event.key === 'Enter') { event.preventDefault(); submit() }
  if (event.key === 'Escape' && !props.busy) { event.preventDefault(); emit('cancel') }
}
async function focus() { await nextTick(); input.value?.focus(); input.value?.scrollIntoView({ block: 'nearest' }) }
onMounted(focus)
watch(() => props.error, value => { if (value) void focus() })
</script>

<template>
  <div class="resource-create" @pointerdown.stop @click.stop @contextmenu.stop.prevent @keydown.stop="keydown">
    <div class="resource-create__row"><i class="codicon" :class="kind === 'folder' ? 'codicon-folder' : 'codicon-file'" aria-hidden="true" /><input ref="input" v-model="name" :disabled="busy" :aria-label="kind === 'file' ? '新文件名称（包含后缀）' : '新文件夹名称'" :aria-invalid="!!error" autocomplete="off" spellcheck="false" @blur="submit" /></div>
    <div v-if="error" class="resource-create__error" role="alert">{{ error }}</div>
  </div>
</template>

<style scoped>
.resource-create__row { display:flex; align-items:center; gap:5px; height:26px; padding:0 8px; }
.resource-create__row i { flex:0 0 16px; color:var(--color-text-muted); }
input { box-sizing:border-box; flex:1; min-width:0; height:24px; padding:0 5px; border:1px solid var(--color-accent); border-radius:2px; outline:none; background:var(--color-bg-input, var(--color-bg-panel-alt)); color:var(--color-text-primary); font:13px var(--font-ui); }
input[aria-invalid='true'] { border-color:var(--color-danger); }
.resource-create__error { padding:4px 8px 5px 29px; color:var(--color-danger); font-size:11px; overflow-wrap:anywhere; }
</style>
