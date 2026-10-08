import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useWorkbenchStore, companionTabTitle, normalizeWorkbenchState, type WorkbenchTab } from './workbenchStore'

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


describe('companion tab file names', () => {
  const context = { kind: 'local-file' as const, contextId: 'file:cat', platform: 'local' as const, problemId: 'local_hidden_id', title: 'old title', language: 'cpp' as const, path: 'F:/project/小猫爬山.cpp' }
  it('uses the actual file name instead of an internal local identifier', () => {
    expect(companionTabTitle(context, 'statement')).toBe('小猫爬山.cpp · 题面')
    expect(companionTabTitle({ ...context, path: 'F:\\project\\小猫爬山.cpp' }, 'ai')).toBe('小猫爬山.cpp · AI')
    expect(companionTabTitle({ ...context, path: undefined, title: 'Lake Counting', language: 'python' }, 'ai')).toBe('Lake Counting.py · AI')
  })
  it('updates AI and statement tabs after renaming without changing problem identity', () => {
    const store = useWorkbenchStore()
    store.groups[0]!.tabs = ['statement', 'ai'].map(kind => ({ id: `following:${kind}`, kind: kind as 'statement' | 'ai', title: 'old', context: { ...context } }))
    store.workspacePathChanged(context.path, 'F:/project/新名字.cpp')
    expect(store.groups[0]!.tabs.map(tab => tab.title)).toEqual(['新名字.cpp · 题面', '新名字.cpp · AI'])
    expect(store.groups[0]!.tabs.every(tab => tab.context?.problemId === 'local_hidden_id')).toBe(true)
  })
  it('refreshes titles in previously saved workspaces', () => {
    const state = normalizeWorkbenchState({ version: 1, groups: [{ id: 'group-1', activeTabId: 'following:ai', tabs: [
      { id: 'following:ai', kind: 'ai', title: 'local_hidden_id · AI', context },
      { id: 'following:statement', kind: 'statement', title: 'local_hidden_id · 题面', context },
    ] }] })
    expect(state.groups[0]!.tabs.map(tab => tab.title)).toEqual(['小猫爬山.cpp · AI', '小猫爬山.cpp · 题面'])
  })
})
