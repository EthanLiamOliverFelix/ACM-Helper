import { describe, expect, it, vi, afterEach } from 'vitest'
import helperScript from '../../src-tauri/src/commands/luogu_record.js?raw'
import luoguCommands from '../../src-tauri/src/commands/luogu.rs?raw'
import { resolveLuoguRecordVerdict } from './luoguSubmission'
import type { LuoguRecordDetail } from '../types'

const reader = new Function('window', `${helperScript};return window.__acmLuoguRecord;`)({}) as {
  findRecord: (root: unknown, rid: number) => { status: number } | null
  verdict: (record: unknown) => string | undefined
  effectiveStatus: (record: unknown) => number | undefined
  request: (rid: number, html: boolean) => Promise<unknown>
}
const detail = (status: number, extra: Partial<LuoguRecordDetail> = {}): LuoguRecordDetail => ({
  recordId: 123, problemId: 'P1001', problemTitle: 'A+B', status, subtasks: [], ...extra,
})
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

describe('Luogu record payload detection', () => {
  it('keeps the generated submission and record-reader scripts syntactically valid', () => {
    for (const command of ['submit_luogu', 'fetch_luogu_record_detail']) {
      const template = luoguCommands.split(`pub async fn ${command}(`)[1].split('r#"')[1].split('"#,')[0]
      const script = template.replace(/\{(pid_json|code_json|captcha_json)\}/g, '"test"')
        .replace(/\{(port|rid|language_id)\}/g, '123').replace(/\{enable_o2\}/g, 'false')
        .replace(/\{\{/g, '{').replace(/\}\}/g, '}')
      expect(() => new Function(`${helperScript}\n${script}`)).not.toThrow()
    }
  })
  it.each([
    {currentData:{record:{id:123,status:12}}},
    {data:{currentData:{record:{id:123,status:12}}}},
    {data:{data:{record:{id:123,status:12}}}},
    {record:{id:123,status:'12'}},
    {id:123,status:12},
    JSON.stringify({currentData:{record:{id:123,status:12}}}),
  ])('finds final records across response envelopes', root => {
    const record = reader.findRecord(root, 123)
    expect(record).not.toBeNull()
    expect(reader.verdict(record)).toBe('AC')
  })
  it('prioritizes currentData over stale outer data and rejects mismatched or missing status', () => {
    expect(reader.verdict(reader.findRecord({currentData:{record:{id:123,status:12}},data:{record:{id:123,status:0}}},123))).toBe('AC')
    expect(reader.findRecord({record:{id:124,status:12}},123)).toBeNull()
    expect(reader.findRecord({record:{id:123}},123)).toBeNull()
    expect(reader.findRecord({record:{id:123,status:null}},123)).toBeNull()
  })
  it('uses a completed judge result behind a stale waiting status without assuming partial cases are final', () => {
    expect(reader.verdict({status:0,detail:JSON.stringify({judgeResult:{status:12}})})).toBe('AC')
    expect(reader.effectiveStatus({status:0,detail:JSON.stringify({judgeResult:{status:12}})})).toBe(12)
    expect(reader.verdict({status:0,detail:{judgeResult:{subtasks:[{testCases:[{status:12}]}]}}})).toBe('WJ')
    expect(reader.verdict({status:1,detail:{compileResult:{success:false}}})).toBe('CE')
  })
  it('aborts requests that hang instead of freezing the polling loop', async () => {
    vi.useFakeTimers()
    let signal: AbortSignal | undefined
    vi.stubGlobal('fetch', vi.fn((_url, options) => new Promise((_resolve, reject) => {
      signal = options.signal
      signal!.addEventListener('abort', () => reject(new Error('aborted')))
    })))
    const result = expect(reader.request(123,false)).rejects.toThrow('aborted')
    await vi.advanceTimersByTimeAsync(9000)
    await result
    expect(signal?.aborted).toBe(true)
  })
})

describe('Luogu result recovery', () => {
  it.each([12,21])('recognizes AC status %s even without test points', status => {
    expect(resolveLuoguRecordVerdict(detail(status))).toBe('Accepted')
  })
  it('recognizes CE without test points and keeps pending records unresolved', () => {
    expect(resolveLuoguRecordVerdict(detail(2))).toBe('Compilation Error')
    expect(resolveLuoguRecordVerdict(detail(1,{compileSuccess:false}))).toBe('Compilation Error')
    expect(resolveLuoguRecordVerdict(detail(0))).toBeUndefined()
    expect(resolveLuoguRecordVerdict(detail(1))).toBeUndefined()
    expect(resolveLuoguRecordVerdict(detail(999))).toBeUndefined()
    expect(resolveLuoguRecordVerdict(detail(0,{verdict:'AC'}))).toBe('Accepted')
  })
  it('uses concrete failures only once the record is final', () => {
    const subtasks = [{id:0,status:14,score:0,testCases:[{id:1,status:5,score:0,timeMs:1,memoryBytes:1}]}]
    expect(resolveLuoguRecordVerdict(detail(14,{subtasks}))).toBe('Time Limit Exceeded')
    expect(resolveLuoguRecordVerdict(detail(1,{subtasks}))).toBeUndefined()
  })
})
