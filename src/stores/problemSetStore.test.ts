import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useProblemSetStore } from './problemSetStore'

const data = vi.hoisted(() => new Map<string, unknown>())
vi.mock('../dataCenter', () => ({
  getDataCenterValue: (key: string, fallback: unknown) => data.has(key) ? JSON.parse(JSON.stringify(data.get(key))) : fallback,
  saveDataCenterValue: vi.fn((key: string, value: unknown) => {
    data.set(key, JSON.parse(JSON.stringify(value)))
    return Promise.resolve()
  }),
}))
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))

beforeEach(() => {
  data.clear()
  setActivePinia(createPinia())
})

describe('problem set groups', () => {
  it('keeps legacy sets at the root and restores nested groups and membership', () => {
    data.set('problem-sets', [{ id: 'legacy', name: '旧题单', createdAt: 1, problems: [] }])
    const store = useProblemSetStore()
    expect(store.sets[0].parentId ?? null).toBeNull()
    const parent = store.createGroup('算法')!
    const child = store.createGroup('图论', parent)!
    expect(store.moveItem('legacy', child)).toBe(true)
    store.createSet('最短路', child)
    store.renameItem(child, '图算法')
    setActivePinia(createPinia())
    const restored = useProblemSetStore()
    expect(restored.groups.find(group => group.id === child)).toMatchObject({ name: '图算法', parentId: parent })
    expect(restored.sets.every(set => set.parentId === child)).toBe(true)
  })

  it('rejects cycles, self-parenting and missing destinations without changing data', () => {
    const store = useProblemSetStore()
    const parent = store.createGroup('父组')!
    const child = store.createGroup('子组', parent)!
    const grandchild = store.createGroup('孙组', child)!
    expect(store.moveItem(parent, parent)).toBe(false)
    expect(store.moveItem(parent, grandchild)).toBe(false)
    expect(store.moveItem(child, 'missing')).toBe(false)
    expect(store.moveItem('missing', null)).toBe(false)
    expect(store.groups.find(group => group.id === parent)?.parentId).toBeNull()
    expect(store.moveItem(grandchild, null)).toBe(true)
  })

  it('deleting a group preserves sets and subgroups by moving them to its parent', () => {
    const store = useProblemSetStore()
    const parent = store.createGroup('父组')!
    const child = store.createGroup('子组', parent)!
    const grandchild = store.createGroup('孙组', child)!
    store.createSet('题单', child)
    const set = store.activeSet!
    store.deleteGroup(child)
    expect(store.sets.find(item => item.id === set.id)?.parentId).toBe(parent)
    expect(store.groups.find(item => item.id === grandchild)?.parentId).toBe(parent)
    expect(store.groups.some(item => item.id === child)).toBe(false)
    expect(store.activeSet?.id).toBe(set.id)
  })

  it('reorders groups only within the same parent', () => {
    const store = useProblemSetStore()
    const a = store.createGroup('A')!
    const b = store.createGroup('B')!
    const c = store.createGroup('C', a)!
    store.reorderGroup(a, b)
    expect(store.groups.map(group => group.id)).toEqual([b, a, c])
    store.reorderGroup(c, b)
    expect(store.groups.map(group => group.id)).toEqual([b, a, c])
  })
})

describe('problem set text export', () => {
  it('exports every entry in order with Chinese names and canonical links for all platforms', () => {
    const store = useProblemSetStore()
    store.activeSet!.problems = [
      { platform: 'luogu', id: 'P1000', title: '超级玛丽游戏', tags: [], addedAt: 1 },
      { platform: 'codeforces', id: '977A', title: 'Wrong Subtraction', tags: [], addedAt: 1 },
      { platform: 'atcoder', id: 'abc001_1', title: '積雪深差', tags: [], addedAt: 1 },
      { platform: 'luogu', id: 'P1001', title: 'A+B', url: 'https://example.com/problem', tags: [], addedAt: 1 },
    ]
    expect(store.exportSetText()).toBe('超级玛丽游戏\r\nhttps://www.luogu.com.cn/problem/P1000\r\n\r\nWrong Subtraction\r\nhttps://codeforces.com/problemset/problem/977/A\r\n\r\n積雪深差\r\nhttps://atcoder.jp/contests/abc001/tasks/abc001_1\r\n\r\nA+B\r\nhttps://example.com/problem')
    expect(store.exportSetText('missing')).toBe('')
  })
})

