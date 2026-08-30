import { ref } from 'vue'
import { defineStore } from 'pinia'
import { invoke } from '@tauri-apps/api/core'
import type { NoteDocument, NoteEntry, Problem } from '../types'

export const useNoteStore = defineStore('notes', () => {
  const entries = ref<NoteEntry[]>([])
  const rootPath = ref('')
  const activeNote = ref<NoteDocument | null>(null)
  const loading = ref(false)
  const saving = ref(false)
  const dirty = ref(false)
  const error = ref('')
  let saveTimer: ReturnType<typeof setTimeout> | null = null

  function clearSaveTimer() {
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = null
  }

  async function refresh() {
    loading.value = true
    error.value = ''
    try {
      ;[entries.value, rootPath.value] = await Promise.all([
        invoke<NoteEntry[]>('list_note_entries'),
        invoke<string>('notes_root_path'),
      ])
    } catch (cause) { error.value = String(cause) }
    finally { loading.value = false }
  }

  async function saveActive() {
    clearSaveTimer()
    if (!activeNote.value || !dirty.value || saving.value) return
    saving.value = true
    error.value = ''
    const path = activeNote.value.path
    const content = activeNote.value.content
    try {
      const saved = await invoke<NoteDocument>('save_note', { path, content })
      if (activeNote.value?.path === path && activeNote.value.content === content) {
        activeNote.value = saved
        dirty.value = false
      }
    } catch (cause) { error.value = String(cause); throw cause }
    finally {
      saving.value = false
      if (activeNote.value?.path === path && activeNote.value.content !== content && dirty.value) {
        clearSaveTimer()
        saveTimer = setTimeout(() => { saveActive().catch(() => undefined) }, 0)
      }
    }
  }

  function updateContent(content: string) {
    if (!activeNote.value) return
    activeNote.value.content = content
    dirty.value = true
    clearSaveTimer()
    saveTimer = setTimeout(() => { saveActive().catch(() => undefined) }, 800)
  }

  async function openPath(path: string) {
    await saveActive().catch(() => undefined)
    error.value = ''
    activeNote.value = await invoke<NoteDocument>('read_note', { path })
    dirty.value = false
    return activeNote.value
  }

  async function openProblemNote(problem: Problem) {
    await saveActive().catch(() => undefined)
    error.value = ''
    activeNote.value = await invoke<NoteDocument>('get_or_create_problem_note', {
      platform: problem.platform,
      problemId: problem.id,
      title: problem.title,
    })
    dirty.value = false
    await refresh()
    return activeNote.value
  }

  async function createFile(parentPath: string | null, name: string) {
    await saveActive().catch(() => undefined)
    activeNote.value = await invoke<NoteDocument>('create_note_file', { parentPath, name })
    dirty.value = false
    await refresh()
    return activeNote.value
  }

  async function createFolder(parentPath: string | null, name: string) {
    const path = await invoke<string>('create_note_folder', { parentPath, name })
    await refresh()
    return path
  }

  function replaceActivePath(oldPath: string, newPath: string) {
    if (!activeNote.value) return
    const active = activeNote.value.path.toLowerCase()
    const source = oldPath.toLowerCase()
    if (active !== source && !active.startsWith(`${source}\\`) && !active.startsWith(`${source}/`)) return
    activeNote.value.path = `${newPath}${activeNote.value.path.slice(oldPath.length)}`
    activeNote.value.name = activeNote.value.path.split(/[\\/]/).pop() ?? activeNote.value.name
  }

  async function renameEntry(path: string, name: string) {
    await saveActive().catch(() => undefined)
    const newPath = await invoke<string>('rename_note_entry', { path, newName: name })
    replaceActivePath(path, newPath)
    await refresh()
    return newPath
  }

  async function deleteEntry(path: string) {
    const activePath = activeNote.value?.path.toLowerCase() ?? ''
    const source = path.toLowerCase()
    if (activePath === source || activePath.startsWith(`${source}\\`) || activePath.startsWith(`${source}/`)) {
      clearSaveTimer()
      activeNote.value = null
      dirty.value = false
    }
    await invoke('delete_note_entry', { path })
    await refresh()
  }

  async function pasteEntry(sourcePath: string, destinationPath: string | null, cut: boolean) {
    await saveActive().catch(() => undefined)
    const newPath = await invoke<string>('paste_note_entry', { sourcePath, destinationPath, cut })
    if (cut) replaceActivePath(sourcePath, newPath)
    await refresh()
    return newPath
  }

  function closeActive() {
    saveActive().catch(() => undefined)
    activeNote.value = null
    dirty.value = false
  }

  return {
    entries,
    rootPath,
    activeNote,
    loading,
    saving,
    dirty,
    error,
    refresh,
    saveActive,
    updateContent,
    openPath,
    openProblemNote,
    createFile,
    createFolder,
    renameEntry,
    deleteEntry,
    pasteEntry,
    closeActive,
  }
})
