import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useProblemStore } from './problemStore'
import { useWorkbenchStore } from './workbenchStore'
import type { Problem } from '../types'

const mocks = vi.hoisted(() => ({invoke: vi.fn()}))
vi.mock('@tauri-apps/api/core', () => ({invoke: mocks.invoke}))
vi.mock('../diagnostics', () => ({ withOjDiagnostic: (_platform: string, _operation: string, task: () => Promise<unknown>) => task() }))
vi.mock('../dataCenter', () => ({getDataCenterValue: (_key: string, fallback: unknown) => fallback, saveDataCenterValue: vi.fn(async () => {})}))
vi.mock('./settingsStore', () => ({useSettingsStore: () => ({codeTemplates:{cpp:'// template',python:'# template',java:'// template'}})}))

const problem: Problem = {platform:'luogu', id:'P1596', title:'Lake Counting', tags:[], description:'statement', contentFormat:'markdown'}
beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
  mocks.invoke.mockImplementation(async command => command === 'load_problem_draft' ? null : command === 'save_draft' ? 'F:\\data-center\\solutions\\P1596.cpp' : undefined)
  setActivePinia(createPinia())
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

describe('problem draft creation workflow', () => {
  it('activates an already opened code tab without showing a loading placeholder', async () => {
    const workbench = useWorkbenchStore()
    const store = useProblemStore()
    const file = (name: string) => ({ platform: 'local' as const, problemId: name, title: name, language: 'cpp' as const, path: `F:/project/${name}.cpp`, createdAt: 0, unbound: true, statementMarkdown: '' })
    mocks.invoke.mockImplementation(async (command, args) => command === 'read_workspace_file' ? args.path : undefined)
    await workbench.openDraftFile(file('a'))
    await workbench.openDraftFile(file('b'))
    const tab = workbench.groups[0].tabs[0]!
    const activation = workbench.activateTab('group-1', tab.id)
    expect(tab.loading).toBe(false)
    expect(store.currentCode).toBe('F:/project/a.cpp')
    await activation
    await workbench.openDraftFile(file('b'))
    expect(workbench.groups[0].tabs).toHaveLength(2)
    expect(store.currentCode).toBe('F:/project/b.cpp')
  })

  it('switches loaded files synchronously, preserving code, tests and breakpoints while checking disk in the background', async () => {
    const store = useProblemStore()
    const file = (name: string) => ({ platform: 'local' as const, problemId: name, title: name, language: 'cpp' as const, path: `F:/project/${name}.cpp`, createdAt: 0, unbound: true, statementMarkdown: '' })
    mocks.invoke.mockImplementation(async (command, args) => command === 'read_workspace_file' ? `code:${args.path}` : undefined)
    await store.openDraftFile(file('a'))
    store.breakpoints = [3]
    store.testCases[0]!.input = 'test input'
    await store.openDraftFile(file('b'))
    expect(store.tryActivateCachedWorkspace({ platform: 'local', problemId: 'a', language: 'cpp', path: 'F:/project/a.cpp' })).toBe(true)
    expect(store.currentCode).toBe('code:F:/project/a.cpp')
    expect(store.breakpoints).toEqual([3])
    expect(store.testCases[0]!.input).toBe('test input')
    expect(store.draftPath).toBe('F:/project/a.cpp')
    await Promise.resolve()
  })

  it('does not block a cached switch on saving and never applies an old save to the new file', async () => {
    const store = useProblemStore()
    const file = (name: string) => ({ platform: 'local' as const, problemId: name, title: name, language: 'cpp' as const, path: `F:/project/${name}.cpp`, createdAt: 0, unbound: true, statementMarkdown: '' })
    mocks.invoke.mockImplementation(async (command, args) => command === 'read_workspace_file' ? `code:${args.path}` : undefined)
    await store.openDraftFile(file('a'))
    await store.openDraftFile(file('b'))
    store.updateCode('edited b')
    let finish!: () => void
    mocks.invoke.mockImplementation((command, args) => command === 'save_workspace_file' ? new Promise<void>(resolve => { finish = resolve }) : Promise.resolve(`code:${args.path}`))
    expect(store.tryActivateCachedWorkspace({ platform: 'local', problemId: 'a', language: 'cpp', path: 'F:/project/a.cpp' })).toBe(true)
    expect(store.currentCode).toBe('code:F:/project/a.cpp')
    store.updateCode('edited a')
    finish()
    await Promise.resolve()
    await Promise.resolve()
    expect(store.currentCode).toBe('edited a')
    expect(store.draftPath).toBe('F:/project/a.cpp')
    expect(store.draftDirty).toBe(true)
    expect(mocks.invoke).toHaveBeenCalledWith('save_workspace_file', { path: 'F:/project/b.cpp', code: 'edited b' })
  })

  it('updates clean cached code after an external disk change without blocking the initial display', async () => {
    const store = useProblemStore()
    const file = (name: string) => ({ platform: 'local' as const, problemId: name, title: name, language: 'cpp' as const, path: `F:/project/${name}.cpp`, createdAt: 0, unbound: true, statementMarkdown: '' })
    mocks.invoke.mockResolvedValue('before')
    await store.openDraftFile(file('a'))
    await store.openDraftFile(file('b'))
    mocks.invoke.mockResolvedValue('external edit')
    store.tryActivateCachedWorkspace({ platform: 'local', problemId: 'a', language: 'cpp', path: 'F:/project/a.cpp' })
    expect(store.currentCode).toBe('before')
    await Promise.resolve()
    expect(store.currentCode).toBe('external edit')
  })

  it.each(['codeforces', 'atcoder', 'luogu'] as const)('preserves the open statement and draft when browsing the %s catalog', async platform => {
    const store = useProblemStore()
    await store.selectProblem({...problem})
    store.currentPlatform = 'luogu'
    store.problems = [problem, {platform:'codeforces',id:'1A',title:'Theatre Square',tags:[]}, {platform:'atcoder',id:'abc001_a',title:'A',tags:[]}]
    store.updateCode('int main() {return 0;}')
    const opened = store.currentProblem
    await store.setPlatform(platform)
    expect(store.currentPlatform).toBe(platform)
    expect(store.currentProblem).toBe(opened)
    expect(store.currentProblem?.description).toBe('statement')
    expect(store.currentCode).toBe('int main() {return 0;}')
    await vi.advanceTimersByTimeAsync(500)
    expect(mocks.invoke).toHaveBeenCalledWith('save_draft', {platform:'luogu',problemId:'P1596',problemTitle:'Lake Counting',language:'cpp',code:'int main() {return 0;}'})
  })

  it('only shows a template when opening an unsaved problem, then creates on the first edit', async () => {
    const store = useProblemStore()
    await store.selectProblem({...problem})
    expect(store.currentCode).toBe('// template')
    expect(store.draftPath).toBe('')
    await store.persistDraft()
    expect(mocks.invoke.mock.calls.some(([command]) => command === 'save_draft')).toBe(false)
    store.updateCode('int main() {}')
    await vi.advanceTimersByTimeAsync(500)
    expect(mocks.invoke).toHaveBeenCalledWith('save_draft', {platform:'luogu',problemId:'P1596',problemTitle:'Lake Counting',language:'cpp',code:'int main() {}'})
    expect(store.draftPath).toBe('F:\\data-center\\solutions\\P1596.cpp')
    store.updateCode('int main() {return 0;}')
    await vi.advanceTimersByTimeAsync(500)
    expect(mocks.invoke).toHaveBeenCalledWith('save_workspace_file', {path:store.draftPath,code:'int main() {return 0;}'})
    expect(mocks.invoke.mock.calls.filter(([command]) => command === 'save_draft')).toHaveLength(1)
  })
  it.each(['int main() {}', ''])('reuses a renamed external bound file, including an empty saved file', async code => {
    const path = 'D:\\external-project\\renamed.cpp'
    mocks.invoke.mockImplementation(async command => command === 'load_problem_draft' ? {path,code} : undefined)
    const store = useProblemStore()
    await store.selectProblem({...problem})
    expect(store.currentCode).toBe(code)
    expect(store.draftPath).toBe(path)
    expect(store.draftSaveStatus).toBe('saved')
    store.updateCode('edited')
    await vi.advanceTimersByTimeAsync(500)
    expect(mocks.invoke).toHaveBeenCalledWith('save_workspace_file', {path,code:'edited'})
    expect(mocks.invoke.mock.calls.some(([command]) => command === 'save_draft')).toBe(false)
  })
  it('does not create files when switching between untouched problems', async () => {
    const store = useProblemStore()
    await store.selectProblem({...problem})
    await store.selectProblem({...problem,id:'P1000'})
    await vi.advanceTimersByTimeAsync(1000)
    expect(mocks.invoke.mock.calls.some(([command]) => command === 'save_draft' || command === 'save_workspace_file')).toBe(false)
  })
})


