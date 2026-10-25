import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useProblemSetStore } from './problemSetStore'
import { useProblemStore } from './problemStore'
import { invoke } from '@tauri-apps/api/core'

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
  vi.mocked(invoke).mockReset()
  data.clear()
  setActivePinia(createPinia())
})

describe('batch input validation', () => {
  it('rejects malformed ids even with the ±1 problem in the local library', async () => {
    useProblemStore().problems = [{ platform: 'codeforces', id: '1971H', title: '±1', tags: [] }]
    const store = useProblemSetStore()
    const result = await store.addProblemsBatch('PG1000\nl100')
    expect(result).toMatchObject({ added: 0, failed: ['PG1000', 'l100'] })
    expect(store.activeSet?.problems).toEqual([])
    expect(invoke).not.toHaveBeenCalled()
  })

  it('does not add a single unrelated search result as a title match', async () => {
    vi.mocked(invoke).mockResolvedValue({ problems: [{ platform: 'luogu', id: 'P1000', title: '超级玛丽游戏', tags: [] }] })
    const store = useProblemSetStore()
    const result = await store.addProblemsBatch('不存在的题目')
    expect(result).toMatchObject({ added: 0, failed: ['不存在的题目'] })
    expect(store.activeSet?.problems).toEqual([])
  })

  it('reuses one catalog index for multiple ids in a large local library', async () => {
    let idReads = 0
    useProblemStore().problems = Array.from({ length: 20000 }, (_, index) => ({
      platform: 'codeforces' as const,
      get id() { idReads++; return `${index + 1}A` },
      title: `Problem ${index + 1}`,
      tags: [],
    }))
    const store = useProblemSetStore()
    const result = await store.addProblemsBatch('19997A\n19998A\n19999A\n20000A')
    expect(result).toMatchObject({ added: 4, failed: [] })
    expect(idReads).toBeLessThan(20100)
    expect(invoke).not.toHaveBeenCalled()
  })

  it('never fetches malformed entries and reports fetch failures alongside validation failures', async () => {
    vi.mocked(invoke).mockImplementation(async (_command, args) => {
      const url = (args as { url: string }).url
      if (url.includes('P1001')) throw new Error('题目不存在')
      return { id: '14687', title: 'Grand Voting', platform: 'qoj', tags: [], url } as never
    })
    const store = useProblemSetStore()
    const result = await store.addProblemsBatch('CF-977A??\nQOJ-14687\nP1001\n1234')
    expect(invoke).toHaveBeenCalledTimes(2)
    expect(invoke).toHaveBeenCalledWith('import_problem_url', { url: 'https://qoj.ac/problem/14687' })
    expect(result).toMatchObject({ total: 4, added: 1, duplicates: 0, failed: ['CF-977A??', 'P1001', '1234'] })
    expect(result.failures.map(item => item.line)).toEqual([1, 3, 4])
    expect(result.failures[1].reason).toContain('题目不存在')
    expect(store.activeSet?.problems.some(item => item.id === '14687')).toBe(true)
  })

  it('returns failures for an entirely invalid batch without issuing requests', async () => {
    const result = await useProblemSetStore().addProblemsBatch('CF-P1000\nhttps://qoj.ac/profile/user')
    expect(result).toMatchObject({ total: 2, added: 0, duplicates: 0 })
    expect(result.failed).toHaveLength(2)
    expect(invoke).not.toHaveBeenCalled()
  })
})

