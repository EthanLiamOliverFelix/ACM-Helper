import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { watchEffect, nextTick } from 'vue'
import { useProblemStore } from './problemStore'
import type { LuoguRecordDetail } from '../types'

const mocks = vi.hoisted(() => ({invoke:vi.fn(),accepted:vi.fn()}))
vi.mock('@tauri-apps/api/core', () => ({invoke:mocks.invoke}))
vi.mock('../dataCenter', () => ({getDataCenterValue: (_key: string, fallback: unknown) => fallback, saveDataCenterValue: vi.fn(async () => {})}))
vi.mock('../diagnostics', () => ({withOjDiagnostic: (_platform: string, _operation: string, task: () => Promise<unknown>) => task()}))
vi.mock('./settingsStore', () => ({useSettingsStore: () => ({luoguCppLanguageId:34,luoguPythonLanguageId:25,luoguEnableO2:false})}))
vi.mock('./learningStore', () => ({useLearningStore: () => ({recordAccepted:mocks.accepted})}))

const detail = (status: number): LuoguRecordDetail => ({recordId:123,problemId:'P1001',problemTitle:'A+B',status,subtasks:[],score:status === 12 ? 100 : 0,timeMs:5,memoryBytes:1024})
beforeEach(() => {
  vi.clearAllMocks()
  mocks.invoke.mockResolvedValue(undefined)
  mocks.accepted.mockResolvedValue(undefined)
  setActivePinia(createPinia())
})
afterEach(() => vi.useRealTimers())
function readyStore() {
  const store = useProblemStore()
  store.currentProblem = {platform:'luogu',id:'P1001',title:'A+B',tags:[]}
  store.currentCode = 'int main() {}'
  return store
}

describe('Luogu submission lifecycle', () => {
  it('notifies reactive consumers when a newly created submission finishes', async () => {
    mocks.invoke.mockImplementation(async command => command === 'submit_luogu' ? JSON.stringify({rid:123,status:'AC',score:100}) : undefined)
    const store = readyStore()
    const seen: string[] = []
    const stop = watchEffect(() => { seen.push(store.submissions[0]?.status ?? 'empty') })
    await store.submitLuogu()
    await nextTick()
    stop()
    expect(seen).toContain('Pending')
    expect(seen[seen.length - 1]).toBe('Accepted')
    expect(store.isSubmitting).toBe(false)
    expect(store.submissions[0].remoteId).toBe(123)
  })

  it('recovers a missed final callback from record details including AC without test cases', async () => {
    mocks.invoke.mockImplementation(async command => {
      if (command === 'submit_luogu') return JSON.stringify({rid:123,pending:true})
      if (command === 'fetch_luogu_record_detail') return JSON.stringify(detail(12))
    })
    const store = readyStore()
    await store.submitLuogu()
    expect(store.submissions[0]).toMatchObject({remoteId:123,status:'Accepted',score:100,timeMs:5,memoryBytes:1024})
    expect(store.submissions[0].message).toBeUndefined()
    expect(store.isSubmitting).toBe(false)
    expect(mocks.accepted).toHaveBeenCalledWith('luogu:P1001',[])
  })

  it('ends repeated waiting results with a recoverable record id and never submits code twice', async () => {
    vi.useFakeTimers()
    mocks.invoke.mockImplementation(async command => {
      if (command === 'submit_luogu') return JSON.stringify({rid:123,status:'WJ'})
      if (command === 'fetch_luogu_record_detail') return JSON.stringify(detail(0))
    })
    const store = readyStore()
    const task = store.submitLuogu()
    await vi.runAllTimersAsync()
    await task
    expect(store.submissions[0]).toMatchObject({remoteId:123,status:'Interrupted'})
    expect(store.isSubmitting).toBe(false)
    expect(mocks.invoke.mock.calls.filter(([command]) => command === 'submit_luogu')).toHaveLength(1)
    expect(mocks.invoke.mock.calls.filter(([command]) => command === 'fetch_luogu_record_detail')).toHaveLength(3)
    mocks.invoke.mockImplementation(async command => command === 'fetch_luogu_record_detail' ? JSON.stringify(detail(12)) : undefined)
    await store.fetchLuoguRecordDetail(store.submissions[0])
    expect(store.submissions[0].status).toBe('Accepted')
    expect(store.submissions[0].message).toBeUndefined()
    expect(store.lastSubmitError).toBeNull()
  })

  it('retries a transient record read failure and then completes the submission', async () => {
    vi.useFakeTimers()
    let reads = 0
    mocks.invoke.mockImplementation(async command => {
      if (command === 'submit_luogu') return JSON.stringify({rid:123,pending:true})
      if (command === 'fetch_luogu_record_detail') {
        if (++reads === 1) throw new Error('temporary network error')
        return JSON.stringify(detail(2))
      }
    })
    const store = readyStore()
    const task = store.submitLuogu()
    await vi.runAllTimersAsync()
    await task
    expect(store.submissions[0].status).toBe('Compilation Error')
    expect(store.isSubmitting).toBe(false)
    expect(reads).toBe(2)
  })

  it('does not overwrite a submission with a different record id', async () => {
    const store = readyStore()
    store.submissions = [{id:'local',platform:'luogu',problemId:'P1001',language:'cpp',timestamp:1,remoteId:123,status:'Running'}]
    mocks.invoke.mockResolvedValue(JSON.stringify({...detail(12),recordId:124}))
    await expect(store.fetchLuoguRecordDetail(store.submissions[0])).rejects.toThrow('记录号不匹配')
    expect(store.submissions[0].status).toBe('Running')
  })
  it('keeps querying an unfinished compile result until the actual AC arrives', async () => {
    vi.useFakeTimers()
    let reads = 0
    mocks.invoke.mockImplementation(async command => {
      if (command === 'submit_luogu') return JSON.stringify({rid:123,pending:true})
      if (command === 'fetch_luogu_record_detail') {
        const result = detail(++reads === 1 ? 1 : 12)
        return JSON.stringify({...result,compileSuccess:false})
      }
    })
    const store = readyStore()
    const task = store.submitLuogu()
    await vi.runAllTimersAsync()
    await task
    expect(reads).toBe(2)
    expect(store.submissions[0]).toMatchObject({remoteId:123,status:'Accepted',score:100})
    expect(store.isSubmitting).toBe(false)
    expect(mocks.accepted).toHaveBeenCalledWith('luogu:P1001',[])
    expect(mocks.invoke.mock.calls.filter(([command]) => command === 'submit_luogu')).toHaveLength(1)
  })
})
