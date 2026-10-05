<script setup lang="ts">
import { computed, nextTick, shallowRef, watch, onBeforeUnmount } from 'vue'
import { afterPaint } from '../utils/afterPaint'
import { useProblemStore } from '../stores/problemStore'
import { useSettingsStore } from '../stores/settingsStore'
import type { Language } from '../types'
import { monaco } from '../monaco'
import { configureMonaco } from '../monaco'
import { VueMonacoEditor } from '@guolao/vue-monaco-editor'
import { formatCode } from '../utils/codeFormatter'
import CodeVersionManager from './CodeVersionManager.vue'
import EditorRunControl from './EditorRunControl.vue'
import { useWorkbenchStore } from '../stores/workbenchStore'

const props = defineProps<{ groupId?: string }>()
const store = useProblemStore()
const settings = useSettingsStore()
const workbench = useWorkbenchStore()
configureMonaco()

const LANGUAGE_MAP: Record<Language, string> = {
  cpp: 'cpp',
  python: 'python',
  java: 'java',
}

const languageOptions: { key: Language; label: string }[] = [
  { key: 'cpp', label: 'C++' },
  { key: 'python', label: 'Python' },
  { key: 'java', label: 'Java' },
]

const editorRef = shallowRef<any>(null)
let breakpointDecorations: any = null
let breakpointHoverDecorations: any = null
let debugLineDecorations: any = null
let editorDisposables: any[] = []
let formatterDisposables: any[] = []

function registerFormatters() {
  if (formatterDisposables.length) return
  for (const language of ['cpp', 'python', 'java'] as Language[]) {
    formatterDisposables.push(monaco.languages.registerDocumentFormattingEditProvider(language, {
      async provideDocumentFormattingEdits(model: any) {
        store.isFormatting = true
        store.formatError = ''
        try {
          const formatted = await formatCode(model.getValue(), language)
          if (formatted === model.getValue()) return []
          return [{ range: model.getFullModelRange(), text: formatted }]
        } catch (error) {
          store.formatError = `格式化失败：${String(error)}`
          return []
        } finally {
          store.isFormatting = false
        }
      },
    }))
  }
}

async function formatDocument(editor = editorRef.value) {
  if (!editor || store.isFormatting) return
  await editor.getAction('editor.action.formatDocument')?.run()
  store.updateCode(editor.getValue())
}

function breakpointLine(event: any) {
  // Folding controls live in GUTTER_LINE_DECORATIONS and breakpoint glyphs in
  // GUTTER_GLYPH_MARGIN. Only the printed line-number area toggles a breakpoint.
  return event.target?.type === monaco.editor.MouseTargetType.GUTTER_LINE_NUMBERS
    ? event.target.position?.lineNumber
    : undefined
}

function renderBreakpoints() {
  if (!editorRef.value) return
  const decorations = store.breakpoints.map((line) => ({ range: { startLineNumber: line, startColumn: 1, endLineNumber: line, endColumn: 1 }, options: { isWholeLine: true, glyphMarginClassName: 'acm-breakpoint', linesDecorationsClassName: 'acm-breakpoint-line', glyphMarginHoverMessage: { value: `断点：第 ${line} 行（点击行号删除）` } } }))
  if (!breakpointDecorations) breakpointDecorations = editorRef.value.createDecorationsCollection(decorations)
  else breakpointDecorations.set(decorations)
}

function renderDebugLine() {
  if (!editorRef.value || !debugLineDecorations) return
  const line = store.debugSession?.active ? store.debugSession.line : undefined
  debugLineDecorations.set(line ? [{
    range: new monaco.Range(line, 1, line, 1),
    options: {
      isWholeLine: true,
      className: 'acm-debug-current-line',
      glyphMarginClassName: 'acm-debug-current-arrow',
      glyphMarginHoverMessage: { value: `调试器暂停在第 ${line} 行` },
    },
  }] : [])
  if (line) editorRef.value.revealLineInCenterIfOutsideViewport(line)
}

