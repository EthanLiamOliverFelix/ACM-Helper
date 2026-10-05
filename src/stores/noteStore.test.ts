import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useNoteStore } from './noteStore'

const invoke = vi.hoisted(() => vi.fn())
vi.mock('@tauri-apps/api/core', () => ({ invoke }))
vi.mock('../dataCenter', () => ({ getDataCenterValue: (_key: string, fallback: unknown) => fallback, saveDataCenterValue: vi.fn(async () => {}) }))

beforeEach(() => {
  setActivePinia(createPinia())
  invoke.mockReset()
})

describe('batch note moves', () => {
  it('saves edits before moving and updates the active note path with one final refresh', async () => {
    const store = useNoteStore()
    store.activeNote = { name: '题解.md', path: 'F:\\notes\\算法\\题解.md', content: '未保存内容', updatedAt: 1 }
    store.dirty = true
    invoke.mockImplementation(async (command: string, args: Record<string, string>) => {
      if (command === 'save_note') return { ...store.activeNote }
      if (command === 'paste_note_entry') return args.destinationPath + '\\' + args.sourcePath.split('\\').pop()
      if (command === 'notes_root_path') return 'F:\\notes'
      return []
    })
    const result = await store.moveEntries(['F:\\notes\\算法'], 'F:\\notes\\归档')
    expect(invoke.mock.calls.map(call => call[0])).toEqual(['save_note', 'paste_note_entry', 'list_note_entries', 'notes_root_path'])
    expect(store.activeNote.path).toBe('F:\\notes\\归档\\算法\\题解.md')
    expect(store.activeNote.content).toBe('未保存内容')
    expect(result.failed).toEqual([])
  })

  it('reports partial failures while continuing the remaining selected items', async () => {
    const store = useNoteStore()
    invoke.mockImplementation(async (command: string, args: Record<string, string>) => {
      if (command === 'paste_note_entry') {
        if (args.sourcePath === 'failed.md') throw new Error('文件被占用')
        return 'F:\\notes\\归档\\ok.md'
      }
      if (command === 'notes_root_path') return 'F:\\notes'
      return []
    })
    const result = await store.moveEntries(['failed.md', 'ok.md'], 'F:\\notes\\归档')
    expect(result.moved).toEqual([{ source: 'ok.md', target: 'F:\\notes\\归档\\ok.md' }])
    expect(result.failed[0]).toMatchObject({ path: 'failed.md' })
    expect(result.failed[0].error).toContain('文件被占用')
    expect(invoke.mock.calls.filter(call => call[0] === 'list_note_entries')).toHaveLength(1)
  })

  it('does not move unsaved notes when saving fails', async () => {
    const store = useNoteStore()
    store.activeNote = { name: '题解.md', path: 'F:\\notes\\题解.md', content: '未保存内容', updatedAt: 1 }
    store.dirty = true
    invoke.mockRejectedValue(new Error('无法保存'))
    await expect(store.moveEntries([store.activeNote.path], 'F:\\notes\\归档')).rejects.toThrow('无法保存')
    expect(invoke).toHaveBeenCalledOnce()
    expect(invoke.mock.calls[0][0]).toBe('save_note')
    expect(store.dirty).toBe(true)
  })
})
