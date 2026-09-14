<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import DOMPurify from 'dompurify'
import { renderLuoguMarkdown } from '../utils/luoguMarkdown'
import { normalizeAiMarkdown } from '../utils/aiMarkdown'
import { applyMarkdownFormat, type MarkdownColor, type MarkdownFormat } from '../utils/markdownEditing'
import 'katex/dist/katex.min.css'

const props = defineProps<{ modelValue: string; mode: 'read' | 'edit'; placeholder?: string }>()
const emit = defineEmits<{ 'update:modelValue': [value: string]; save: [] }>()
const editor = ref<HTMLTextAreaElement | null>(null)
const rendered = computed(() => DOMPurify.sanitize(renderLuoguMarkdown(normalizeAiMarkdown(props.modelValue || '')),
  { USE_PROFILES: { html: true }, ADD_TAGS: ['u'] }))

async function format(type: MarkdownFormat) {
  const textarea = editor.value
  if (!textarea) return
  const result = applyMarkdownFormat(props.modelValue, textarea.selectionStart, textarea.selectionEnd, type)
  emit('update:modelValue', result.text)
  await nextTick()
  textarea.focus()
  textarea.setSelectionRange(result.selectionStart, result.selectionEnd)
}

function keydown(event: KeyboardEvent) {
  if (!(event.ctrlKey || event.metaKey)) return
  const key = event.key.toLowerCase()
  if (key === 's') { event.preventDefault(); emit('save'); return }
  if (key === 'b') { event.preventDefault(); format('bold'); return }
  if (key === 'i') { event.preventDefault(); format('italic'); return }
  if (key === 'u') { event.preventDefault(); format('underline'); return }
  if (key === 'x' && event.shiftKey) { event.preventDefault(); format('strikethrough'); return }
  if (key === 'm' && event.shiftKey) { event.preventDefault(); format('formula'); }
}

function color(event: Event) {
  const select = event.target as HTMLSelectElement
  if (select.value) format(`color-${select.value as MarkdownColor}`)
  select.value = ''
}
</script>

<template>
  <div class="markdown-note">
    <div v-if="mode === 'edit'" class="markdown-note__toolbar">
      <button title="加粗（Ctrl+B）" @mousedown.prevent @click="format('bold')"><b>B</b></button>
      <button title="斜体（Ctrl+I）" @mousedown.prevent @click="format('italic')"><i>I</i></button>
      <button title="下划线（Ctrl+U）" @mousedown.prevent @click="format('underline')"><u>U</u></button>
      <button title="删除线（Ctrl+Shift+X）" @mousedown.prevent @click="format('strikethrough')"><s>S</s></button>
      <select title="字体颜色" aria-label="字体颜色" @change="color">
        <option value="">🎨 颜色</option>
        <option value="red">红色</option>
        <option value="orange">橙色</option>
        <option value="yellow">黄色</option>
        <option value="green">绿色</option>
        <option value="blue">蓝色</option>
        <option value="purple">紫色</option>
      </select>
      <span />
      <button title="二级标题" @mousedown.prevent @click="format('heading')">H₂</button>
      <button title="无序列表" @mousedown.prevent @click="format('list')">• 列表</button>
      <button title="行内代码" @mousedown.prevent @click="format('code')">&lt;/&gt;</button>
      <button title="行内公式（Ctrl+Shift+M）" @mousedown.prevent @click="format('formula')">$x$</button>
      <button title="独立公式" @mousedown.prevent @click="format('formula-block')">∑</button>
      <button title="链接" @mousedown.prevent @click="format('link')">🔗</button>
      <em>Ctrl+S 保存</em>
    </div>
    <textarea
      v-if="mode === 'edit'"
      ref="editor"
      :value="modelValue"
      :placeholder="placeholder || '使用 Markdown 记录思路、易错点和技巧…'"
      spellcheck="false"
      @input="emit('update:modelValue', ($event.target as HTMLTextAreaElement).value)"
      @keydown="keydown"
    />
    <article v-else-if="modelValue.trim()" class="markdown-note__preview" v-html="rendered" />
    <div v-else class="markdown-note__empty">这篇笔记还没有内容，切换到编辑模式开始记录。</div>
  </div>
</template>

<style scoped lang="scss">
.markdown-note { min-height: 0; height: 100%; display: flex; flex-direction: column; background: var(--color-bg-app); }
.markdown-note__toolbar { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; padding: 7px 9px; border-bottom: 1px solid var(--color-border); background: var(--color-bg-panel); button, select { min-width: 27px; height: 27px; padding: 0 7px; border: 1px solid var(--color-border-control); border-radius: 4px; background: var(--color-bg-control); color: var(--color-text-strong); font-size: 11px; cursor: pointer; &:hover { border-color: var(--color-accent); background: var(--color-accent-surface-hover); color: var(--color-text-on-accent); } } select { min-width: 74px; } > span { width: 1px; height: 19px; margin: 0 3px; background: var(--color-border-control); } em { margin-left: auto; color: var(--color-text-faint); font-size: 9px; font-style: normal; } }
textarea { box-sizing: border-box; width: 100%; min-height: 0; flex: 1; resize: none; padding: 18px 20px; border: 0; outline: 0; background: var(--color-bg-app); color: var(--color-text-primary); font: 13px/1.7 'Cascadia Code', Consolas, monospace; tab-size: 2; }
.markdown-note__preview { min-height: 0; flex: 1; overflow: auto; padding: 18px 24px 50px; color: var(--color-text-primary); font-size: 14px; line-height: 1.75; overflow-wrap: anywhere; :deep(h1), :deep(h2), :deep(h3) { color: var(--color-tone-e5e5e5); } :deep(h1) { padding-bottom: 8px; border-bottom: 1px solid var(--color-border-control); font-size: 25px; } :deep(h2) { margin-top: 22px; color: var(--color-accent-text); font-size: 19px; } :deep(h3) { color: var(--color-warning); font-size: 16px; } :deep(a) { color: var(--color-tone-5fb3f3); } :deep(code) { padding: 2px 5px; border-radius: 3px; background: var(--color-bg-control); color: var(--color-code); font-family: Consolas, monospace; } :deep(pre) { overflow: auto; padding: 12px; border: 1px solid var(--color-border); border-radius: 5px; background: var(--color-bg-deep); } :deep(blockquote) { margin-left: 0; padding-left: 12px; border-left: 3px solid var(--color-accent); color: var(--color-text-soft); } :deep(table) { border-collapse: collapse; } :deep(th), :deep(td) { padding: 6px 9px; border: 1px solid var(--color-border-input); } :deep(img) { max-width: 100%; } :deep(.markdown-color-red) { color: var(--color-tone-ff7b72); } :deep(.markdown-color-orange) { color: var(--color-tone-ffa657); } :deep(.markdown-color-yellow) { color: var(--color-tone-e3d45b); } :deep(.markdown-color-green) { color: var(--color-tone-7ee787); } :deep(.markdown-color-blue) { color: var(--color-tone-79c0ff); } :deep(.markdown-color-purple) { color: var(--color-tone-d2a8ff); } }
.markdown-note__empty { display: grid; place-items: center; min-height: 0; flex: 1; color: var(--color-text-faint); font-size: 12px; }
</style>
