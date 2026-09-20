import { describe, expect, it } from 'vitest'
import { normalizeWorkbenchState } from './workbenchStore'

describe('workbench persisted state', () => {
  it('falls back safely when persisted data is invalid', () => {
    const state = normalizeWorkbenchState({ version: 9, groups: 'broken' })
    expect(state.groups).toHaveLength(1)
    expect(state.groups[0].id).toBe('group-1')
    expect(state.activity).toBe('problems')
  })

  it('restores multiple non-empty groups and repairs bounds, layout, and active tabs', () => {
    const tab = { id: 'code:problem:codeforces:1A:cpp', kind: 'code', title: 'A.cpp' }
    const state = normalizeWorkbenchState({
      version: 1,
      activity: 'tests',
      sidebarVisible: false,
      sidebarWidth: 9999,
      splitRatio: 4,
      activeGroupId: 'missing',
      groups: [
        { id: 'left', tabs: [tab], activeTabId: 'missing' },
        { id: 'right', tabs: [], activeTabId: null },
        { id: 'ignored', tabs: [tab], activeTabId: tab.id },
      ],
    })
    expect(state.groups).toHaveLength(2)
    expect(state.groups[0].activeTabId).toBe(tab.id)
    expect(state.groups[1].id).toBe('ignored')
    expect(state.activeGroupId).toBe('left')
    expect(state.sidebarWidth).toBe(520)
    expect(state.splitRatio).toBe(25)
    expect(state.activity).toBe('runner')
    expect(state.runnerTool).toBe('tests')
    expect(state.sidebarVisible).toBe(false)
    expect(state.layoutTree.type).toBe('split')
  })

  it('migrates the retired submission editor tab to the left-side tool layout', () => {
    const state = normalizeWorkbenchState({
      version: 1,
      activity: 'submission',
      groups: [{ id: 'group-1', tabs: [
        { id: 'following:submission', kind: 'submission', title: '提交与调试' },
        { id: 'code:problem:codeforces:1A:cpp', kind: 'code', title: '1A.cpp' },
      ], activeTabId: 'following:submission' }],
    })
    expect(state.activity).toBe('runner')
    expect(state.runnerTool).toBe('submission')
    expect(state.groups[0].tabs.map(tab => tab.kind)).toEqual(['code'])
    expect(state.groups[0].activeTabId).toBe('code:problem:codeforces:1A:cpp')
  })

  it('does not restore retired placeholder sidebars for editor actions', () => {
    for (const activity of ['learning', 'ai', 'notes']) {
      expect(normalizeWorkbenchState({ version: 1, activity, groups: [{ id: 'group-1', tabs: [], activeTabId: null }] }).activity).toBe('problems')
    }
  })

  it('drops the retired Luogu solution reader tab', () => {
    const solution = { id: 'following:solution', kind: 'solution', title: 'P1001 · 题解' }
    const state = normalizeWorkbenchState({
      version: 1,
      activity: 'problems',
      groups: [{ id: 'group-1', tabs: [solution], activeTabId: solution.id }],
    })
    expect(state.groups[0].tabs).toEqual([])
    expect(state.groups[0].activeTabId).toBeNull()
  })
})
