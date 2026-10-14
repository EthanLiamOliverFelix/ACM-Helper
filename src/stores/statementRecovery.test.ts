import { beforeEach, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useProblemStore } from './problemStore'
import { useAiStore } from './aiStore'
import { encodeTranslation, statementSource } from '../utils/statementIntegrity'
import type { Problem } from '../types'

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), disk: new Map<string, string>(), detail: {} as Problem }))
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }))
vi.mock('../diagnostics', () => ({ withOjDiagnostic: (_p: string, _o: string, task: () => Promise<unknown>) => task() }))
vi.mock('./settingsStore', () => ({ useSettingsStore: () => ({ codeTemplates: { cpp: '', python: '', java: '' } }) }))
vi.mock('../dataCenter', () => ({ getDataCenterValue: (_key: string, fallback: unknown) => fallback, saveDataCenterValue: vi.fn(async () => {}) }))
const partial: Problem = { id: '1163C2', platform: 'codeforces', title: 'Power Transmission', tags: [], contentFormat: 'html', description: '<p>Only an opening paragraph.</p>', samples: [] }
const full: Problem = { ...partial, description: '<p>Full statement.</p>', input: 'Read the poles', output: 'Print pairs', samples: [{ input: '4', output: '14' }] }
const chinese = '这是一份完整的中文题面翻译，用于验证原文版本变化后不会再显示旧版本的译文，且不同题目之间不会混用缓存。\n## 输入\n读入电线杆。\n## 输出\n输出相交对数。'
beforeEach(() => {
  setActivePinia(createPinia()); mocks.disk.clear(); mocks.detail = { ...full }; mocks.invoke.mockReset()
  mocks.invoke.mockImplementation(async (command, args) => {
    if (command === 'ai_chat') return { text: chinese }
    if (command === 'save_oj_translation') mocks.disk.set(`${args.platform}:${args.problemId}`, args.content)
    if (command === 'load_oj_translation') return mocks.disk.get(`${args.platform}:${args.problemId}`) ?? null
    if (command === 'fetch_problem_detail_cf') return { ...mocks.detail }
    return null
  })
})
function setup(problem = full) {
  const problems = useProblemStore(); problems.currentProblem = { ...problem }
  const ai = useAiStore(); ai.translationModel = 'test-model'; ai.translationApiKey = 'test-key'
  return { problems, ai }
}
it('rejects the partial 1163C2 source before calling the translation model', async () => {
  const { ai } = setup(partial)
  await expect(ai.translateCurrentProblem()).rejects.toThrow('缺少')
  expect(mocks.invoke.mock.calls.some(([command]) => command === 'ai_chat')).toBe(false)
})
it('preserves complete statements and samples when a partial refresh succeeds at the transport layer', async () => {
  const { problems } = setup(); mocks.detail = { ...partial }
  await expect(problems.refreshCurrentProblem()).rejects.toThrow('未覆盖')
  expect(problems.currentProblem?.description).toBe(full.description)
  expect(problems.currentProblem?.samples).toEqual(full.samples)
})
it('invalidates the displayed translation when refreshed original content changes', async () => {
  const { problems, ai } = setup(); await ai.translateCurrentProblem()
  expect(ai.translationFor(problems.currentProblem)).toBe(chinese)
  mocks.detail = { ...full, description: '<p>Updated complete statement.</p>' }
  await problems.refreshCurrentProblem()
  expect(ai.translationFor(problems.currentProblem)).toBeUndefined()
  expect(mocks.disk.has('codeforces:1163C2')).toBe(true)
})
it('reuses source-matching disk translations after reopening but ignores legacy unversioned translations', async () => {
  const { ai } = setup(); mocks.disk.set('codeforces:1163C2', encodeTranslation(chinese, statementSource(full)))
  expect(await ai.loadCachedTranslation('1163C2')).toBe(chinese)
  setActivePinia(createPinia()); const reopened = setup(); mocks.disk.set('codeforces:1163C2', chinese)
  expect(await reopened.ai.loadCachedTranslation('1163C2')).toBeNull()
  expect(reopened.ai.translationFor(reopened.problems.currentProblem)).toBeUndefined()
})
it('does not persist a response translated from an obsolete original', async () => {
  const { problems, ai } = setup()
  let release!: (value: { text: string }) => void
  mocks.invoke.mockImplementation(async (command) => command === 'ai_chat' ? new Promise(resolve => { release = resolve }) : null)
  const pending = ai.translateCurrentProblem(true)
  for (let i = 0; i < 5; i++) await Promise.resolve()
  problems.currentProblem!.description = 'Changed while translating'
  release({ text: chinese })
  await expect(pending).rejects.toThrow('题面已更新')
  expect(mocks.invoke.mock.calls.some(([command]) => command === 'save_oj_translation')).toBe(false)
})
it('does not save a long translation that only contains the opening story', async () => {
  const { ai } = setup()
  mocks.invoke.mockImplementation(async command => command === 'ai_chat' ? { text: '这是一份足够长的开头故事，但它没有覆盖原题的必要章节，也没有给出数据的格式，因而必须拒绝保存。' } : null)
  await expect(ai.translateCurrentProblem(true)).rejects.toThrow('缺少输入说明')
  expect(mocks.invoke.mock.calls.some(([command]) => command === 'save_oj_translation')).toBe(false)
})
