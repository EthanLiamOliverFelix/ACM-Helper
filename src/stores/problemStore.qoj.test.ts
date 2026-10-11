import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useProblemStore } from './problemStore'
import { useAiStore } from './aiStore'
import type { QojArchiveEntry, QojArchivePage, QojProblemPage } from '../types'

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), data: new Map<string, unknown>(), listeners: new Map<string, (event: { payload: unknown }) => void>() }))
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }))
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async (name: string, callback: (event: { payload: unknown }) => void) => {
  mocks.listeners.set(name, callback)
  return () => mocks.listeners.delete(name)
}) }))
vi.mock('../diagnostics', () => ({ withOjDiagnostic: (_p: string, _o: string, task: () => Promise<unknown>) => task() }))
vi.mock('./settingsStore', () => ({ useSettingsStore: () => ({ codeTemplates: { cpp: '// template', python: '# template', java: '// template' } }) }))
vi.mock('../dataCenter', () => ({
  getDataCenterValue: (key: string, fallback: unknown) => mocks.data.has(key) ? JSON.parse(JSON.stringify(mocks.data.get(key))) : fallback,
  saveDataCenterValue: vi.fn(async (key: string, value: unknown) => { mocks.data.set(key, JSON.parse(JSON.stringify(value))) }),
}))

const catalogPage = (page: number): QojProblemPage => ({ page, totalPages: 12, problems: [{ id: `${page}`, title: `Problem ${page}`, platform: 'qoj', tags: [] }] })
const contest: QojArchiveEntry = { id: '2', kind: 'contest', title: 'Finals', url: 'https://qoj.ac/contest/2', problems: [{ id: '50', label: 'A', title: 'Example', url: 'https://qoj.ac/contest/2/problem/50', acceptedTeams: 0, submittedTeams: 9 }] }
beforeEach(() => { vi.clearAllMocks(); mocks.data.clear(); mocks.listeners.clear(); setActivePinia(createPinia()) })

