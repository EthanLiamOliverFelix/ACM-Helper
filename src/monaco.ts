import * as monaco from 'monaco-editor'
import { loader } from '@guolao/vue-monaco-editor'
import EditorWorker from 'monaco-editor/editor/editor.worker.js?worker'
import JsonWorker from 'monaco-editor/language/json/json.worker.js?worker'
import CssWorker from 'monaco-editor/language/css/css.worker.js?worker'
import HtmlWorker from 'monaco-editor/language/html/html.worker.js?worker'
import TypeScriptWorker from 'monaco-editor/language/typescript/ts.worker.js?worker'
import { pythonBlockIndentPattern } from './utils/pythonIndentation'

let configured = false

export function configureMonaco() {
  if (configured) return
  ;(self as any).MonacoEnvironment = {
    getWorker(_: string, label: string) {
      if (label === 'json') return new JsonWorker()
      if (label === 'css' || label === 'scss' || label === 'less') return new CssWorker()
      if (label === 'html' || label === 'handlebars' || label === 'razor') return new HtmlWorker()
      if (label === 'typescript' || label === 'javascript') return new TypeScriptWorker()
      return new EditorWorker()
    },
  }
  loader.config({ monaco })
  // Keep the keyboard navigation mode available without toggling it on Ctrl+M.
  const toggleTabFocus = 'editor.action.toggleTabFocusMode'
  const tabFocusShortcut = monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyM
  monaco.editor.addKeybindingRules([
    { keybinding: 0, command: `-${toggleTabFocus}` },
    { keybinding: tabFocusShortcut | monaco.KeyMod.Shift, command: toggleTabFocus, when: 'editorTextFocus' },
  ])
  // The bundled Python contribution loads its Enter rules asynchronously.
  // Register this fallback immediately so the first model can indent too.
  monaco.languages.setLanguageConfiguration('python', {
    indentationRules: {
      increaseIndentPattern: pythonBlockIndentPattern,
      decreaseIndentPattern: /(?!)/,
    },
  })
  configured = true
}

export { monaco }
