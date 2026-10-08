import type { Language } from '../types'
import { formatCode } from './codeFormatter'

const registered = new WeakSet<object>()

/** Monaco providers are global, even when editors are mounted in separate groups. */
export function registerCodeFormatters(monaco: any, state: { isFormatting: boolean; formatError: string }) {
  if (registered.has(monaco.languages)) return
  registered.add(monaco.languages)
  let pending = 0
  for (const language of ['cpp', 'python', 'java'] as Language[]) {
    monaco.languages.registerDocumentFormattingEditProvider(language, {
      async provideDocumentFormattingEdits(model: any, _options: unknown, token: { isCancellationRequested: boolean }) {
        const source = model.getValue()
        const version = model.getVersionId()
        pending++
        state.isFormatting = true
        state.formatError = ''
        try {
          const formatted = await formatCode(source, language)
          if (token.isCancellationRequested || model.isDisposed() || model.getVersionId() !== version || formatted === source) return []
          return [{ range: model.getFullModelRange(), text: formatted }]
        } catch (error) {
          state.formatError = `格式化失败：${String(error)}`
          return []
        } finally {
          state.isFormatting = --pending > 0
        }
      },
    })
  }
}