describe('QOJ catalogs and archives', () => {
  it('refetches cached numbered input-format examples even when another sample was already extracted', async () => {
    mocks.invoke.mockImplementation(async command => command === 'import_problem_url'
      ? { id: '10', title: '混乱的密码', platform: 'qoj', tags: [], description: '<p>正文</p>', contentFormat: 'html', samples: [{ input: '8\nabaaaaaa', output: '4' }] } : null)
    const store = useProblemStore()
    await store.selectProblem({ id: '10', title: '混乱的密码', platform: 'qoj', tags: [], description: '<h3>输入格式 1</h3><pre>8\nabaaaaaa</pre>', contentFormat: 'html', samples: [{ input: 'old', output: 'old' }] })
    expect(mocks.invoke).toHaveBeenCalledWith('import_problem_url', { url: 'https://qoj.ac/problem/10' })
    expect(store.currentProblem?.samples).toEqual([{ input: '8\nabaaaaaa', output: '4' }])
  })
  it('reads a contest for importing without changing the archive currently being viewed', async () => {
    mocks.invoke.mockResolvedValue({ title: contest.title, url: contest.url, entries: [contest] })
    const store = useProblemStore()
    const page = await store.readQojContest(contest.url)
    expect(page.entries[0].problems).toEqual(contest.problems)
    expect(store.qojSelectedContest).toBeNull()
    expect(store.qojArchivePage).toBeNull()
  })
  it('preserves the archive title when the statement endpoint returns a placeholder', async () => {
    mocks.invoke.mockImplementation(async command => command === 'import_problem_url'
      ? { id: '14687', title: 'QOJ 14687', platform: 'qoj', tags: [], description: '<p>题面</p>', contentFormat: 'html' } : null)
    const store = useProblemStore()
    await store.openQojArchiveProblem({ id: '14687', title: 'Grand Voting', label: 'A', url: 'https://qoj.ac/contest/1096/problem/14687' })
    expect(store.currentProblem?.title).toBe('Grand Voting')
  })
  it('reuses a loaded QOJ Markdown statement when changing tabs', async () => {
    mocks.invoke.mockResolvedValue(null)
    const store = useProblemStore()
    await store.selectProblem({ id: '1', title: 'I/O Test', platform: 'qoj', tags: [], description: 'statement', contentFormat: 'markdown' })
    await store.selectProblem({ id: '2', title: 'Boat', platform: 'qoj', tags: [], description: 'statement', contentFormat: 'markdown' })
    expect(mocks.invoke.mock.calls.filter(call => call[0] === 'import_problem_url')).toHaveLength(0)
  })
  it('paginates remote rows and restores visited pages without fetching again', async () => {
    mocks.invoke.mockImplementation(async (_command, args) => catalogPage(args.page))
    const store = useProblemStore()
    await store.setPlatform('qoj')
    expect(store.totalPages).toBe(12)
    await store.setPage(2)
    expect(store.pagedProblems.map(p => p.id)).toEqual(['2'])
    await store.setPage(1)
    expect(mocks.invoke).toHaveBeenCalledTimes(2)
    expect(store.pagedProblems.map(p => p.id)).toEqual(['1'])
    expect(mocks.data.has('qoj-catalog-pages')).toBe(true)
  })
  it('does not overwrite a newer page with a delayed response', async () => {
    let release!: (value: QojProblemPage) => void
    mocks.invoke.mockImplementation(async (_command, args) => args.page === 1 ? new Promise<QojProblemPage>(resolve => { release = resolve }) : catalogPage(2))
    const store = useProblemStore()
    store.currentPlatform = 'qoj'
    const old = store.fetchQojProblems(1)
    await store.fetchQojProblems(2)
    release(catalogPage(1)); await old
    expect(store.page).toBe(2)
    expect(store.pagedProblems[0].id).toBe('2')
    expect(store.isLoadingCatalog).toBe(false)
  })
  it('keeps archive discoveries out of the main catalog and caches contest stats', async () => {
    const root: QojArchivePage = { title: 'Europe', url: 'https://qoj.ac/category/18', entries: [{ kind: 'group', id: 'finals', title: 'Finals', url: 'https://qoj.ac/category/18', problems: [], children: [contest] }] }
    mocks.invoke.mockImplementation(async (_command, args) => args.url.includes('/contest/') ? { title: 'Finals', url: contest.url, entries: [contest] } : root)
    const store = useProblemStore()
    await store.fetchQojArchive(root.url)
    await store.openQojArchiveEntry(contest)
    expect(store.qojSelectedContest?.problems[0].acceptedTeams).toBe(0)
    store.backQojArchive()
    expect(store.qojArchivePage?.title).toBe('Europe')
    await store.openQojArchiveEntry(contest)
    expect(mocks.invoke).toHaveBeenCalledTimes(2)
    store.currentPlatform = 'qoj'
    expect(store.pagedProblems).toEqual([])
    await store.openQojArchiveEntry(contest, true)
    expect(mocks.invoke).toHaveBeenCalledTimes(3)
    expect(store.qojArchivePage?.title).toBe('Europe')
  })
})