describe('explicit insertion boundaries', () => {
  it('inserts groups before or after the target in both travel directions', () => {
    const store = useProblemSetStore()
    store.groups = ['a', 'b', 'c'].map(id => ({ id, name: id, parentId: null }))
    store.reorderGroup('a', 'c', 'before')
    expect(store.groups.map(item => item.id)).toEqual(['b', 'a', 'c'])
    store.reorderGroup('c', 'b', 'after')
    expect(store.groups.map(item => item.id)).toEqual(['b', 'c', 'a'])
    store.reorderGroup('a', 'c', 'after')
    expect(store.groups.map(item => item.id)).toEqual(['b', 'c', 'a'])
  })

  it('inserts sets exactly at the previewed boundary and persists the result', () => {
    const store = useProblemSetStore()
    store.sets = ['a', 'b', 'c'].map(id => ({ id, name: id, createdAt: 1, problems: [] }))
    store.reorderSet('a', 'c', 'before')
    expect(store.sets.map(item => item.id)).toEqual(['b', 'a', 'c'])
    store.reorderSet('c', 'b', 'after')
    expect(store.sets.map(item => item.id)).toEqual(['b', 'c', 'a'])
    store.reorderSet('a', 'b', 'before')
    expect(store.sets.map(item => item.id)).toEqual(['a', 'b', 'c'])
    expect((data.get('problem-sets') as { id: string }[]).map(item => item.id)).toEqual(['a', 'b', 'c'])
  })

  it('does not reorder sets in different groups', () => {
    const store = useProblemSetStore()
    store.sets = ['a', 'b'].map(id => ({ id, name: id, parentId: id, createdAt: 1, problems: [] }))
    store.reorderSet('a', 'b', 'after')
    expect(store.sets.map(item => item.id)).toEqual(['a', 'b'])
  })
})

describe('batch collection moves', () => {
  it('moves groups and sets together and keeps selected children in their selected parent', () => {
    const store = useProblemSetStore()
    store.groups = [{ id: 'parent', name: '父组', parentId: null }, { id: 'target', name: '目标', parentId: null }]
    store.sets = [{ id: 'child', name: '子题单', parentId: 'parent', createdAt: 1, problems: [] }, { id: 'set', name: '题单', createdAt: 1, problems: [] }]
    expect(store.moveItems(['parent', 'child', 'set'], 'target')).toBe(true)
    expect(store.groups[0].parentId).toBe('target')
    expect(store.sets.map(item => item.parentId)).toEqual(['parent', 'target'])
  })
  it('rejects an invalid batch before moving any item', () => {
    const store = useProblemSetStore()
    store.groups = [{ id: 'parent', name: '父组', parentId: null }, { id: 'child', name: '子组', parentId: 'parent' }]
    const set = store.activeSet!
    expect(store.moveItems([set.id, 'parent'], 'child')).toBe(false)
    expect(set.parentId ?? null).toBeNull()
    expect(store.groups[0].parentId).toBeNull()
  })
  it('reorders a selected block in display order regardless of selection order', () => {
    const store = useProblemSetStore()
    store.sets = ['a', 'b', 'c', 'd'].map(id => ({ id, name: id, createdAt: 1, problems: [] }))
    expect(store.reorderItems(['c', 'a'], 'd', 'after')).toBe(true)
    expect(store.sets.map(item => item.id)).toEqual(['b', 'd', 'a', 'c'])
    expect(store.reorderItems(['a', 'c'], 'a', 'before')).toBe(false)
    expect(store.reorderItems(['c', 'a'], 'b', 'before')).toBe(true)
    expect(store.sets.map(item => item.id)).toEqual(['a', 'c', 'b', 'd'])
  })
})
