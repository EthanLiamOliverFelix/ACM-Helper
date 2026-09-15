<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import DOMPurify from 'dompurify'
import { renderLuoguMarkdown } from '../utils/luoguMarkdown'
import { normalizeAiMarkdown } from '../utils/aiMarkdown'
import { applyMarkdownFormat, type MarkdownColor, type MarkdownFormat } from '../utils/markdownEditing'
import { createNoteImageMarkdown, extractNoteImageLayouts, replaceNoteImageSources, updateNoteImageLayout } from '../utils/noteImages'
import type { NoteImageAsset } from '../types'
import 'katex/dist/katex.min.css'

const props = defineProps<{ modelValue: string; mode: 'read' | 'edit'; placeholder?: string; notePath?: string }>()
const emit = defineEmits<{ 'update:modelValue': [value: string]; save: [] }>()
const editor = ref<HTMLTextAreaElement | null>(null)
const preview = ref<HTMLElement | null>(null)
const assetSources = shallowRef<Record<string, string>>({})
const imageError = ref('')
const importingImage = ref(false)
const arrangingImages = ref(false)
const imageLayouts = computed(() => extractNoteImageLayouts(props.modelValue))
const canvasMinHeight = computed(() => Math.max(240, ...imageLayouts.value.map((image) => image.y + 320)))
const rendered = computed(() => {
  const html = renderLuoguMarkdown(normalizeAiMarkdown(props.modelValue || ''))
  return DOMPurify.sanitize(replaceNoteImageSources(html, assetSources.value), {
    USE_PROFILES: { html: true },
    ADD_TAGS: ['u'],
    ADD_ATTR: ['style', 'data-note-image-id', 'data-note-x', 'data-note-y', 'data-note-width', 'draggable'],
    ADD_DATA_URI_TAGS: ['img'],
  })
})

watch([() => props.notePath, () => imageLayouts.value.map((image) => image.id).join('|')], async ([notePath]) => {
  imageError.value = ''
  if (!notePath || !imageLayouts.value.length) {
    assetSources.value = {}
    return
  }
  const requestedPath = notePath
  try {
    const assets = await invoke<NoteImageAsset[]>('load_note_image_assets', {
      notePath,
      assetIds: imageLayouts.value.map((image) => image.id),
    })
    if (props.notePath !== requestedPath) return
    assetSources.value = Object.fromEntries(assets.map((asset) => [asset.id, asset.dataUrl]))
  } catch (error) {
    if (props.notePath === requestedPath) imageError.value = String(error)
  }
}, { immediate: true })

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

async function insertAtCursor(markdown: string) {
  const textarea = editor.value
  const start = textarea?.selectionStart ?? props.modelValue.length
  const end = textarea?.selectionEnd ?? start
  const before = props.modelValue.slice(0, start)
  const after = props.modelValue.slice(end)
  const prefix = before && !before.endsWith('\n') ? '\n\n' : ''
  const suffix = after && !after.startsWith('\n') ? '\n\n' : '\n'
  const insertion = `${prefix}${markdown}${suffix}`
  emit('update:modelValue', `${before}${insertion}${after}`)
  await nextTick()
  textarea?.focus()
  textarea?.setSelectionRange(start + insertion.length, start + insertion.length)
}

async function importImage(command: 'pick_note_image' | 'paste_note_image') {
  if (!props.notePath || importingImage.value) return
  importingImage.value = true
  imageError.value = ''
  try {
    const asset = await invoke<NoteImageAsset | null>(command, { notePath: props.notePath })
    if (!asset) return
    assetSources.value = { ...assetSources.value, [asset.id]: asset.dataUrl }
    await insertAtCursor(createNoteImageMarkdown(asset.id, asset.displayName, imageLayouts.value.length))
  } catch (error) { imageError.value = String(error) }
  finally { importingImage.value = false }
}

function paste(event: ClipboardEvent) {
  if (!props.notePath || !event.clipboardData?.types.some((type) => type.startsWith('image/'))) return
  event.preventDefault()
  void importImage('paste_note_image')
}

