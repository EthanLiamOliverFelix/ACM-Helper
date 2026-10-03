import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useProblemStore } from './problemStore'
import type { Problem } from '../types'

const mocks = vi.hoisted(() => ({invoke: vi.fn()}))
vi.mock('@tauri-apps/api/core', () => ({invoke: mocks.invoke}))
vi.mock('../dataCenter', () => ({getDataCenterValue: (_key: string, fallback: unknown) => fallback, saveDataCenterValue: vi.fn(async () => {})}))
vi.mock('./settingsStore', () => ({useSettingsStore: () => ({codeTemplates:{cpp:'// template',python:'# template',java:'// template'}})}))

const problem: Problem = {platform:'luogu', id:'P1596', title:'Lake Counting', tags:[], description:'statement', contentFormat:'markdown'}
beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
  mocks.invoke.mockImplementation(async command => command === 'load_problem_draft' ? null : command === 'save_draft' ? 'F:\\data-center\\solutions\\P1596.cpp' : undefined)
  setActivePinia(createPinia())
})
afterEach(() => vi.useRealTimers())

describe('problem draft creation workflow', () => {
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