describe('QOJ account and totals', () => {
  it('does not let an older anonymous check overwrite a newer logged-in account', async () => {
    let release!: (account: { loggedIn: boolean }) => void
    let requested!: () => void
    const firstRequested = new Promise<void>(resolve => { requested = resolve })
    let checks = 0
    mocks.invoke.mockImplementation(async (command, args) => {
      if (command === 'qoj_account_window_open') return true
      if (command === 'inspect_external_account' && args.platform === 'qoj') {
        if (++checks === 1) {
          requested()
          return new Promise(resolve => { release = resolve })
        }
        return { loggedIn: true, username: 'white_sword' }
      }
      return { loggedIn: false }
    })
    const store = useProblemStore()
    const older = store.refreshAccounts()
    await firstRequested
    await store.refreshAccounts()
    expect(store.qojAccount).toBe('white_sword')
    release({ loggedIn: false })
    await older
    expect(store.qojLoggedIn).toBe(true)
    expect(store.qojAccount).toBe('white_sword')
    expect(store.isQojLoginOpening).toBe(false)
  })
  it('reads the logged-in QOJ account while the login window is still open', async () => {
    mocks.invoke.mockImplementation(async (command, args) => {
      if (command === 'qoj_account_window_open') return true
      if (command === 'inspect_external_account' && args.platform === 'qoj') return { loggedIn: true, username: 'white_sword' }
      return { loggedIn: false }
    })
    const store = useProblemStore()
    await store.refreshAccounts()
    expect(store.qojAccount).toBe('white_sword')
    expect(store.qojLoggedIn).toBe(true)
    expect(store.isQojLoginOpening).toBe(false)
  })
  it('updates QOJ from native login success and stops showing the login button as pending', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('window', { setTimeout })
    try {
      mocks.invoke.mockImplementation(async command => {
        if (command === 'qoj_account_window_open' || command === 'external_account_session_status') return false
        if (command.startsWith('inspect_')) return { loggedIn: false }
        return []
      })
      const store = useProblemStore()
      await store.initApp()
      await store.loginExternalAccount('qoj')
      expect(store.isQojLoginOpening).toBe(true)
      mocks.listeners.get('qoj-login-success')!({ payload: { loggedIn: true, username: 'white_sword' } })
      expect(store.qojAccount).toBe('white_sword')
      expect(store.isQojLoginOpening).toBe(false)
      expect(vi.getTimerCount()).toBe(0)
    } finally { vi.useRealTimers(); vi.unstubAllGlobals() }
  })
  it('clears pending login when the QOJ window is manually closed', async () => {
    mocks.invoke.mockImplementation(async command => {
      if (command === 'qoj_account_window_open' || command === 'external_account_session_status') return false
      if (command.startsWith('inspect_')) return { loggedIn: false }
      return []
    })
    const store = useProblemStore()
    await store.initApp()
    await store.loginExternalAccount('qoj')
    mocks.listeners.get('qoj-login-closed')!({ payload: null })
    expect(store.isQojLoginOpening).toBe(false)
    expect(store.qojLoggedIn).toBe(false)
  })
  it('preserves a known Codeforces username when an account check only confirms login', async () => {
    mocks.invoke.mockImplementation(async command => command === 'inspect_cf_account'
      ? { loggedIn: true, username: null } : { loggedIn: false })
    const store = useProblemStore()
    store.cfAccount = 'Example_Handle'
    await store.refreshAccounts()
    expect(store.cfAccount).toBe('Example_Handle')
    mocks.invoke.mockResolvedValue({ loggedIn: false })
    await store.refreshAccounts()
    expect(store.cfAccount).toBe('')
  })
  it('counts actual cached rows across all pages, ignoring duplicate IDs and holes', async () => {
    const now = Date.now()
    const first = { ...catalogPage(1), totalPages: 2, updatedAt: now }
    const second = { ...catalogPage(2), totalPages: 2, updatedAt: now, problems: [...first.problems, ...catalogPage(2).problems] }
    mocks.data.set('qoj-catalog-pages', { ':1': first, ':2': second })
    const store = useProblemStore()
    store.currentPlatform = 'qoj'
    store.qojCatalogPage = first
    expect(store.qojCatalogTotal).toBe(2)
    await store.countQojCatalog()
    expect(mocks.invoke).not.toHaveBeenCalled()
    store.searchQuery = 'Boat'
    expect(store.qojCatalogTotal).toBeNull()
  })
  it('refreshes the QOJ account independently of AtCoder', async () => {
    mocks.invoke.mockImplementation(async (command, args) => command === 'inspect_external_account'
      ? { loggedIn: args.platform === 'qoj', username: args.platform === 'qoj' ? 'example-user' : '' }
      : false)
    const store = useProblemStore()
    await store.refreshAccounts()
    expect(store.qojLoggedIn).toBe(true)
    expect(store.qojAccount).toBe('example-user')
    expect(store.atcoderLoggedIn).toBe(false)
  })
})