let drag: null | { id: string; startClientX: number; startClientY: number; startX: number; startY: number; width: number; element: HTMLImageElement } = null

function startImageDrag(event: PointerEvent) {
  if (!arrangingImages.value) return
  const element = (event.target as Element | null)?.closest<HTMLImageElement>('img[data-note-image-id]')
  if (!element) return
  drag = {
    id: element.dataset.noteImageId ?? '',
    startClientX: event.clientX,
    startClientY: event.clientY,
    startX: Number(element.dataset.noteX ?? 0),
    startY: Number(element.dataset.noteY ?? 0),
    width: Number(element.dataset.noteWidth ?? element.clientWidth),
    element,
  }
  element.setPointerCapture?.(event.pointerId)
  event.preventDefault()
}

function moveImage(event: PointerEvent) {
  if (!drag || !preview.value) return
  const x = Math.max(0, Math.min(drag.startX + event.clientX - drag.startClientX, preview.value.clientWidth - 40))
  const y = Math.max(0, drag.startY + event.clientY - drag.startClientY)
  drag.element.style.left = `${Math.round(x)}px`
  drag.element.style.top = `${Math.round(y)}px`
  drag.element.dataset.noteX = String(Math.round(x))
  drag.element.dataset.noteY = String(Math.round(y))
}

function stopImageDrag() {
  if (!drag) return
  const { id, width, element } = drag
  drag = null
  emit('update:modelValue', updateNoteImageLayout(
    props.modelValue,
    id,
    Number(element.dataset.noteX ?? 0),
    Number(element.dataset.noteY ?? 0),
    width,
  ))
}

window.addEventListener('pointermove', moveImage)
window.addEventListener('pointerup', stopImageDrag)
window.addEventListener('pointercancel', stopImageDrag)
onBeforeUnmount(() => {
  window.removeEventListener('pointermove', moveImage)
  window.removeEventListener('pointerup', stopImageDrag)
  window.removeEventListener('pointercancel', stopImageDrag)
})
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
      <template v-if="notePath"><span /><button :disabled="importingImage" title="从本地选择图片" @mousedown.prevent @click="importImage('pick_note_image')">📷 导入</button><button :disabled="importingImage" title="粘贴剪贴板中的图片，也可以直接按 Ctrl+V" @mousedown.prevent @click="importImage('paste_note_image')">▣ 粘贴图片</button></template>
      <em>Ctrl+S 保存</em>
    </div>
    <div v-if="imageError" class="markdown-note__image-error">{{ imageError }}</div>
    <textarea
      v-if="mode === 'edit'"
      ref="editor"
      :value="modelValue"
      :placeholder="placeholder || '使用 Markdown 记录思路、易错点和技巧…'"
      spellcheck="false"
      @input="emit('update:modelValue', ($event.target as HTMLTextAreaElement).value)"
      @keydown="keydown"
      @paste="paste"
    />
    <div v-else-if="modelValue.trim()" class="markdown-note__preview-shell">
      <div v-if="imageLayouts.length" class="markdown-note__layout-toolbar"><span>{{ imageLayouts.length }} 张本地图片</span><button :class="{ active: arrangingImages }" @click="arrangingImages = !arrangingImages">{{ arrangingImages ? '完成排版' : '移动图片' }}</button><em v-if="arrangingImages">拖动图片即可保存位置</em></div>
      <article ref="preview" class="markdown-note__preview" :class="{ arranging: arrangingImages }" :style="{ minHeight: `${canvasMinHeight}px` }" @pointerdown="startImageDrag" v-html="rendered" />
    </div>
    <div v-else class="markdown-note__empty">这篇笔记还没有内容，切换到编辑模式开始记录。</div>
  </div>
</template>