describe('code-first navigation', () => {
  function frames() {
    const callbacks = new Map<number, FrameRequestCallback>()
    let id = 0
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callbacks.set(++id, callback); return id })
    vi.stubGlobal('cancelAnimationFrame', (frame: number) => callbacks.delete(frame))
    return async () => {
      const pending = [...callbacks.values()]
      callbacks.clear()
      pending.forEach(callback => callback(16))
      await vi.advanceTimersByTimeAsync(0)
    }
  }
  it('shows code before restoring tests or requesting the remote statement', async () => {
    const paint = frames()
    const store = useProblemStore()
    const target: Problem = { ...problem, description: undefined, samples: [{ input: '1', output: '2' }] }
    let finish!: (value: Problem) => void
    mocks.invoke.mockImplementation((command: string) => command === 'load_problem_draft'
      ? Promise.resolve({ path: 'F:/a.cpp', code: 'loaded code' })
      : command === 'import_problem_url' ? new Promise<Problem>(resolve => { finish = resolve }) : Promise.resolve())
    await store.selectProblem(target, { waitForDetail: false })
    expect(store.currentCode).toBe('loaded code')
    expect(store.isLoadingTests).toBe(true)
    expect(store.testCases).toEqual([])
    expect(mocks.invoke.mock.calls.some(([command]) => command === 'import_problem_url')).toBe(false)
    await paint()
    expect(store.testCases[0]?.input).toBe('1')
    expect(store.isLoadingTests).toBe(false)
    expect(store.isLoadingDetail).toBe(true)
    finish({ ...target, description: 'downloaded statement', contentFormat: 'markdown' })
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve()
    expect(store.currentProblem?.description).toBe('downloaded statement')
  })
  it('cancels stale restoration and requests when switching again before the first paint', async () => {
    const paint = frames()
    const store = useProblemStore()
    mocks.invoke.mockImplementation(async (command: string, args) => command === 'import_problem_url'
      ? { ...problem, id: args.url.split('/').pop(), description: 'downloaded' } : null)
    await store.selectProblem({ ...problem, id: 'P1000', description: undefined, samples: [{ input: 'old', output: '' }] }, { waitForDetail: false })
    await store.selectProblem({ ...problem, id: 'P1001', description: undefined, samples: [{ input: 'new', output: '' }] }, { waitForDetail: false })
    await paint()
    expect(store.currentProblem?.id).toBe('P1001')
    expect(store.testCases[0]?.input).toBe('new')
    const requests = mocks.invoke.mock.calls.filter(([command]) => command === 'import_problem_url')
    expect(requests).toHaveLength(1)
    expect(requests[0]?.[1].url).toContain('P1001')
  })
  it('restores cached edits instead of replacing them with delayed sample data', async () => {
    const paint = frames()
    const store = useProblemStore()
    await store.selectProblem({ ...problem }, { waitForDetail: false })
    await paint()
    store.testCases[0]!.input = 'edited sample'
    await store.selectProblem({ ...problem, id: 'P1000' }, { waitForDetail: false })
    expect(store.tryActivateCachedWorkspace({ platform: 'luogu', problemId: 'P1596', language: 'cpp' })).toBe(true)
    await paint()
    expect(store.currentProblem?.id).toBe('P1596')
    expect(store.testCases[0]?.input).toBe('edited sample')
    expect(store.isLoadingTests).toBe(false)
  })
  it('opens a different uncached file while the old file save is still pending', async () => {
    const store = useProblemStore()
    const file = (name: string) => ({ platform: 'local' as const, problemId: name, title: name, language: 'cpp' as const, path: `F:/project/${name}.cpp`, createdAt: 0, unbound: true, statementMarkdown: '' })
    mocks.invoke.mockImplementation(async (command, args) => command === 'read_workspace_file' ? args.path : undefined)
    await store.openDraftFile(file('a'))
    store.updateCode('edited a')
    let finish!: () => void
    mocks.invoke.mockImplementation((command, args) => command === 'save_workspace_file'
      ? new Promise<void>(resolve => { finish = resolve }) : Promise.resolve(args.path))
    await store.openDraftFile(file('b'))
    expect(store.currentCode).toBe('F:/project/b.cpp')
    expect(mocks.invoke).toHaveBeenCalledWith('save_workspace_file', { path: 'F:/project/a.cpp', code: 'edited a' })
    finish()
    await Promise.resolve(); await Promise.resolve()
    expect(store.draftPath).toBe('F:/project/b.cpp')
  })
})
