// @vitest-environment happy-dom
import { createApp, reactive } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import SubmitPanel from './SubmitPanel.vue'

vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl: vi.fn() }))
vi.mock('../dataCenter', () => ({
  getDataCenterValue: (_key: string, fallback: unknown) => fallback,
  saveDataCenterValue: vi.fn(),
}))
vi.mock('../stores/problemStore', () => ({ useProblemStore: () => store }))

const traceback = 'Traceback (most recent call last):\nTypeError: unsupported operand type(s)'
const store = reactive({
  currentLanguage: 'python',
  currentCode: 'raise TypeError()',
  breakpoints: [],
  currentSubmissions: [],
  testCases: [{ id: '1', input: '', expectedOutput: '', actualOutput: '', stderr: traceback, status: 'error', compileFailed: false }],
})

describe('test case output', () => {
  it.each([
    { actualOutput: '', compileFailed: false, expectedStderr: traceback },
    { actualOutput: 'before error\n', compileFailed: false, expectedStderr: traceback },
    { actualOutput: '', compileFailed: true, expectedStderr: undefined },
  ])('shows stderr independently of stdout and leaves compilation diagnostics in the terminal', ({ actualOutput, compileFailed, expectedStderr }) => {
    Object.assign(store.testCases[0], { actualOutput, compileFailed })
    const host = document.createElement('div')
    const app = createApp(SubmitPanel)
    app.mount(host)
    try {
      const stdout = host.querySelector<HTMLTextAreaElement>('textarea[aria-label="实际输出"]')
      const stderr = host.querySelector<HTMLTextAreaElement>('textarea[aria-label="错误输出"]')
      expect(stdout?.value).toBe(actualOutput || (expectedStderr ? undefined : ''))
      expect(stderr?.value).toBe(expectedStderr)
    } finally {
      app.unmount()
    }
  })
})
