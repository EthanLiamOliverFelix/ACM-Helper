import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useWorkbenchStore, type WorkbenchTab } from './workbenchStore'

vi.mock('../dataCenter', () => ({
  getDataCenterValue: (_key: string, fallback: unknown) => fallback,
  saveDataCenterValue: vi.fn(async () => {}),
}))
beforeEach(() => setActivePinia(createPinia()))

describe('workspace tab paths', () => {
  it('updates active and inactive tabs below a moved folder while retaining problem identity', () => {
    const store = useWorkbenchStore()
    const makeTab = (path: string, problemId: string): WorkbenchTab => ({
      id: `code:file:${path.toLowerCase()}:cpp`, kind: 'code', title: 'before.cpp',
      context: { kind: 'local-file', contextId: `file:${path.toLowerCase()}`, path,
        platform: 'luogu', problemId, title: problemId, language: 'cpp' },
    })
    store.groups[0].tabs = [makeTab('F:\\project\\a.cpp', 'P1596'), makeTab('F:\\project\\nested\\b.cpp', 'P1001'), makeTab('F:\\project-copy\\c.cpp', 'P1002')]
    store.groups[0].activeTabId = store.groups[0].tabs[0].id
    store.workspacePathChanged('F:\\project', 'F:\\renamed')
    expect(store.groups[0].tabs.map(tab => tab.context?.path)).toEqual(['F:\\renamed\\a.cpp', 'F:\\renamed\\nested\\b.cpp', 'F:\\project-copy\\c.cpp'])
    expect(store.groups[0].tabs.map(tab => tab.context?.problemId)).toEqual(['P1596', 'P1001', 'P1002'])
    expect(store.groups[0].activeTabId).toBe(store.groups[0].tabs[0].id)
    expect(store.groups[0].tabs[0].title).toBe('a.cpp')
  })
})