function handleMount(editor: any) {
  registerFormatters()
  editorRef.value = editor
  ownedModels.add(editor.getModel())
  breakpointDecorations = editor.createDecorationsCollection([])
  breakpointHoverDecorations = editor.createDecorationsCollection([])
  debugLineDecorations = editor.createDecorationsCollection([])
  editorDisposables.forEach((item) => item.dispose())
  editorDisposables = [
    editor.onMouseDown((event: any) => {
      const line = breakpointLine(event)
      if (line) store.toggleBreakpoint(line)
    }),
    editor.onMouseMove((event: any) => {
      const line = breakpointLine(event)
      breakpointHoverDecorations.set(line ? [{ range: new monaco.Range(line, 1, line, 1), options: { glyphMarginClassName: store.breakpoints.includes(line) ? 'acm-breakpoint' : 'acm-breakpoint-hover' } }] : [])
    }),
    editor.onMouseLeave(() => breakpointHoverDecorations.set([])),
  ]
  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, async () => {
    if (settings.formatOnSave) await formatDocument(editor)
    await store.persistDraft()
  })
  editor.addCommand(monaco.KeyMod.Shift | monaco.KeyMod.Alt | monaco.KeyCode.KeyF, () => formatDocument(editor))
  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.F5, () => store.runLocally())
  editor.addCommand(monaco.KeyCode.F5, async () => {
    await store.debugLocally()
    workbench.openDebugger()
  })
  editor.addCommand(monaco.KeyMod.Alt | monaco.KeyCode.F9, () => {
    const line = editor.getPosition()?.lineNumber
    if (line) store.toggleBreakpoint(line)
  })
  renderBreakpoints()
  renderDebugLine()
}

function handleChange(value: string) {
  store.updateCode(value ?? '')
}

function confirmResetCode() {
  if (!window.confirm(`确认将 ${store.contextFileName} 恢复为当前语言的初始代码片段吗？现有代码会被覆盖。`)) return
  store.resetCurrentCode()
}

// A stable editor switches Monaco models, preserving each file's undo and view state.
const modelPath = computed(() => `acm-editor://${props.groupId || 'main'}/${encodeURIComponent(store.draftPath || `${store.currentProblem?.platform}:${store.currentProblem?.id}`)}/${store.currentLanguage}`)
const ownedModels = new Set<any>()
watch(modelPath, async () => {
  const previous = editorRef.value?.getModel()
  if (previous) ownedModels.add(previous)
  await nextTick()
  const current = editorRef.value?.getModel()
  if (current) {
    ownedModels.add(current)
    // A cached model can predate an external disk update to its buffer.
    if (current.getValue() !== store.currentCode) current.setValue(store.currentCode)
  }
  renderBreakpoints()
  renderDebugLine()
}, { flush: 'pre' })
watch(() => store.breakpoints, renderBreakpoints, { deep: true })
watch(() => store.debugSession?.line, renderDebugLine)

const editorOptions = {
  automaticLayout: true,
  fontSize: 14,
  fontFamily: "'Cascadia Code', 'Fira Code', 'Consolas', 'Courier New', monospace",
  minimap: { enabled: true, scale: 1, showSlider: 'mouseover' as const },
  lineNumbers: 'on' as const,
  glyphMargin: true,
  scrollBeyondLastLine: false,
  wordWrap: 'off' as const,
  renderWhitespace: 'selection' as const,
  bracketPairColorization: { enabled: true },
  padding: { top: 12 },
  smoothScrolling: true,
  cursorBlinking: 'smooth' as const,
  cursorSmoothCaretAnimation: 'on' as const,
}

onBeforeUnmount(() => {
  editorDisposables.forEach((item) => item.dispose())
  editorDisposables = []
  editorRef.value = null
  const retired = [...ownedModels]
  ownedModels.clear()
  afterPaint(() => { for (const model of retired) if (!model.isDisposed()) model.dispose() })
})
</script>