it('loads QOJ translation caches under their own platform key', async () => {
  const content = '这是完整的中文题面。给定一个整数序列，求满足条件的子序列数量。请保留数学公式和输入输出的约束，最终输出一个整数。'
  mocks.invoke.mockResolvedValue(content)
  const ai = useAiStore()
  await ai.loadCachedTranslation(' 1173 ', 'qoj')
  expect(mocks.invoke).toHaveBeenCalledWith('load_oj_translation', { platform: 'qoj', problemId: '1173' })
  expect(ai.translations['qoj:1173']).toBe(content)
  expect(ai.translations['codeforces:1173']).toBeUndefined()
})

it('collects missing QOJ pages without replacing the page being read', async () => {
  vi.stubGlobal('window', { setTimeout: (callback: () => void) => setTimeout(callback, 0) })
  try {
    const first = { ...catalogPage(1), totalPages: 2, updatedAt: Date.now() }
    mocks.data.set('qoj-catalog-pages', { ':1': first })
    mocks.invoke.mockResolvedValue({ ...catalogPage(2), totalPages: 2 })
    const store = useProblemStore()
    store.currentPlatform = 'qoj'
    store.qojCatalogPage = first
    expect(store.qojCatalogTotal).toBeNull()
    await store.countQojCatalog()
    expect(store.qojCatalogTotal).toBe(2)
    expect(store.qojCatalogPage?.page).toBe(1)
    expect(store.isLoadingCatalog).toBe(false)
    expect(mocks.data.has('qoj-catalog-pages')).toBe(true)
  } finally { vi.unstubAllGlobals() }
})


it('refetches the cached QOJ site title instead of treating it as a loaded statement', async () => {
  mocks.invoke.mockImplementation(async command => command === 'import_problem_url'
    ? { id: '9', title: '简单回路', platform: 'qoj', tags: [], description: '<p>完整题面</p>', contentFormat: 'html', source: 'QOJ · 中文题面' }
    : null)
  const store = useProblemStore()
  await store.selectProblem({ id: '9', title: 'QOJ.ac', platform: 'qoj', tags: [], description: '<p>旧题面</p>', contentFormat: 'html', source: 'QOJ · 中文题面' })
  expect(mocks.invoke.mock.calls.some(call => call[0] === 'import_problem_url')).toBe(true)
  expect(store.currentProblem?.title).toBe('简单回路')
})


it('continues counting after leaving the QOJ panel and retries a transient failure', async () => {
  vi.stubGlobal('window', { setTimeout: (callback: () => void) => setTimeout(callback, 0) })
  try {
    const first = { ...catalogPage(1), totalPages: 4, updatedAt: Date.now() }
    mocks.data.set('qoj-catalog-pages', { ':1': first })
    const store = useProblemStore()
    store.currentPlatform = 'qoj'
    store.qojCatalogPage = first
    let failedOnce = false
    mocks.invoke.mockImplementation(async (_command, args) => {
      store.currentPlatform = 'local'
      if (args.page === 2 && !failedOnce) { failedOnce = true; throw new Error('temporary network failure') }
      return { ...catalogPage(args.page), totalPages: 4 }
    })
    await store.countQojCatalog()
    expect(store.qojCatalogTotal).toBe(4)
    expect(store.qojCountProgress).toEqual({ completed: 4, pages: 4, problems: 4 })
    expect(store.qojCountError).toBe('')
    expect(store.qojCatalogPage?.page).toBe(1)
    expect(mocks.invoke.mock.calls.filter(call => call[1].page === 2)).toHaveLength(2)
  } finally { vi.unstubAllGlobals() }
})
