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


describe('tab sorting', () => {
  it('moves the first tab all the way to the end and back to the beginning', () => {
    const store = useWorkbenchStore()
    const group = store.groups[0]!
    group.tabs = ['a', 'b', 'c', 'd'].map(id => ({ id, kind: 'text', title: id, path: `F:/${id}.txt` }))
    group.activeTabId = 'a'
    store.moveTab(group.id, 'a', group.id, 'center', 4)
    expect(group.tabs.map(tab => tab.id)).toEqual(['b', 'c', 'd', 'a'])
    expect(group.activeTabId).toBe('a')
    store.moveTab(group.id, 'a', group.id, 'center', 0)
    expect(group.tabs.map(tab => tab.id)).toEqual(['a', 'b', 'c', 'd'])
  })
  it('keeps the same position when dropped on either half of itself', () => {
    const store = useWorkbenchStore()
    const group = store.groups[0]!
    group.tabs = ['a', 'b', 'c'].map(id => ({ id, kind: 'text', title: id }))
    store.moveTab(group.id, 'b', group.id, 'center', 1)
    expect(group.tabs.map(tab => tab.id)).toEqual(['a', 'b', 'c'])
    store.moveTab(group.id, 'b', group.id, 'center', 2)
    expect(group.tabs.map(tab => tab.id)).toEqual(['a', 'b', 'c'])
  })
})
