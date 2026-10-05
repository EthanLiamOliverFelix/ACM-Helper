import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { invoke } from '@tauri-apps/api/core'
import { nextTick, watchEffect } from 'vue'
import { useTextFileStore } from './textFileStore'
import { useWorkbenchStore, normalizeWorkbenchState } from './workbenchStore'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
vi.mock('../dataCenter', () => ({ getDataCenterValue: (_key: string, fallback: unknown) => fallback, saveDataCenterValue: vi.fn(async () => {}) }))
beforeEach(() => { setActivePinia(createPinia()); vi.mocked(invoke).mockReset() })

describe('plain text files in the workbench', () => {
  it('refreshes the visible loading state as soon as the first file finishes reading', async () => {
    const files = useTextFileStore()
    let finish!: (value: string) => void
    vi.mocked(invoke).mockImplementationOnce(() => new Promise<string>(resolve => { finish = resolve }) as never)
    // The immediate path watcher starts loading before the component first renders.
    const loading = files.load('F:/first.in')
    let visible = ''
    const stop = watchEffect(() => {
      const doc = files.document('F:/first.in')
      visible = doc.loading ? 'loading' : doc.loaded ? doc.text : doc.error
    })
    try {
      expect(visible).toBe('loading')
      finish('123\n')
      await loading
      await nextTick()
      expect(visible).toBe('123\n')
    } finally { stop() }
  })

  it('shows a first-read error immediately without switching tabs', async () => {
    const files = useTextFileStore()
    vi.mocked(invoke).mockRejectedValueOnce('无法读取文件')
    const loading = files.load('F:/missing.in')
    let visible = ''
    const stop = watchEffect(() => {
      const doc = files.document('F:/missing.in')
      visible = doc.loading ? 'loading' : doc.error
    })
    try {
      await loading
      await nextTick()
      expect(visible).toBe('无法读取文件')
    } finally { stop() }
  })
  it('opens one tab per file without binding a problem and restores its path', () => {
    const workbench = useWorkbenchStore()
    workbench.openTextFile('F:\\project\\flip.in')
    workbench.openTextFile('f:/project/flip.in')
    expect(workbench.groups[0].tabs).toHaveLength(1)
    expect(workbench.activeTab?.kind).toBe('text')
    expect(workbench.activeTab?.context).toBeUndefined()
    expect(vi.mocked(invoke)).not.toHaveBeenCalled()
    const restored = normalizeWorkbenchState(workbench.snapshot())
    expect(restored.groups[0].tabs[0].path).toBe('F:\\project\\flip.in')
  })

  it('keeps separate unsaved buffers when switching tabs, and does not reload edited text', async () => {
    vi.mocked(invoke).mockResolvedValueOnce('input').mockResolvedValueOnce('output')
    const files = useTextFileStore()
    await files.load('F:/a.in')
    files.document('F:/a.in').text = 'changed input'
    await files.load('F:/b.out')
    await files.load('f:/a.in')
    expect(files.document('F:/a.in').text).toBe('changed input')
    expect(files.document('F:/b.out').text).toBe('output')
    expect(files.isDirty('F:/a.in')).toBe(true)
    expect(vi.mocked(invoke)).toHaveBeenCalledTimes(2)
  })

  it('saves the submitted snapshot while preserving edits made during saving', async () => {
    const files = useTextFileStore()
    vi.mocked(invoke).mockResolvedValueOnce('original')
    await files.load('F:/a.in')
    const doc = files.document('F:/a.in')
    doc.text = 'first edit'
    let finish!: () => void
    vi.mocked(invoke).mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve }) as never)
    const saving = files.save('F:/a.in')
    doc.text = 'second edit'
    finish()
    await saving
    expect(invoke).toHaveBeenLastCalledWith('save_workspace_text', { path: 'F:/a.in', text: 'first edit', expected: 'original' })
    expect(doc.original).toBe('first edit')
    expect(doc.text).toBe('second edit')
    expect(files.isDirty('F:/a.in')).toBe(true)
  })

  it('retains edits and reports an external save conflict', async () => {
    const files = useTextFileStore()
    vi.mocked(invoke).mockResolvedValueOnce('original')
    await files.load('F:/a.in')
    files.document('F:/a.in').text = 'edited'
    vi.mocked(invoke).mockRejectedValueOnce('文件已被外部修改')
    await files.save('F:/a.in')
    expect(files.document('F:/a.in').original).toBe('original')
    expect(files.document('F:/a.in').error).toContain('外部修改')
    expect(files.isDirty('F:/a.in')).toBe(true)
  })

  it('updates tabs and unsaved buffers when a parent folder is renamed', async () => {
    const workbench = useWorkbenchStore()
    const files = useTextFileStore()
    workbench.openTextFile('F:/project/a.in')
    vi.mocked(invoke).mockResolvedValueOnce('original')
    await files.load('F:/project/a.in')
    files.document('F:/project/a.in').text = 'edited'
    workbench.workspacePathChanged('F:/project', 'F:/renamed')
    expect(workbench.activeTab?.path).toBe('F:/renamed/a.in')
    expect(workbench.groups[0].activeTabId).toBe('text:f:/renamed/a.in')
    expect(files.document('F:/renamed/a.in').text).toBe('edited')
    expect(files.documents['f:/project/a.in']).toBeUndefined()
    workbench.workspacePathRemoved('F:/renamed')
    expect(workbench.groups[0].tabs).toHaveLength(0)
    expect(files.documents['f:/renamed/a.in']).toBeUndefined()
  })

  it('keeps a dirty tab when closing is cancelled', async () => {
    const workbench = useWorkbenchStore()
    const files = useTextFileStore()
    workbench.openTextFile('F:/a.in')
    vi.mocked(invoke).mockResolvedValueOnce('original')
    await files.load('F:/a.in')
    files.document('F:/a.in').text = 'edited'
    const confirm = vi.fn(() => false)
    vi.stubGlobal('window', { confirm })
    try {
      workbench.closeTab('group-1', 'text:f:/a.in')
      expect(workbench.groups[0].tabs).toHaveLength(1)
      expect(files.isDirty('F:/a.in')).toBe(true)
      confirm.mockReturnValue(true)
      workbench.closeTab('group-1', 'text:f:/a.in')
      expect(workbench.groups[0].tabs).toHaveLength(0)
    } finally { vi.unstubAllGlobals() }
  })
})
