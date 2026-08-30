<script setup lang="ts">
import { shallowRef, watch, onBeforeUnmount } from 'vue'
import { useProblemStore } from '../stores/problemStore'
import { useSettingsStore } from '../stores/settingsStore'
import type { Language } from '../types'
import { monaco } from '../monaco'
import { configureMonaco } from '../monaco'
import { VueMonacoEditor } from '@guolao/vue-monaco-editor'
import { formatCode } from '../utils/codeFormatter'

const store = useProblemStore()
const settings = useSettingsStore()
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
  editor.addCommand(monaco.KeyCode.F5, () => store.debugLocally())
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

// 当切换题目时清空编辑器内容由 store.selectProblem 处理，
// 但需要同步编辑器 UI —— 用 key 强制重建
const editorKey = shallowRef(0)
watch(
  () => [store.currentProblem?.id, store.currentLanguage, store.currentCode],
  (_next, previous) => {
    if (previous && (_next[0] === previous[0] && _next[1] === previous[1])) return
    editorKey.value++
  }
)
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
          @click="store.setLanguage(opt.key)"
        >
          {{ opt.label }}
        </button>
      </div>
      <span class="code-editor__filename">
        {{ store.contextFileName }}
      </span>
      <button class="code-editor__format" :disabled="store.isFormatting || !store.currentCode.trim()" title="格式化文档 (Shift+Alt+F)" @click="formatDocument()">{{ store.isFormatting ? '格式化中…' : '格式化' }}</button>
      <span class="code-editor__shortcuts">Ctrl+F5 运行 · F5 调试 · Alt+F9 断点</span>
      <span v-if="store.formatError" class="code-editor__format-error" :title="store.formatError">{{ store.formatError }}</span>
      <span class="code-editor__saved" :class="`code-editor__saved--${store.draftSaveStatus}`">{{ { template: '尚未创建本地文件', saved: '✓ 已保存', saving: '保存中…', error: '保存失败' }[store.draftSaveStatus] }}</span>
    </div>

    <!-- 编辑器主体 -->
    <div class="code-editor__editor">
      <VueMonacoEditor
        :key="editorKey"
        :language="LANGUAGE_MAP[store.currentLanguage]"
        :value="store.currentCode"
        theme="vs-dark"
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
  background: #1e1e1e;
  overflow: hidden;

  &__toolbar {
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 8px 16px;
    background: #252526;
    border-bottom: 1px solid #3c3c3c;
    flex-shrink: 0;
  }

  &__lang-select {
    display: flex;
    gap: 2px;
    background: #1e1e1e;
    border-radius: 4px;
    padding: 2px;
  }

  &__filename {
    font-size: 12px;
    color: #858585;
    font-family: 'Consolas', 'Courier New', monospace;
  }

  &__shortcuts { margin-left: auto; color: #666; font-size: 10px; }
  &__format { padding: 3px 8px; border: 1px solid #464646; border-radius: 3px; background: #303030; color: #bbb; font-size: 10px; cursor: pointer; &:hover:not(:disabled) { border-color: #569cd6; color: #fff; } &:disabled { opacity: .4; cursor: not-allowed; } }
  &__format-error { max-width: 210px; overflow: hidden; color: #f48771; font-size: 9px; text-overflow: ellipsis; white-space: nowrap; }
  &__saved { color: #4ec9b0; font-size: 11px; &--template { color: #777; } &--saving { color: #dcdcaa; } &--error { color: #f48771; } }

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
  color: #cccccc;
  font-size: 12px;
  cursor: pointer;
  transition: background 0.12s, color 0.12s;

  &:hover {
    background: #2a2d2e;
    color: #e0e0e0;
  }

  &--active {
    background: #37373d;
    color: #ffffff;
  }

  &:disabled { opacity: .45; cursor: not-allowed; }
}
</style>

<style lang="scss">
.monaco-editor .margin-view-overlays .acm-breakpoint,
.monaco-editor .margin-view-overlays .acm-breakpoint-hover { border-radius: 50%; width: 11px !important; height: 11px !important; margin-left: 4px; margin-top: 4px; cursor: pointer; }
.monaco-editor .margin-view-overlays .acm-breakpoint { background: #e64a4a; box-shadow: 0 0 0 2px #7d2424; }
.monaco-editor .margin-view-overlays .acm-breakpoint-hover { background: #e64a4a55; box-shadow: inset 0 0 0 1px #e64a4a; }
.monaco-editor .margin-view-overlays .acm-breakpoint-line { border-left: 2px solid #e64a4a; }
.monaco-editor .view-overlays .acm-debug-current-line { background: rgba(255, 210, 73, .13); border-top: 1px solid rgba(255, 210, 73, .35); border-bottom: 1px solid rgba(255, 210, 73, .2); }
.monaco-editor .margin-view-overlays .acm-debug-current-arrow::before { content: '▶'; color: #ffd249; font-size: 10px; line-height: 19px; margin-left: 2px; }
.monaco-editor .margin-view-overlays .line-numbers { cursor: pointer !important; }
</style>