describe('contest imports', () => {
  it('persists QOJ team counts including zero accepted teams', () => {
    const store = useProblemSetStore()
    const result = store.importContest({ platform: 'qoj', contestId: '1096', title: 'Finals', url: 'https://qoj.ac/contest/1096' }, [
      { platform: 'qoj', id: '14719', title: 'Planting Trees', tags: [], acceptedTeams: 0, submittedTeams: 153 },
    ])
    expect(result.set.problems[0]).toMatchObject({ acceptedTeams: 0, submittedTeams: 153 })
    setActivePinia(createPinia())
    expect(useProblemSetStore().sets.find(set => set.id === result.set.id)?.problems[0]).toMatchObject({ acceptedTeams: 0, submittedTeams: 153 })
  })

  it('backfills legacy QOJ contest counts from the archive without fetching statements', async () => {
    const store = useProblemSetStore()
    const result = store.importContest({ platform: 'qoj', contestId: '1096', title: 'Finals', url: 'https://qoj.ac/contest/1096' }, [
      { platform: 'qoj', id: '14719', title: 'Planting Trees', tags: [] },
    ])
    vi.mocked(invoke).mockResolvedValue({ entries: [{ kind: 'contest', id: '1096', problems: [
      { id: '14719', title: 'Planting Trees', url: 'https://qoj.ac/problem/14719', acceptedTeams: 76, submittedTeams: 153 },
    ] }] })
    await store.enrichSetMetadata(result.set.id, { fetchMissing: false })
    expect(result.set.problems[0]).toMatchObject({ acceptedTeams: 76, submittedTeams: 153 })
    expect(vi.mocked(invoke).mock.calls.filter(([command]) => command === 'fetch_qoj_archive')).toHaveLength(1)
    expect(vi.mocked(invoke).mock.calls.some(([command]) => command === 'import_problem_url')).toBe(false)
    expect(invoke).toHaveBeenCalledWith('fetch_qoj_archive', { url: 'https://qoj.ac/contest/1096' })
    await store.enrichSetMetadata(result.set.id, { fetchMissing: false })
    expect(vi.mocked(invoke).mock.calls.filter(([command]) => command === 'fetch_qoj_archive')).toHaveLength(1)
    setActivePinia(createPinia())
    expect(useProblemSetStore().sets.find(set => set.id === result.set.id)?.problems[0]).toMatchObject({ acceptedTeams: 76, submittedTeams: 153 })
  })

  it('imports QOJ archive rows with original titles and links and deduplicates contests', () => {
    const store = useProblemSetStore()
    const contest = { platform: 'qoj' as const, contestId: '1096', title: 'ICPC Finals', url: 'https://qoj.ac/contest/1096' }
    const rows = [{ id: '14687', title: 'Grand Voting', url: 'https://qoj.ac/contest/1096/problem/14687', platform: 'qoj' as const, tags: [] }]
    const result = store.importContest(contest, rows)
    expect(result.set.problems[0]).toMatchObject(rows[0])
    expect(store.importContest(contest, rows).added).toBe(false)
    setActivePinia(createPinia())
    expect(useProblemSetStore().containsContest('qoj', '1096')).toBe(true)
  })
  it('imports every problem into one ordinary set and prevents duplicate contests', () => {
    const store = useProblemSetStore()
    const contest = { platform: 'codeforces' as const, contestId: 'contest:123', title: 'Round 123', url: 'https://codeforces.com/contest/123' }
    const problems = ['123A', '123B'].map(id => ({ id, title: id, platform: 'codeforces' as const, tags: [] }))
    const activeBefore = store.activeSetId
    const result = store.importContest(contest, [...problems, problems[0]])
    expect(result.set.problems.map(p => p.id)).toEqual(['123A', '123B'])
    expect(store.activeSetId).toBe(activeBefore)
    expect(store.containsContest('codeforces', '123')).toBe(true)
    expect(store.importContest({ ...contest, contestId: '123' }, problems).added).toBe(false)
    setActivePinia(createPinia())
    expect(useProblemSetStore().containsContest('codeforces', '123')).toBe(true)
  })
  it('does not create an empty set after a failed contest read', () => {
    const store = useProblemSetStore()
    const count = store.sets.length
    expect(() => store.importContest({ platform: 'atcoder', contestId: 'abc1', title: 'ABC 1', url: 'https://atcoder.jp/contests/abc1' }, [])).toThrow()
    expect(store.sets.length).toBe(count)
  })
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

describe('problem ordering in a set', () => {
  it('moves at the requested boundary, preserves other entries and restores saved order', () => {
    const store = useProblemSetStore()
    const set = store.activeSet!
    set.problems = ['P1000', 'P1001', 'P1002', 'P1003'].map(id => ({ platform: 'luogu', id, title: id, tags: [], addedAt: 1 }))
    expect(store.reorderProblem(set.id, 'luogu:P1000', 'luogu:P1003', 'before')).toBe(true)
    expect(set.problems.map(problem => problem.id)).toEqual(['P1001', 'P1002', 'P1000', 'P1003'])
    expect(store.reorderProblem(set.id, 'luogu:P1003', 'luogu:P1001', 'after')).toBe(true)
    expect(set.problems.map(problem => problem.id)).toEqual(['P1001', 'P1003', 'P1002', 'P1000'])
    setActivePinia(createPinia())
    expect(useProblemSetStore().activeSet!.problems.map(problem => problem.id)).toEqual(['P1001', 'P1003', 'P1002', 'P1000'])
  })
  it('distinguishes platforms and rejects invalid moves without dropping entries', () => {
    const store = useProblemSetStore()
    const set = store.activeSet!
    set.problems = [
      { platform: 'luogu', id: 'A', title: '洛谷 A', tags: [], addedAt: 1 },
      { platform: 'codeforces', id: 'A', title: 'CF A', tags: [], addedAt: 2 },
      { platform: 'luogu', id: 'B', title: 'B', tags: [], addedAt: 3 },
    ]
    expect(store.reorderProblem(set.id, 'codeforces:A', 'luogu:B', 'after')).toBe(true)
    expect(set.problems.map(problem => `${problem.platform}:${problem.id}`)).toEqual(['luogu:A', 'luogu:B', 'codeforces:A'])
    const before = JSON.stringify(set.problems)
    expect(store.reorderProblem(set.id, 'luogu:A', 'missing', 'before')).toBe(false)
    expect(store.reorderProblem(set.id, 'luogu:A', 'luogu:A', 'after')).toBe(false)
    expect(store.reorderProblem('missing', 'luogu:A', 'luogu:B', 'after')).toBe(false)
    expect(JSON.stringify(set.problems)).toBe(before)
    expect(store.exportSetEntries().map(problem => problem.title)).toEqual(['A 洛谷 A', 'B B', 'A CF A'])
  })
})