<style scoped lang="scss">
.markdown-note { min-height: 0; height: 100%; display: flex; flex-direction: column; background: var(--color-bg-app); }
.markdown-note__toolbar { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; padding: 7px 9px; border-bottom: 1px solid var(--color-border); background: var(--color-bg-panel); button, select { min-width: 27px; height: 27px; padding: 0 7px; border: 1px solid var(--color-border-control); border-radius: 4px; background: var(--color-bg-control); color: var(--color-text-strong); font-size: 11px; cursor: pointer; &:hover { border-color: var(--color-accent); background: var(--color-accent-surface-hover); color: var(--color-text-on-accent); } } select { min-width: 74px; } > span { width: 1px; height: 19px; margin: 0 3px; background: var(--color-border-control); } em { margin-left: auto; color: var(--color-text-faint); font-size: 9px; font-style: normal; } }
textarea { box-sizing: border-box; width: 100%; min-height: 0; flex: 1; resize: none; padding: 18px 20px; border: 0; outline: 0; background: var(--color-bg-app); color: var(--color-text-primary); font: 13px/1.7 'Cascadia Code', Consolas, monospace; tab-size: 2; }
.markdown-note__image-error { flex: 0 0 auto; padding: 6px 10px; border-bottom: 1px solid var(--color-danger-border); background: var(--color-danger-surface); color: var(--color-danger); font-size: 10px; }
.markdown-note__preview-shell { position: relative; min-height: 0; flex: 1; overflow: auto; }
.markdown-note__layout-toolbar { position: sticky; top: 0; z-index: 4; display: flex; align-items: center; gap: 7px; min-height: 34px; padding: 4px 10px; border-bottom: 1px solid var(--color-border); background: var(--color-bg-panel-translucent); color: var(--color-text-muted); font-size: 10px; backdrop-filter: blur(8px); button { padding: 4px 9px; border: 1px solid var(--color-accent-border); border-radius: 4px; background: var(--color-accent-surface); color: var(--color-accent-text); cursor: pointer; &.active { background: var(--color-accent-strong); color: var(--color-text-on-accent); } } em { color: var(--color-warning); font-style: normal; } }
.markdown-note__preview { position: relative; box-sizing: border-box; padding: 18px 24px 50px; color: var(--color-text-primary); font-size: 14px; line-height: 1.75; overflow-wrap: anywhere; :deep(h1), :deep(h2), :deep(h3) { color: var(--color-tone-e5e5e5); } :deep(h1) { padding-bottom: 8px; border-bottom: 1px solid var(--color-border-control); font-size: 25px; } :deep(h2) { margin-top: 22px; color: var(--color-accent-text); font-size: 19px; } :deep(h3) { color: var(--color-warning); font-size: 16px; } :deep(a) { color: var(--color-tone-5fb3f3); } :deep(code) { padding: 2px 5px; border-radius: 3px; background: var(--color-bg-control); color: var(--color-code); font-family: Consolas, monospace; } :deep(pre) { overflow: auto; padding: 12px; border: 1px solid var(--color-border); border-radius: 5px; background: var(--color-bg-deep); } :deep(blockquote) { margin-left: 0; padding-left: 12px; border-left: 3px solid var(--color-accent); color: var(--color-text-soft); } :deep(table) { border-collapse: collapse; } :deep(th), :deep(td) { padding: 6px 9px; border: 1px solid var(--color-border-input); } :deep(img) { max-width: 100%; border-radius: 5px; box-shadow: 0 4px 16px var(--color-shadow); } &.arranging :deep(img[data-note-image-id]) { z-index: 3; outline: 2px solid var(--color-accent); cursor: grab; touch-action: none; user-select: none; } &.arranging :deep(img[data-note-image-id]:active) { cursor: grabbing; } :deep(.markdown-color-red) { color: var(--color-tone-ff7b72); } :deep(.markdown-color-orange) { color: var(--color-tone-ffa657); } :deep(.markdown-color-yellow) { color: var(--color-tone-e3d45b); } :deep(.markdown-color-green) { color: var(--color-tone-7ee787); } :deep(.markdown-color-blue) { color: var(--color-tone-79c0ff); } :deep(.markdown-color-purple) { color: var(--color-tone-d2a8ff); } }
.markdown-note__empty { display: grid; place-items: center; min-height: 0; flex: 1; color: var(--color-text-faint); font-size: 12px; }
</style>
