import { reactive } from 'vue'
import { defineStore } from 'pinia'
import { invoke } from '@tauri-apps/api/core'

export const textPathKey = (path: string) => path.replace(/\\/g, '/').toLowerCase()
export interface TextDocument {
  path: string
  text: string
  original: string
  loaded: boolean
  loading: boolean
  saving: boolean
  error: string
}

export const useTextFileStore = defineStore('text-files', () => {
  const documents = reactive<Record<string, TextDocument>>({})
  const pending = new Map<string, Promise<void>>()
  function document(path: string) {
    const key = textPathKey(path)
    if (!documents[key]) {
      documents[key] = { path, text: '', original: '', loaded: false, loading: false, saving: false, error: '' }
    }
    // Read back through the reactive collection. Returning an assignment's value
    // exposes the raw object on first load, so its async updates never repaint.
    return documents[key]
  }
  async function load(path: string) {
    const key = textPathKey(path)
    const doc = document(path)
    if (doc.loaded) return
    if (pending.has(key)) return pending.get(key)
    doc.loading = true
    doc.error = ''
    const task = (async () => {
      try {
        const text = await invoke<string>('read_workspace_text', { path })
        doc.text = doc.original = text
        doc.loaded = true
      } catch (e) { doc.error = String(e) }
      finally { doc.loading = false; pending.delete(key) }
    })()
    pending.set(key, task)
    return task
  }
  async function save(path: string) {
    const doc = document(path)
    if (!doc.loaded || doc.saving || doc.text === doc.original) return
    doc.saving = true
    doc.error = ''
    const text = doc.text
    try {
      await invoke('save_workspace_text', { path: doc.path, text, expected: doc.original })
      doc.original = text
    } catch (e) { doc.error = String(e) }
    finally { doc.saving = false }
  }
  function isDirty(path: string) {
    const doc = documents[textPathKey(path)]
    return !!doc?.loaded && doc.text !== doc.original
  }
  function forget(path: string) { delete documents[textPathKey(path)] }
  function move(oldPath: string, newPath: string) {
    const old = textPathKey(oldPath)
    for (const [key, doc] of Object.entries(documents)) {
      if (key !== old && !key.startsWith(`${old}/`)) continue
      delete documents[key]
      doc.path = `${newPath}${doc.path.slice(oldPath.length)}`
      documents[textPathKey(doc.path)] = doc
    }
  }
  return { documents, document, load, save, isDirty, forget, move }
})
