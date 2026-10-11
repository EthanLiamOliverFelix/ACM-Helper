import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useProblemStore } from './problemStore'

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), accepted: vi.fn() }))
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }))
vi.mock('../diagnostics', () => ({ withOjDiagnostic: (_p: string, _o: string, task: () => Promise<unknown>) => task() }))
vi.mock('../dataCenter', () => ({ getDataCenterValue: (_k: string, fallback: unknown) => fallback, saveDataCenterValue: vi.fn(async () => {}) }))
vi.mock('./settingsStore', () => ({ useSettingsStore: () => ({ codeTemplates: { cpp: '', python: '', java: '' } }) }))
vi.mock('./learningStore', () => ({ useLearningStore: () => ({ recordAccepted: mocks.accepted }) }))

beforeEach(() => { vi.clearAllMocks(); setActivePinia(createPinia()) })
function source() {
  const store = useProblemStore()
  store.currentProblem = { platform: 'qoj', id: '14687', title: 'Grand Voting', tags: ['greedy'], url: 'https://qoj.ac/contest/1096/problem/14687' }
  store.currentCode = 'int main() { return 0; }'
  store.currentLanguage = 'cpp'
  return store
}
describe('QOJ assisted submission', () => {
  it('opens the official contest submit page, records confirmation and updates progress only after AC', async () => {
    mocks.invoke.mockImplementation(async command => command === 'inspect_external_account' ? { loggedIn: true, username: 'white_sword' } : 'opened')
    const store = source()
    await store.submitCode()
    expect(mocks.invoke).toHaveBeenCalledWith('open_qoj_manual_submit', { problemId: '14687', problemUrl: 'https://qoj.ac/contest/1096/problem/14687', code: 'int main() { return 0; }' })
    expect(store.cfManualConfirmation?.platform).toBe('qoj')
    expect(store.submissions[0].status).toBe('Pending')
    expect(mocks.accepted).not.toHaveBeenCalled()
    await store.submitCode()
    expect(mocks.invoke.mock.calls.filter(([name]) => name === 'open_qoj_manual_submit')).toHaveLength(1)
    await store.confirmCfSubmission(true)
    expect(mocks.accepted).toHaveBeenCalledWith('qoj:14687', ['greedy'])
    expect(store.submissions[0].status).toBe('Accepted')
    expect(store.cfManualConfirmation).toBeNull()
    expect(mocks.invoke).toHaveBeenCalledWith('create_code_snapshot', expect.objectContaining({ platform: 'qoj', problemId: '14687', code: 'int main() { return 0; }' }))
  })
  it('does not open a submit window without login', async () => {
    mocks.invoke.mockResolvedValue({ loggedIn: false })
    const store = source()
    await store.submitCode()
    expect(store.lastSubmitError).toContain('尚未登录 QOJ')
    expect(store.submissions).toHaveLength(0)
    expect(store.isSubmitting).toBe(false)
  })
  it('reports window failures without leaving a pending confirmation', async () => {
    mocks.invoke.mockImplementation(async command => {
      if (command === 'inspect_external_account') return { loggedIn: true }
      if (command === 'open_qoj_manual_submit') throw new Error('窗口打开失败')
    })
    const store = source()
    await store.submitCode()
    expect(store.submissions[0].status).toBe('Failed')
    expect(store.cfManualConfirmation).toBeNull()
    expect(store.isSubmitting).toBe(false)
  })
  it('keeps the clicked code snapshot when the user switches tabs during account checking', async () => {
    let finish!: (value: unknown) => void
    mocks.invoke.mockImplementation(async command => command === 'inspect_external_account' ? new Promise(resolve => { finish = resolve }) : 'opened')
    const store = source()
    const pending = store.submitCode()
    store.currentProblem = { platform: 'qoj', id: '2', title: 'Boat', tags: [] }
    store.currentCode = '// different tab'
    finish({ loggedIn: true })
    await pending
    expect(store.cfManualConfirmation).toMatchObject({ problemId: '14687', code: 'int main() { return 0; }' })
  })
})