<template>
  <div class="code-editor">
    <!-- 工具栏 -->
    <div class="code-editor__toolbar">
      <div class="code-editor__lang-select">
        <button
          v-for="opt in languageOptions"
          :key="opt.key"
          class="lang-btn"
          :class="{ 'lang-btn--active': store.currentLanguage === opt.key }"
          :disabled="store.isSubmitting"
          @click="workbench.setCurrentLanguage(opt.key)"
        >
          {{ opt.label }}
        </button>
      </div>
      <div class="code-editor__actions">
        <span v-if="store.formatError" class="code-editor__format-error" :title="store.formatError">{{ store.formatError }}</span>
        <button class="code-editor__icon" :disabled="store.isFormatting || !store.currentCode.trim()" title="格式化文档 (Shift+Alt+F)" aria-label="格式化文档" :aria-busy="store.isFormatting" @click="formatDocument()"><i class="codicon codicon-code" aria-hidden="true" /></button>
        <button class="code-editor__icon" title="重置代码：恢复为设置中的初始代码片段" aria-label="重置代码" @click="confirmResetCode"><i class="codicon codicon-discard" aria-hidden="true" /></button>
        <CodeVersionManager />
        <EditorRunControl />
      </div>
    </div>

    <!-- 编辑器主体 -->
    <div class="code-editor__editor">
      <VueMonacoEditor
        :path="modelPath"
        :language="LANGUAGE_MAP[store.currentLanguage]"
        :value="store.currentCode"
        :theme="settings.resolvedTheme === 'light' ? 'vs' : 'vs-dark'"
        :options="editorOptions"
        @mount="handleMount"
        @change="handleChange"
      />
    </div>
  </div>
</template>

<style scoped lang="scss">
.code-editor {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--color-bg-app);
  overflow: hidden;

  &__toolbar {
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 8px 16px;
    background: var(--color-bg-panel);
    border-bottom: 1px solid var(--color-border);
    flex-shrink: 0;
  }

  &__lang-select {
    display: flex;
    gap: 2px;
    background: var(--color-bg-app);
    border-radius: 4px;
    padding: 2px;
  }

  &__actions { display: flex; align-items: center; gap: 4px; margin-left: auto; min-width: 0; }
  &__icon { display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; padding: 0; border: 0; border-radius: 3px; background: transparent; color: var(--color-text-secondary); cursor: pointer; .codicon { font-size: 18px; } &:hover:not(:disabled) { background: var(--color-bg-hover); color: var(--color-text-primary); } &:disabled { opacity: .4; cursor: not-allowed; } }
  &__format-error { max-width: 160px; overflow: hidden; color: var(--color-danger); font-size: 9px; text-overflow: ellipsis; white-space: nowrap; }

  &__editor {
    flex: 1;
    overflow: hidden;
  }
}

.lang-btn {
  padding: 4px 12px;
  border: none;
  border-radius: 3px;
  background: transparent;
  color: var(--color-tone-cccccc);
  font-size: 12px;
  cursor: pointer;
  transition: background 0.12s, color 0.12s;

  &:hover {
    background: var(--color-bg-hover);
    color: var(--color-tone-e0e0e0);
  }

  &--active {
    background: var(--color-bg-selected);
    color: var(--color-text-on-accent);
  }

  &:disabled { opacity: .45; cursor: not-allowed; }
}
</style>

<style lang="scss">
.monaco-editor .margin-view-overlays .acm-breakpoint,
.monaco-editor .margin-view-overlays .acm-breakpoint-hover { border-radius: 50%; width: 11px !important; height: 11px !important; margin-left: 4px; margin-top: 4px; cursor: pointer; }
.monaco-editor .margin-view-overlays .acm-breakpoint { background: var(--color-tone-e64a4a); box-shadow: 0 0 0 2px var(--color-tone-7d2424); }
.monaco-editor .margin-view-overlays .acm-breakpoint-hover { background: var(--color-tone-e64a4a55); box-shadow: inset 0 0 0 1px var(--color-tone-e64a4a); }
.monaco-editor .margin-view-overlays .acm-breakpoint-line { border-left: 2px solid var(--color-tone-e64a4a); }
.monaco-editor .view-overlays .acm-debug-current-line { background: var(--color-tone-rgba-255-210-73-13); border-top: 1px solid var(--color-tone-rgba-255-210-73-35); border-bottom: 1px solid var(--color-tone-rgba-255-210-73-2); }
.monaco-editor .margin-view-overlays .acm-debug-current-arrow::before { content: '▶'; color: var(--color-tone-ffd249); font-size: 10px; line-height: 19px; margin-left: 2px; }
.monaco-editor .margin-view-overlays .line-numbers { cursor: pointer !important; }
</style>
