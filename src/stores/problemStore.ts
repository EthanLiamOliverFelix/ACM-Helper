import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import type { Problem, Language, Platform, Submission, Verdict, RunResult, DebugResult, DebugSessionState, ToolchainInfo, DraftFileInfo, LuoguProblemPage, LuoguTag, LocalTestCase, LuoguRecordDetail } from '../types'
import { useLearningStore } from './learningStore'
import { useSettingsStore } from './settingsStore'
import { getDataCenterValue, saveDataCenterValue } from '../dataCenter'
import { withOjDiagnostic } from '../diagnostics'

export const useProblemStore = defineStore('problem', () => {
  type CatalogCache = { version: 1; updatedAt: number; cf: Problem[]; luogu: Problem[]; atcoder?: Problem[]; luoguTotal: number; luoguPerPage: number; luoguTags: LuoguTag[] }
  // ── 认证状态 ──
  const isLoggedIn = ref(false)
  const luoguLoggedIn = ref(false)
  const cfAccount = ref('')
  const luoguAccount = ref('')
  const isRefreshingAccounts = ref(false)
  const isCfLoginOpening = ref(false)
  const isLuoguLoginOpening = ref(false)
  const activeView = ref<'workspace' | 'learning' | 'ai'>('workspace')
  const showProblemTags = ref(getDataCenterValue('show-problem-tags', false))
  const isLoading = ref(false)
  const error = ref<string | null>(null)

  // ── 业务状态 ──
  const problems = ref<Problem[]>([])
  const importedProblems = ref<Problem[]>([])
  const importUrl = ref('')
  const isImporting = ref(false)
  const currentPlatform = ref<Platform>('codeforces')
  const currentProblem = ref<Problem | null>(null)
  const currentCode = ref<string>('')
  const currentLanguage = ref<Language>('cpp')
  const submissions = ref<Submission[]>([])
  const isSubmitting = ref(false)
  const isLoadingDetail = ref(false)
  const isRunning = ref(false)
  const runResult = ref<RunResult | null>(null)
  const debugResult = ref<DebugResult | null>(null)
  const isDebugging = ref(false)
  const breakpoints = ref<number[]>([])
  const runnerMode = ref<'run' | 'debug'>('run')
  const debugSession = ref<DebugSessionState | null>(null)
  const debugInput = ref('')
  const watchExpressions = ref<string[]>([])
  const debugError = ref('')
  const toolchains = ref<ToolchainInfo[]>([])
  const runInput = ref('')
  const testCases = ref<LocalTestCase[]>([])
  const allTestRunSummary = ref<null | { status: 'running' | 'passed' | 'failed'; text: string }>(null)
  const activeTestCaseId = ref('')
  const draftPath = ref('')
  const contextFileName = computed(() => {
    const localName = draftPath.value.split(/[\\/]/).pop()
    if (localName) return localName
    if (!currentProblem.value) return '未打开文件'
    const ext = currentLanguage.value === 'python' ? 'py' : currentLanguage.value === 'java' ? 'java' : 'cpp'
    return `${currentProblem.value.id}.${ext}`
  })
  const draftSaveStatus = ref<'template' | 'saved' | 'saving' | 'error'>('template')
  const draftDirty = ref(false)
  const isFormatting = ref(false)
  const formatError = ref('')
  const draftFiles = ref<DraftFileInfo[]>([])
  const luoguCaptchaImage = ref('')
  const luoguCaptcha = ref('')
  const luoguCaptchaProblemId = ref('')
  const cfManualConfirmation = ref<null | { submissionId: string; platform: 'codeforces' | 'atcoder' | 'qoj'; problemId: string; title: string; tags: string[] }>(null)
  let luoguPendingPayload: { problemId: string; code: string; language: Language; tags: string[]; languageId: number; enableO2: boolean } | null = null
  let saveTimer: ReturnType<typeof setTimeout> | null = null
  // 切题、打开本地文件和切换语言都涉及“保存旧草稿 → 更换标识 →
  // 读取新草稿”。串行执行可避免快速点击时较慢的旧读取覆盖新题代码。
  let workspaceTransition: Promise<void> = Promise.resolve()
  let catalogCache = getDataCenterValue<CatalogCache | null>('problem-catalog', null)

  function saveCatalogCache() {
    catalogCache = {
      version: 1,
      updatedAt: Date.now(),
      cf: problems.value.filter((problem) => problem.platform === 'codeforces'),
      luogu: problems.value.filter((problem) => problem.platform === 'luogu'),
      atcoder: problems.value.filter((problem) => problem.platform === 'atcoder'),
      luoguTotal: luoguTotal.value,
      luoguPerPage: luoguPerPage.value,
      luoguTags: luoguTags.value,
    }
    void saveDataCenterValue('problem-catalog', catalogCache)
  }

  function newTestCase(input = '', expectedOutput = ''): LocalTestCase {
    return {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      input,
      expectedOutput,
      actualOutput: '',
      stderr: '',
      status: 'idle',
    }
  }

  function testStorageKey(problem = currentProblem.value) {
    return problem ? `${problem.platform}:${problem.id}` : ''
  }

  function readStoredTestCases(): Record<string, LocalTestCase[]> {
    return getDataCenterValue<Record<string, LocalTestCase[]>>('local-test-cases', {})
  }

  function persistTestCases() {
    const key = testStorageKey()
    if (!key) return
    const saved = readStoredTestCases()
    saved[key] = testCases.value
    void saveDataCenterValue('local-test-cases', saved)
  }

  function loadTestCases(problem: Problem, preferFreshSamples = false) {
    const saved = readStoredTestCases()[testStorageKey(problem)]
    const source = !preferFreshSamples && saved?.length
      ? saved
      : (problem.samples?.length
          ? problem.samples.map((sample) => newTestCase(sample.input, sample.output))
          : [newTestCase()])
    testCases.value = source.map((test) => ({
      ...newTestCase(),
      ...test,
      id: test.id || newTestCase().id,
      status: test.status === 'running' ? 'idle' : test.status,
    }))
    activeTestCaseId.value = testCases.value[0]?.id ?? ''
    runInput.value = testCases.value[0]?.input ?? ''
    allTestRunSummary.value = null
  }

  function addTestCase(input = '', expectedOutput = '') {
    const test = newTestCase(input, expectedOutput)
    testCases.value.push(test)
    activeTestCaseId.value = test.id
    runInput.value = input
    allTestRunSummary.value = null
    persistTestCases()
    return test.id
  }

  function removeTestCase(id: string) {
    const index = testCases.value.findIndex((test) => test.id === id)
    if (index < 0) return
    testCases.value.splice(index, 1)
    if (!testCases.value.length) testCases.value.push(newTestCase())
    if (activeTestCaseId.value === id) {
      const next = testCases.value[Math.min(index, testCases.value.length - 1)]
      activeTestCaseId.value = next.id
      runInput.value = next.input
    }
    allTestRunSummary.value = null
    persistTestCases()
  }

  function selectTestCase(id: string) {
    const test = testCases.value.find((candidate) => candidate.id === id)
    if (!test) return
    activeTestCaseId.value = id
    runInput.value = test.input
  }

  function updateTestCase(id = activeTestCaseId.value) {
    const active = testCases.value.find((test) => test.id === id)
    if (active) {
      active.status = 'idle'
      activeTestCaseId.value = active.id
      runInput.value = active.input
    }
    allTestRunSummary.value = null
    persistTestCases()
  }

  function comparableOutput(value: string) {
    const lines = value.replace(/\r\n?/g, '\n').split('\n').map((line) => line.trimEnd())
    while (lines.length && !lines[lines.length - 1]) lines.pop()
    return lines.join('\n')
  }

  function toggleProblemTags() {
    showProblemTags.value = !showProblemTags.value
    void saveDataCenterValue('show-problem-tags', showProblemTags.value)
  }

  function queueWorkspaceTransition(operation: () => Promise<void>) {
    const next = workspaceTransition.then(operation, operation)
    workspaceTransition = next.catch(() => undefined)
    return next
  }

  const luoguVerdicts: Record<string, Verdict> = {
    AC: 'Accepted', WA: 'Wrong Answer', TLE: 'Time Limit Exceeded', RE: 'Runtime Error',
    MLE: 'Memory Limit Exceeded', CE: 'Compilation Error', OLE: 'Failed', UKE: 'Failed',
    IE: 'Failed', WJ: 'Pending', Judging: 'Running',
  }

  function concreteLuoguRecordVerdict(detail: LuoguRecordDetail): Verdict | undefined {
    const statusNames: Record<number, string> = { 2: 'CE', 3: 'OLE', 4: 'MLE', 5: 'TLE', 6: 'WA', 7: 'RE', 11: 'UKE' }
    for (const subtask of detail.subtasks) {
      for (const testCase of subtask.testCases) {
        const verdict = luoguVerdicts[statusNames[testCase.status]]
        if (verdict) return verdict
      }
    }
    return undefined
  }

  // ── 筛选 & 翻页 ──
  const searchQuery = ref('') // 题号/标题 关键词
  const minRating = ref<number | null>(null)
  const maxRating = ref<number | null>(null)
  const selectedTags = ref<Set<string>>(new Set())
  const page = ref(1)
  const pageSize = 50
  const luoguTotal = ref(0)
  const luoguPerPage = ref(50)
  const luoguTags = ref<LuoguTag[]>([])
  const luoguType = ref('')
  const luoguDifficulty = ref<number | null>(null)
  const isLoadingCatalog = ref(false)
  const isRefreshingCfCatalog = ref(false)
  const isRefreshingAtCoderCatalog = ref(false)
  // 洛谷筛选会在快速点击标签/翻页时并发请求。只允许最后一次响应更新界面，
  // 避免较慢的旧请求覆盖用户刚选择的新条件。
  let luoguCatalogRequestId = 0

  // 所有可用标签（按出现频率排序）
  const allTags = computed(() => {
    if (currentPlatform.value === 'luogu' && luoguTags.value.length) {
      return luoguTags.value
        .filter((tag) => tag.tagType === 2)
        .map((tag) => tag.name)
    }
    const freq: Record<string, number> = {}
    for (const p of problems.value) {
      if (p.platform !== currentPlatform.value) continue
      for (const t of p.tags) {
        freq[t] = (freq[t] || 0) + 1
      }
    }
    return Object.entries(freq)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 50)
      .map(([tag]) => tag)
  })

  // 筛选后的全部结果（未分页）
  const filteredProblems = computed(() => {
    let list = problems.value.filter((p) => p.platform === currentPlatform.value)

    // 洛谷题库由服务端完成筛选和分页；这里直接展示当前响应页。
    if (currentPlatform.value === 'luogu') return list

    // 题号/标题搜索
    if (searchQuery.value.trim()) {
      const q = searchQuery.value.trim().toLowerCase()
      list = list.filter(
        (p) =>
          p.id.toLowerCase().includes(q) ||
          p.title.toLowerCase().includes(q),
      )
    }

    // 难度范围
    if (minRating.value != null) {
      list = list.filter((p) => (p.rating ?? 0) >= minRating.value!)
    }
    if (maxRating.value != null) {
      list = list.filter((p) => (p.rating ?? 9999) <= maxRating.value!)
    }

    // 标签筛选（选中任一标签即匹配）
    if (selectedTags.value.size > 0) {
      list = list.filter((p) =>
        p.tags.some((t) => selectedTags.value.has(t)),
      )
    }

    return list
  })

  // 分页后的结果
  const pagedProblems = computed(() => {
    if (currentPlatform.value === 'luogu') return filteredProblems.value
    const start = (page.value - 1) * pageSize
    return filteredProblems.value.slice(start, start + pageSize)
  })

  const totalPages = computed(() => currentPlatform.value === 'luogu'
    ? Math.max(1, Math.ceil(luoguTotal.value / luoguPerPage.value))
    : Math.max(1, Math.ceil(filteredProblems.value.length / pageSize)),
  )

  const currentSubmissions = computed(() =>
    currentProblem.value
      ? submissions.value.filter((s) => s.problemId === currentProblem.value!.id && (!s.platform || s.platform === currentProblem.value!.platform))
      : []
  )

  async function persistSubmissions() {
    await invoke('save_submissions', { submissions: submissions.value })
  }

  // ── 筛选/翻页操作 ──
  async function toggleTag(tag: string) {
    const next = new Set(selectedTags.value)
    if (next.has(tag)) next.delete(tag)
    else next.add(tag)
    selectedTags.value = next
    page.value = 1 // 切换标签时回到第一页
    if (currentPlatform.value === 'luogu') await fetchLuoguProblems()
  }

  function clearFilters() {
    searchQuery.value = ''
    minRating.value = null
    maxRating.value = null
    selectedTags.value = new Set()
    luoguType.value = ''
    luoguDifficulty.value = null
    page.value = 1
  }

  async function setPage(p: number) {
    page.value = Math.max(1, Math.min(p, totalPages.value))
    if (currentPlatform.value === 'luogu') await fetchLuoguProblems(page.value)
  }

  async function applyProblemFilters() {
    page.value = 1
    if (currentPlatform.value === 'luogu') await fetchLuoguProblems(1)
  }

  async function resetProblemFilters() {
    clearFilters()
    if (currentPlatform.value === 'luogu') await fetchLuoguProblems(1)
  }

  // ── 认证操作 ──

  /** 通过内嵌浏览器登录 Codeforces */
  async function loginViaBrowser() {
    isCfLoginOpening.value = true
    error.value = null
    try {
      const result = await invoke<{ success: boolean; message: string }>('login_via_browser', {
        switchAccount: isLoggedIn.value,
        currentUsername: cfAccount.value || null,
      })
      if (result.success) {
        error.value = null
        // 不立即设置 isLoggedIn — 等待 on_cf_login 的事件回调
      } else {
        error.value = result.message
      }
    } catch (e: any) {
      error.value = typeof e === 'string' ? e : e?.message ?? '打开浏览器登录失败'
    } finally {
      isCfLoginOpening.value = false
    }
  }

  /** 监听来自 Rust 的登录事件 */
  function setupEventListener() {
    listen<boolean>('cf-login-success', async (_event) => {
      isLoggedIn.value = true
      isCfLoginOpening.value = false
      error.value = null
      await Promise.allSettled([refreshAccounts(), fetchProblems(true)])
    })
    listen<string>('cf-login-error', async (event) => {
      isCfLoginOpening.value = false
      error.value = event.payload
    })
    listen<string>('luogu-login-success', (event) => {
      luoguLoggedIn.value = true
      luoguAccount.value = event.payload?.trim() || luoguAccount.value
      isLuoguLoginOpening.value = false
      error.value = null
    })
    listen<string>('luogu-login-error', (event) => { isLuoguLoginOpening.value = false; error.value = event.payload })
  }

  async function loginLuogu() {
    isLuoguLoginOpening.value = true
    error.value = null
    try {
      await invoke('login_luogu_browser', {
        switchAccount: luoguLoggedIn.value,
        currentUsername: luoguAccount.value || null,
      })
    }
    catch (e) { error.value = String(e) }
    finally { isLuoguLoginOpening.value = false }
  }

  function applyLuoguAccountStatus(result: { loggedIn: boolean; username?: string }) {
    const username = result.username?.trim() ?? ''
    luoguLoggedIn.value = result.loggedIn && Boolean(username)
    luoguAccount.value = luoguLoggedIn.value ? username : ''
  }

  async function ensureOjAccount(platform: 'codeforces' | 'luogu') {
    try {
      const result = await withOjDiagnostic(platform, 'inspect-account', () => invoke<{ loggedIn: boolean; username?: string }>(platform === 'luogu' ? 'inspect_luogu_account' : 'inspect_cf_account'))
      if (platform === 'luogu') {
        applyLuoguAccountStatus(result)
      } else {
        isLoggedIn.value = result.loggedIn
        cfAccount.value = result.username ?? ''
      }
      const loggedIn = platform === 'luogu' ? luoguLoggedIn.value : isLoggedIn.value
      if (!loggedIn) lastSubmitError.value = `尚未登录${platform === 'luogu' ? '洛谷' : ' Codeforces'}，请先到顶部“设置 → OJ 账号”登录`
      return loggedIn
    } catch (reason) {
      lastSubmitError.value = `无法确认登录状态：${String(reason)}`
      return false
    }
  }

  async function submitLuogu() {
    if (!currentProblem.value || currentProblem.value.platform !== 'luogu' || !currentCode.value.trim()) return
    isSubmitting.value = true
    lastSubmitError.value = null
    const retryingCaptcha = Boolean(
      luoguPendingPayload
      && luoguCaptchaImage.value
      && currentProblem.value.id === luoguPendingPayload.problemId,
    )
    const settings = useSettingsStore()
    const payload = retryingCaptcha ? luoguPendingPayload! : {
      problemId: currentProblem.value.id,
      code: currentCode.value,
      language: currentLanguage.value,
      tags: [...currentProblem.value.tags],
      languageId: currentLanguage.value === 'cpp'
        ? settings.luoguCppLanguageId
        : currentLanguage.value === 'python'
          ? settings.luoguPythonLanguageId
          : 33,
      enableO2: currentLanguage.value === 'cpp' && settings.luoguEnableO2,
    }
    let sub = submissions.value.find((item) => item.platform === 'luogu' && item.problemId === payload.problemId && item.status === 'Pending')
    if (!sub) {
      sub = { id: `SUB-${Date.now()}`, problemId: payload.problemId, platform: 'luogu', status: 'Pending', language: payload.language, timestamp: Date.now() }
      submissions.value.unshift(sub)
    }
    isSubmitting.value = true
    lastSubmitError.value = null
    await persistSubmissions().catch(() => undefined)
    try {
      if (!retryingCaptcha) await persistDraft()
      const raw = await withOjDiagnostic('luogu', 'submit', () => invoke<string>('submit_luogu', {
        problemId: payload.problemId,
        language: payload.language,
        languageId: payload.languageId,
        enableO2: payload.enableO2,
        code: payload.code,
        captcha: luoguCaptcha.value.trim() || null,
      }))
      const result = JSON.parse(raw)
      if (result.captchaRequired) {
        luoguPendingPayload = payload
        luoguCaptchaImage.value = result.captchaImage
        luoguCaptchaProblemId.value = payload.problemId
        luoguCaptcha.value = ''
        lastSubmitError.value = '请输入图形验证码后再次提交'
        sub.message = '等待输入图形验证码'
        isSubmitting.value = false
        return
      }
      if (result.error) throw new Error(result.error)
      // A successful submission is stronger evidence than the optional account
      // preflight, whose home-page selectors may lag behind Luogu UI changes.
      luoguLoggedIn.value = true
      sub.status = luoguVerdicts[result.status] ?? 'Failed'
      sub.message = undefined
      sub.timeMs = typeof result.time === 'number' ? result.time : undefined
      sub.memoryBytes = typeof result.memory === 'number' ? result.memory : undefined
      sub.remoteId = typeof result.rid === 'number' ? result.rid : Number(result.rid) || undefined
      sub.score = typeof result.score === 'number' ? result.score : undefined
      luoguCaptchaImage.value = ''
      luoguCaptcha.value = ''
      luoguCaptchaProblemId.value = ''
      luoguPendingPayload = null
      if (sub.status === 'Accepted') await useLearningStore().recordAccepted(`luogu:${payload.problemId}`, payload.tags)
    } catch (e) {
      luoguCaptchaImage.value = ''
      luoguCaptcha.value = ''
      luoguCaptchaProblemId.value = ''
      luoguPendingPayload = null
      sub.status = 'Failed'; sub.message = String(e); isSubmitting.value = false; lastSubmitError.value = String(e)
    } finally {
      isSubmitting.value = false
      await persistSubmissions().catch(() => undefined)
    }
  }

  async function cancelLuoguCaptcha() {
    const problemId = luoguCaptchaProblemId.value
    luoguCaptchaImage.value = ''
    luoguCaptcha.value = ''
    luoguCaptchaProblemId.value = ''
    luoguPendingPayload = null
    const pending = submissions.value.find((item) => item.platform === 'luogu' && item.problemId === problemId && item.status === 'Pending')
    if (pending) { pending.status = 'Interrupted'; pending.message = '用户取消了验证码提交' }
    lastSubmitError.value = problemId ? `已取消 ${problemId} 的验证码提交` : null
    await persistSubmissions().catch(() => undefined)
  }

  /** 尝试从本地持久化恢复会话 */
  async function checkSession() {
    try {
      const result = await invoke<{ success: boolean; message: string }>('restore_session')
      if (result.success) {
        isLoggedIn.value = true
      }
    } catch (e: any) {
      console.log('未恢复会话:', e)
    }
  }

  async function refreshAccounts() {
    isRefreshingAccounts.value = true
    try {
      const [cf, luogu] = await Promise.allSettled([
        withOjDiagnostic('codeforces', 'inspect-account', () => invoke<{ loggedIn: boolean; username?: string }>('inspect_cf_account')),
        withOjDiagnostic('luogu', 'inspect-account', () => invoke<{ loggedIn: boolean; username?: string }>('inspect_luogu_account')),
      ])
      if (cf.status === 'fulfilled') {
        isLoggedIn.value = cf.value.loggedIn
        cfAccount.value = cf.value.username ?? ''
      }
      if (luogu.status === 'fulfilled') {
        applyLuoguAccountStatus(luogu.value)
      }
    } finally {
      isRefreshingAccounts.value = false
    }
  }

  async function openRecommendedProblem(reference: {
    platform: 'codeforces' | 'luogu' | 'atcoder' | 'qoj'
    id: string
    title: string
    url: string
    rating?: number
    difficulty?: Problem['difficulty']
    tags?: string[]
  }) {
    error.value = null
    let problem = [...problems.value, ...importedProblems.value]
      .find((item) => item.platform === reference.platform && item.id.toUpperCase() === reference.id.toUpperCase())
    if (!problem) {
      problem = await invoke<Problem>('import_problem_url', { url: reference.url })
      const key = `${problem.platform}:${problem.id}`
      importedProblems.value = [problem, ...importedProblems.value.filter((item) => `${item.platform}:${item.id}` !== key)]
      problems.value = [problem, ...problems.value.filter((item) => `${item.platform}:${item.id}` !== key)]
      await invoke('save_imported_problems', { problems: importedProblems.value })
    } else {
      const merged = {
        url: problem.url ?? reference.url,
        rating: problem.rating ?? reference.rating,
        difficulty: problem.platform === 'luogu' ? (problem.difficulty ?? reference.difficulty) : undefined,
        tags: problem.tags.length ? problem.tags : [...(reference.tags ?? [])],
      }
      Object.assign(problem, merged)
      for (const cached of [...problems.value, ...importedProblems.value]) {
        if (cached.platform === problem.platform && cached.id.toUpperCase() === problem.id.toUpperCase()) {
          Object.assign(cached, merged)
        }
      }
      if (importedProblems.value.some((item) => item.platform === problem!.platform && item.id.toUpperCase() === problem!.id.toUpperCase())) {
        await invoke('save_imported_problems', { problems: importedProblems.value }).catch(() => undefined)
      }
    }
    activeView.value = 'workspace'
    currentPlatform.value = problem.platform
    clearFilters()
    await selectProblem(problem)
  }

  /** 应用初始化：恢复会话 + 拉取题目列表（题目 API 公开，无需登录） */
  async function initApp() {
    setupEventListener()
    isLoading.value = true
    error.value = null
    try {
      importedProblems.value = (await invoke<Problem[]>('load_imported_problems').catch(() => []))
        .map((problem) => ({
          ...problem,
          // 旧版本会给所有无 rating 的题目误填 Easy。CF 只使用 rating，
          // 洛谷只保留网站原生的中文难度梯度。
          difficulty: problem.platform === 'luogu' && !['Easy', 'Medium', 'Hard'].includes(String(problem.difficulty))
            ? problem.difficulty
            : undefined,
          // Older saved imports predate rich statement metadata. Luogu has always
          // stored Markdown; legacy AtCoder snapshots were flattened plain text.
          contentFormat: problem.contentFormat
            ?? (problem.platform === 'luogu' ? 'markdown' : problem.platform === 'atcoder' ? 'text' : undefined),
        }))
      problems.value = [...importedProblems.value]
      if (catalogCache?.version === 1) {
        const merged = new Map<string, Problem>()
        for (const problem of [...catalogCache.cf, ...catalogCache.luogu, ...(catalogCache.atcoder ?? []), ...importedProblems.value]) {
          merged.set(`${problem.platform}:${problem.id.toUpperCase()}`, problem)
        }
        problems.value = [...merged.values()]
        luoguTotal.value = catalogCache.luoguTotal
        luoguPerPage.value = catalogCache.luoguPerPage || 50
        luoguTags.value = catalogCache.luoguTags ?? []
      }
      // CF 在确认 WebView 登录状态后才更新远端目录；未登录时保留本地缓存，
      // 登录成功事件会立即重试。洛谷目录仍可独立预热。
      const accountWarmup = refreshAccounts()
      const catalogWarmup = Promise.allSettled([
        accountWarmup.then(() => isLoggedIn.value ? fetchProblems() : undefined),
        fetchLuoguProblems(1),
        fetchAtCoderProblems(),
      ])
      submissions.value = await invoke<Submission[]>('load_submissions').catch(() => [])
      let recoveredInterrupted = false
      submissions.value = submissions.value.map((submission) => {
        if (!['Pending', 'Compiling', 'Running'].includes(submission.status)) return submission
        recoveredInterrupted = true
        return {
          ...submission,
          status: 'Interrupted' as Verdict,
          message: '应用上次在等待评测时退出；请到对应 OJ 的提交记录确认最终结果',
        }
      })
      if (recoveredInterrupted) await persistSubmissions().catch(() => undefined)
      ;[toolchains.value] = await Promise.all([
        invoke<ToolchainInfo[]>('detect_toolchains').catch(() => []),
        loadDraftFiles().catch(() => []),
      ])
      // 两个公开题库只获取目录元数据；具体题面仍由 selectProblem
      // 在用户点击题目后按需抓取。
      await Promise.allSettled([checkSession(), catalogWarmup])
    } finally {
      isLoading.value = false
    }
  }

  /** 获取 Codeforces 题目列表 */
  async function fetchProblems(force = false) {
    isRefreshingCfCatalog.value = true
    error.value = null
    try {
      const fetched = await withOjDiagnostic('codeforces', 'fetch-catalog', () => invoke<Problem[]>('fetch_problems_cf'))
      const importedByKey = new Map(importedProblems.value.map((item) => [`${item.platform}:${item.id}`, item]))
      const enriched = fetched.map((p) => ({
        ...p,
        ...(importedByKey.get(`${p.platform}:${p.id}`) ?? {}),
        rating: p.rating,
        tags: p.tags,
        difficulty: undefined,
        platform: p.platform as Platform,
      }))
      const fetchedKeys = new Set(enriched.map((item) => `${item.platform}:${item.id}`))
      const importedOnly = importedProblems.value
        .filter((item) => item.platform === 'codeforces' && !fetchedKeys.has(`${item.platform}:${item.id}`))
        .map((item) => ({ ...item, difficulty: undefined }))
      const otherPlatforms = problems.value.filter((item) => item.platform !== 'codeforces')
      problems.value = [...enriched, ...importedOnly, ...otherPlatforms]
      saveCatalogCache()
    } catch (e: any) {
      const message = typeof e === 'string' ? e : e?.message ?? '获取题目列表失败'
      // 保留可用缓存。若 CF 当前未登录，登录成功事件会自动强制重试；
      // 已登录或用户手动刷新时仍显示真实网络错误。
      if (force || isLoggedIn.value) error.value = message
      else if (!problems.value.some((problem) => problem.platform === 'codeforces')) error.value = `${message}；请先登录 Codeforces，登录成功后会自动重试`
    } finally {
      isRefreshingCfCatalog.value = false
    }
  }

  async function refreshCfCatalog() {
    if (!isLoggedIn.value) {
      error.value = '请先登录 Codeforces；登录成功后应用会自动拉取最新题库'
      return
    }
    await fetchProblems(true)
  }

  async function fetchAtCoderProblems(force = false) {
    isRefreshingAtCoderCatalog.value = true
    if (force) error.value = null
    try {
      const fetched = await withOjDiagnostic('atcoder', 'fetch-catalog', () => invoke<Problem[]>('fetch_problems_atcoder'))
      const importedByKey = new Map(importedProblems.value.map((item) => [`${item.platform}:${item.id}`, item]))
      const enriched = fetched.map((problem) => ({ ...problem, ...(importedByKey.get(`atcoder:${problem.id}`) ?? {}), rating: problem.rating, platform: 'atcoder' as Platform }))
      const fetchedKeys = new Set(enriched.map((item) => item.id.toUpperCase()))
      const importedOnly = importedProblems.value.filter((item) => item.platform === 'atcoder' && !fetchedKeys.has(item.id.toUpperCase()))
      problems.value = [...problems.value.filter((item) => item.platform !== 'atcoder'), ...enriched, ...importedOnly]
      saveCatalogCache()
    } catch (cause) {
      if (force || !problems.value.some((problem) => problem.platform === 'atcoder')) error.value = String(cause)
    } finally {
      isRefreshingAtCoderCatalog.value = false
    }
  }

  /** 按洛谷当前题库接口进行服务端筛选和分页。 */
  async function fetchLuoguProblems(targetPage = page.value) {
    const requestId = ++luoguCatalogRequestId
    isLoadingCatalog.value = true
    error.value = null
    try {
      const result = await withOjDiagnostic('luogu', 'fetch-catalog', () => invoke<LuoguProblemPage>('fetch_problems_luogu', {
        page: targetPage,
        keyword: searchQuery.value,
        problemType: luoguType.value,
        difficulty: luoguDifficulty.value,
        tagNames: [...selectedTags.value],
      }))
      if (requestId !== luoguCatalogRequestId) return
      luoguTotal.value = result.count
      luoguPerPage.value = result.perPage || 50
      luoguTags.value = result.tags
      const otherPlatforms = problems.value.filter((problem) => problem.platform !== 'luogu')
      problems.value = [...otherPlatforms, ...result.problems]
      page.value = targetPage
      if (targetPage === 1 && !searchQuery.value.trim() && !luoguType.value && !luoguDifficulty.value && selectedTags.value.size === 0) saveCatalogCache()
    } catch (e: any) {
      if (requestId !== luoguCatalogRequestId) return
      error.value = typeof e === 'string' ? e : e?.message ?? '获取洛谷题库失败'
    } finally {
      if (requestId === luoguCatalogRequestId) isLoadingCatalog.value = false
    }
  }

  async function importProblem() {
    if (!importUrl.value.trim()) return
    isImporting.value = true
    error.value = null
    try {
      const problem = await invoke<Problem>('import_problem_url', { url: importUrl.value.trim() })
      if (problem.platform !== 'luogu' || ['Easy', 'Medium', 'Hard'].includes(String(problem.difficulty))) {
        problem.difficulty = undefined
      }
      const key = `${problem.platform}:${problem.id}`
      importedProblems.value = [problem, ...importedProblems.value.filter((item) => `${item.platform}:${item.id}` !== key)]
      await invoke('save_imported_problems', { problems: importedProblems.value })
      problems.value = [problem, ...problems.value.filter((item) => `${item.platform}:${item.id}` !== key)]
      currentPlatform.value = problem.platform
      importUrl.value = ''
      clearFilters()
      await selectProblem(problem)
    } catch (e: any) {
      error.value = typeof e === 'string' ? e : e?.message ?? '导入题目失败'
    } finally {
      isImporting.value = false
    }
  }

  // ── 业务操作 ──

  async function setPlatform(platform: Platform) {
    if (platform !== 'luogu') {
      luoguCatalogRequestId++
      isLoadingCatalog.value = false
    }
    currentPlatform.value = platform
    page.value = 1
    clearFilters()
    if (platform === 'luogu') {
      if (!problems.value.some((problem) => problem.platform === 'luogu')) await fetchLuoguProblems(1)
      if (currentProblem.value?.platform !== 'luogu') currentProblem.value = null
      return
    }
    if (platform === 'atcoder' && !problems.value.some((problem) => problem.platform === 'atcoder')) await fetchAtCoderProblems()
    if (currentProblem.value?.platform !== platform) currentProblem.value = null
  }

  async function loadCurrentDraft() {
    if (!currentProblem.value) return
    const code = await invoke<string>('load_draft', {
      platform: currentProblem.value.platform,
      problemId: currentProblem.value.id,
      language: currentLanguage.value,
    })
    currentCode.value = code || useSettingsStore().codeTemplates[currentLanguage.value]
    draftPath.value = ''
    draftDirty.value = false
    draftSaveStatus.value = code ? 'saved' : 'template'
  }

  async function persistDraft() {
    // 只查看题目或运行未经修改的默认模板时不创建本地文件。
    if (!currentProblem.value || !draftDirty.value) return
    draftSaveStatus.value = 'saving'
    try {
      if (draftPath.value) {
        await invoke('save_workspace_file', { path: draftPath.value, code: currentCode.value })
      } else {
        draftPath.value = await invoke<string>('save_draft', {
          platform: currentProblem.value.platform,
          problemId: currentProblem.value.id,
          problemTitle: currentProblem.value.title,
          language: currentLanguage.value,
          code: currentCode.value,
        })
      }
      draftDirty.value = false
      draftSaveStatus.value = 'saved'
    } catch (e) {
      draftSaveStatus.value = 'error'
      throw e
    }
  }

  async function loadDraftFiles() {
    draftFiles.value = await invoke<DraftFileInfo[]>('list_drafts')
    return draftFiles.value
  }

  async function openDraftFile(file: DraftFileInfo) {
    if (debugSession.value?.sessionId) await stopDebugSession()
    await queueWorkspaceTransition(async () => {
      if (saveTimer) clearTimeout(saveTimer)
      if (currentProblem.value) await persistDraft().catch(() => undefined)
      const boundProblem = [...problems.value, ...importedProblems.value]
        .find((item) => item.platform === file.platform && item.id === file.problemId)
      const fallbackUrl = file.platform === 'codeforces'
        ? (() => {
            const match = file.problemId.match(/^(\d+)([A-Za-z][A-Za-z0-9]*)$/)
            return match ? `https://codeforces.com/problemset/problem/${match[1]}/${match[2]}` : undefined
          })()
        : file.platform === 'luogu'
          ? `https://www.luogu.com.cn/problem/${file.problemId}`
        : file.platform === 'atcoder'
            ? `https://atcoder.jp/contests/${file.problemId.split('_')[0]}/tasks/${file.problemId}`
            : file.platform === 'qoj'
              ? `https://qoj.ac/problem/${file.problemId}`
            : undefined
      currentProblem.value = boundProblem ?? {
        id: file.problemId,
        title: file.title || file.problemId.replace(/^\d+_/, '').split('_').join(' '),
        platform: file.platform,
        tags: [],
        contentFormat: 'markdown',
        description: file.unbound
          ? '这是一个未绑定题目的本地代码文件。可以正常运行和调试，但不会提交到 OJ。'
          : '正在根据本地记录恢复原题信息。',
        url: fallbackUrl,
      }
      currentLanguage.value = file.language
      currentPlatform.value = file.platform
      currentCode.value = await invoke<string>('read_workspace_file', { path: file.path })
      draftPath.value = file.path
      draftDirty.value = false
      runResult.value = null
      debugResult.value = null
      breakpoints.value = []
      draftSaveStatus.value = 'saved'
      if (!boundProblem && !file.unbound) {
        await fetchProblemDetail(currentProblem.value)
      }
      loadTestCases(currentProblem.value)
    })
  }

  async function createEmptyDraft(name: string, language: Language) {
    const file = await invoke<DraftFileInfo>('create_empty_draft', { name, language })
    await loadDraftFiles()
    await openDraftFile(file)
  }

  function workspacePathChanged(oldPath: string, newPath: string) {
    if (!draftPath.value) return
    const oldNormalized = oldPath.replace(/\\/g, '/').toLowerCase()
    const currentNormalized = draftPath.value.replace(/\\/g, '/').toLowerCase()
    if (currentNormalized === oldNormalized) {
      draftPath.value = newPath
      if (currentProblem.value?.platform === 'local') currentProblem.value.title = newPath.split(/[\\/]/).pop()?.replace(/\.(cpp|py|java)$/i, '') || currentProblem.value.title
    } else if (currentNormalized.startsWith(`${oldNormalized}/`)) {
      draftPath.value = `${newPath}${draftPath.value.slice(oldPath.length)}`
    }
  }

  async function workspacePathDeleted(path: string) {
    if (!draftPath.value) return
    const deleted = path.replace(/\\/g, '/').toLowerCase()
    const current = draftPath.value.replace(/\\/g, '/').toLowerCase()
    if (current !== deleted && !current.startsWith(`${deleted}/`)) return
    if (saveTimer) clearTimeout(saveTimer)
    if (debugSession.value?.sessionId) await stopDebugSession()
    currentProblem.value = null
    currentCode.value = ''
    draftPath.value = ''
    draftDirty.value = false
    draftSaveStatus.value = 'template'
    breakpoints.value = []
  }

  async function fetchProblemDetail(problem: Problem, force = false) {
    const isCfMissingRich = problem.platform === 'codeforces'
      && !(problem.description && problem.contentFormat === 'html')
    const isLuoguMissingRich = problem.platform === 'luogu'
      && !(problem.description && problem.contentFormat === 'markdown')
    const isAtCoderMissingRich = problem.platform === 'atcoder'
      && !(problem.description && problem.contentFormat === 'html')
    const isQojMissingRich = problem.platform === 'qoj'
      && !(problem.description && problem.contentFormat === 'html')
    if (!force && !isCfMissingRich && !isLuoguMissingRich && !isAtCoderMissingRich && !isQojMissingRich) return
    isLoadingDetail.value = true
    error.value = null
    try {
      const preserved = { rating: problem.rating, tags: problem.tags, difficulty: problem.difficulty, source: problem.source }
      const detail = problem.platform === 'codeforces'
        ? await withOjDiagnostic('codeforces', 'fetch-statement', () => invoke<Problem>('fetch_problem_detail_cf', { problemId: problem.id }))
        : await withOjDiagnostic(problem.platform, 'fetch-statement', () => invoke<Problem>('import_problem_url', {
            url: problem.url ?? (problem.platform === 'luogu'
              ? `https://www.luogu.com.cn/problem/${problem.id}`
              : problem.platform === 'atcoder'
                ? `https://atcoder.jp/contests/${problem.id.split('_')[0]}/tasks/${problem.id}`
                : `https://qoj.ac/problem/${problem.id}`),
          }))
      Object.assign(problem, detail, {
        rating: preserved.rating ?? detail.rating,
        tags: preserved.tags.length ? preserved.tags : detail.tags,
        difficulty: preserved.difficulty ?? detail.difficulty,
        source: preserved.source ?? detail.source,
      })
      const importedIndex = importedProblems.value.findIndex(
        (item) => item.platform === problem.platform && item.id === problem.id,
      )
      if (importedIndex >= 0) {
        importedProblems.value[importedIndex] = { ...problem }
        await invoke('save_imported_problems', { problems: importedProblems.value })
      }
      error.value = null
    } catch (e: any) {
      error.value = typeof e === 'string' ? e : e?.message ?? '题面抓取失败'
      if (force) throw e
    } finally {
      isLoadingDetail.value = false
    }
  }

  /**
   * 忽略当前题面的完整度判断，重新从 OJ 获取内容。
   * 只有请求成功后才会覆盖当前对象，因此失败时旧题面仍可继续查看。
   */
  async function refreshCurrentProblem() {
    if (!currentProblem.value || isLoadingDetail.value) return
    const key = testStorageKey(currentProblem.value)
    const hasSavedTests = Boolean(readStoredTestCases()[key]?.length)
    await fetchProblemDetail(currentProblem.value, true)
    if (!hasSavedTests) loadTestCases(currentProblem.value, true)
  }

  async function selectProblem(problem: Problem) {
    if (debugSession.value?.sessionId) await stopDebugSession()
    await queueWorkspaceTransition(async () => {
      if (saveTimer) clearTimeout(saveTimer)
      if (currentProblem.value) await persistDraft().catch(() => undefined)
      currentProblem.value = problem
      runResult.value = null
      debugResult.value = null
      breakpoints.value = []
      testCases.value = []
      activeTestCaseId.value = ''
      await Promise.all([loadCurrentDraft(), fetchProblemDetail(problem)])
      loadTestCases(problem)
    })
  }

  function updateCode(code: string) {
    if (code === currentCode.value) return
    currentCode.value = code
    draftDirty.value = true
    draftSaveStatus.value = 'saving'
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => persistDraft().catch((e) => { error.value = String(e) }), 500)
  }

  function resetCurrentCode() {
    updateCode(useSettingsStore().codeTemplates[currentLanguage.value])
  }

  async function setLanguage(lang: Language) {
    if (lang === currentLanguage.value) return
    if (debugSession.value?.sessionId) await stopDebugSession()
    await queueWorkspaceTransition(async () => {
      if (lang === currentLanguage.value) return
      if (saveTimer) clearTimeout(saveTimer)
      await persistDraft().catch(() => undefined)
      currentLanguage.value = lang
      runResult.value = null
      debugResult.value = null
      breakpoints.value = []
      await loadCurrentDraft()
    })
  }

  async function runLocally(input = runInput.value) {
    if (!currentProblem.value || !currentCode.value.trim()) return
    isRunning.value = true
    runResult.value = null
    try {
      await persistDraft()
      const settings = useSettingsStore()
      const result = await invoke<RunResult>('run_code', {
        platform: currentProblem.value.platform,
        problemId: currentProblem.value.id,
        language: currentLanguage.value,
        code: currentCode.value,
        input,
        timeoutMs: Math.max(3000, (currentProblem.value.timeLimitMs ?? 2000) * 2),
        outputLineLimit: settings.outputLineLimit,
      })
      runResult.value = result
    } catch (e: any) {
      runResult.value = { success: false, stdout: '', stderr: String(e), exitCode: null, durationMs: 0, timedOut: false }
    } finally {
      isRunning.value = false
    }
  }

  async function executeTestCase(test: LocalTestCase) {
    test.status = 'running'
    test.actualOutput = ''
    test.stderr = ''
    test.timedOut = false
    try {
      const settings = useSettingsStore()
      const result = await invoke<RunResult>('run_code', {
        platform: currentProblem.value!.platform,
        problemId: currentProblem.value!.id,
        language: currentLanguage.value,
        code: currentCode.value,
        input: test.input,
        timeoutMs: Math.max(3000, (currentProblem.value!.timeLimitMs ?? 2000) * 2),
        outputLineLimit: settings.outputLineLimit,
      })
      applyTestResult(test, result)
    } catch (e) {
      const message = String(e)
      test.stderr = message
      test.status = 'error'
      runResult.value = { success: false, stdout: '', stderr: message, exitCode: null, durationMs: 0, timedOut: false }
    }
  }

  function applyTestResult(test: LocalTestCase, result: RunResult) {
    runResult.value = result
    test.actualOutput = result.stdout
    test.stderr = result.stderr
    test.durationMs = result.durationMs
    test.compileDurationMs = result.compileDurationMs
    test.timedOut = result.timedOut
    test.status = !result.success
      ? 'error'
      : test.expectedOutput.trim()
        ? (comparableOutput(result.stdout) === comparableOutput(test.expectedOutput) ? 'passed' : 'failed')
        : 'completed'
  }

  async function runTestCase(id: string) {
    if (!currentProblem.value || !currentCode.value.trim() || isRunning.value) return
    const test = testCases.value.find((candidate) => candidate.id === id)
    if (!test) return
    allTestRunSummary.value = null
    selectTestCase(id)
    isRunning.value = true
    runResult.value = null
    try {
      await persistDraft()
      await executeTestCase(test)
      persistTestCases()
    } finally {
      isRunning.value = false
    }
  }

  async function runAllTestCases() {
    if (!currentProblem.value || !currentCode.value.trim() || isRunning.value || !testCases.value.length) return
    isRunning.value = true
    runResult.value = null
    allTestRunSummary.value = { status: 'running', text: `运行中 0/${testCases.value.length}` }
    try {
      await persistDraft()
      for (const test of testCases.value) {
        test.status = 'running'
        test.actualOutput = ''
        test.stderr = ''
        test.timedOut = false
      }
      allTestRunSummary.value = { status: 'running', text: `并行运行 ${testCases.value.length} 组…` }
      const settings = useSettingsStore()
      const results = await invoke<RunResult[]>('run_test_suite', {
        platform: currentProblem.value.platform,
        problemId: currentProblem.value.id,
        language: currentLanguage.value,
        code: currentCode.value,
        inputs: testCases.value.map((test) => test.input),
        timeoutMs: Math.max(3000, (currentProblem.value.timeLimitMs ?? 2000) * 2),
        outputLineLimit: settings.outputLineLimit,
      })
      results.forEach((result, index) => {
        const test = testCases.value[index]
        if (test) applyTestResult(test, result)
      })
      const lastTest = testCases.value[testCases.value.length - 1]
      if (lastTest) {
        activeTestCaseId.value = lastTest.id
        runInput.value = lastTest.input
      }
      persistTestCases()
      const firstFailureIndex = testCases.value.findIndex((test) => test.status === 'failed' || test.status === 'error')
      if (firstFailureIndex < 0) {
        allTestRunSummary.value = { status: 'passed', text: '✓ 通过' }
      } else {
        const failedTest = testCases.value[firstFailureIndex]
        const reason = failedTest.timedOut
          ? '运行超时'
          : failedTest.status === 'failed'
            ? '答案不同'
            : '运行错误'
        allTestRunSummary.value = { status: 'failed', text: `测试点 ${firstFailureIndex + 1} · ${reason}` }
      }
    } catch (e) {
      allTestRunSummary.value = { status: 'failed', text: '运行全部失败' }
      error.value = String(e)
    } finally {
      isRunning.value = false
    }
  }

  function toggleBreakpoint(line: number) {
    const next = new Set(breakpoints.value)
    if (next.has(line)) next.delete(line)
    else next.add(line)
    breakpoints.value = [...next].sort((a, b) => a - b)
  }

  async function debugLocally() {
    if (!currentProblem.value || !currentCode.value.trim()) return
    debugInput.value = testCases.value.find((test) => test.id === activeTestCaseId.value)?.input ?? runInput.value
    debugError.value = ''
    runnerMode.value = 'debug'
  }

  async function startDebugSession() {
    if (!currentProblem.value || !currentCode.value.trim() || isDebugging.value) return
    if (debugSession.value?.sessionId) await stopDebugSession(false)
    isDebugging.value = true
    debugSession.value = null
    debugError.value = ''
    try {
      await persistDraft()
      debugSession.value = await invoke<DebugSessionState>('start_debug_session', {
        language: currentLanguage.value,
        code: currentCode.value,
        input: debugInput.value,
        breakpoints: breakpoints.value,
        watches: watchExpressions.value,
      })
    } catch (e) {
      debugError.value = String(e)
    } finally {
      isDebugging.value = false
    }
  }

  async function debugAction(action: 'continue' | 'next' | 'step' | 'finish' | 'inspect') {
    if (!debugSession.value?.sessionId || isDebugging.value || !debugSession.value.active) return
    isDebugging.value = true
    debugError.value = ''
    try {
      debugSession.value = await invoke<DebugSessionState>('debug_session_action', {
        sessionId: debugSession.value.sessionId,
        action,
        watches: watchExpressions.value,
      })
    } catch (e) {
      debugError.value = String(e)
    } finally {
      isDebugging.value = false
    }
  }

  async function addWatchExpression(expression: string) {
    const value = expression.trim()
    if (!value || watchExpressions.value.includes(value)) return
    watchExpressions.value.push(value)
    if (debugSession.value?.active) await debugAction('inspect')
  }

  async function removeWatchExpression(expression: string) {
    watchExpressions.value = watchExpressions.value.filter((item) => item !== expression)
    if (debugSession.value?.active) await debugAction('inspect')
  }

  async function stopDebugSession(closePanel = true) {
    const sessionId = debugSession.value?.sessionId
    debugSession.value = null
    debugError.value = ''
    if (sessionId) await invoke('stop_debug_session', { sessionId }).catch(() => undefined)
    if (closePanel) runnerMode.value = 'run'
  }

  // 最近一次提交的错误详情
  const lastSubmitError = ref<string | null>(null)

  /** 复制代码并打开 CF / AtCoder / QOJ 官方提交页，评测结果由用户确认。 */
  async function submitCode() {
    if (!currentProblem.value || !currentCode.value.trim()) return
    if (cfManualConfirmation.value) {
      lastSubmitError.value = `请先确认 ${cfManualConfirmation.value.problemId} 的提交结果`
      return
    }
    isSubmitting.value = true
    lastSubmitError.value = null
    if (currentProblem.value.platform === 'codeforces' && !(await ensureOjAccount('codeforces'))) { isSubmitting.value = false; return }
    const submittedProblem = currentProblem.value
    const submittedTags = [...submittedProblem.tags]
    const submittedLanguage = currentLanguage.value
    const sub: Submission = {
      id: `SUB-${Date.now()}`,
      problemId: submittedProblem.id,
      status: 'Pending',
      language: submittedLanguage,
      timestamp: Date.now(),
      platform: submittedProblem.platform,
    }
    submissions.value.unshift(sub)
    await persistSubmissions().catch(() => undefined)

    try {
      if (submittedProblem.platform !== 'codeforces' && submittedProblem.platform !== 'atcoder' && submittedProblem.platform !== 'qoj') throw new Error('当前平台不支持人工提交')
      await persistDraft()
      sub.message = submittedProblem.platform === 'codeforces'
        ? await invoke<string>('open_cf_manual_submit', { problemId: submittedProblem.id, code: currentCode.value })
        : submittedProblem.platform === 'atcoder'
          ? await invoke<string>('open_atcoder_manual_submit', { problemUrl: submittedProblem.url, code: currentCode.value })
          : await invoke<string>('open_qoj_manual_submit', { problemId: submittedProblem.id, code: currentCode.value })
      cfManualConfirmation.value = { submissionId: sub.id, platform: submittedProblem.platform, problemId: submittedProblem.id, title: submittedProblem.title, tags: submittedTags }
      await persistSubmissions().catch(() => undefined)
    } catch (e: any) {
      sub.status = 'Failed'
      sub.message = typeof e === 'string' ? e : e?.message ?? '提交失败'
      lastSubmitError.value = typeof e === 'string' ? e : e?.message ?? '提交失败'
      await persistSubmissions().catch(() => undefined)
    } finally {
      isSubmitting.value = false
    }
  }

  async function confirmCfSubmission(accepted: boolean) {
    const confirmation = cfManualConfirmation.value
    if (!confirmation) return
    const submission = submissions.value.find((item) => item.id === confirmation.submissionId)
    if (submission) {
      submission.status = accepted ? 'Accepted' : 'Failed'
      submission.message = accepted ? '用户确认官方提交已 AC' : '用户确认本次尚未 AC'
    }
    if (accepted) {
      await useLearningStore().recordAccepted(`${confirmation.platform}:${confirmation.problemId}`, confirmation.tags)
    }
    cfManualConfirmation.value = null
    await persistSubmissions().catch(() => undefined)
  }

  async function fetchLuoguRecordDetail(submission: Submission) {
    if (submission.platform !== 'luogu') throw new Error('只有洛谷提交记录支持查看测试点详情')
    if (!submission.remoteId) {
      // Old local records have no Luogu record id and must first be matched by
      // username. Records with an id can be opened directly; their own page is
      // the authoritative login/access check.
      if (!(await ensureOjAccount('luogu'))) throw new Error(lastSubmitError.value || '请先登录洛谷')
      submission.remoteId = await invoke<number>('find_luogu_record_id', {
        problemId: submission.problemId,
        username: luoguAccount.value,
        submittedAt: submission.timestamp,
      })
      await persistSubmissions().catch(() => undefined)
    }
    const raw = await withOjDiagnostic('luogu', 'fetch-record-detail', () => invoke<string>('fetch_luogu_record_detail', { rid: submission.remoteId }))
    const detail = JSON.parse(raw) as LuoguRecordDetail & { error?: string }
    if (detail.error) throw new Error(detail.error)
    const concreteVerdict = concreteLuoguRecordVerdict(detail)
    if (concreteVerdict && submission.status !== concreteVerdict) {
      submission.status = concreteVerdict
      await persistSubmissions().catch(() => undefined)
    }
    return detail
  }

  return {
    isLoggedIn,
    luoguLoggedIn,
    cfAccount,
    luoguAccount,
    isRefreshingAccounts,
    isCfLoginOpening,
    isLuoguLoginOpening,
    activeView,
    showProblemTags,
    isLoading,
    isSubmitting,
    isLoadingDetail,
    isRunning,
    runResult,
    debugResult,
    isDebugging,
    breakpoints,
    runnerMode,
    debugSession,
    debugInput,
    watchExpressions,
    debugError,
    toolchains,
    runInput,
    testCases,
    allTestRunSummary,
    activeTestCaseId,
    draftPath,
    contextFileName,
    draftSaveStatus,
    draftDirty,
    isFormatting,
    formatError,
    draftFiles,
    luoguCaptchaImage,
    luoguCaptcha,
    luoguCaptchaProblemId,
    cfManualConfirmation,
    lastSubmitError,
    error,
    problems,
    importedProblems,
    importUrl,
    isImporting,
    currentPlatform,
    currentProblem,
    currentCode,
    currentLanguage,
    submissions,
    searchQuery,
    minRating,
    maxRating,
    selectedTags,
    luoguTotal,
    luoguTags,
    luoguType,
    luoguDifficulty,
    isLoadingCatalog,
    isRefreshingCfCatalog,
    isRefreshingAtCoderCatalog,
    page,
    pageSize,
    allTags,
    filteredProblems,
    pagedProblems,
    totalPages,
    currentSubmissions,
    toggleTag,
    clearFilters,
    toggleProblemTags,
    applyProblemFilters,
    resetProblemFilters,
    setPage,
    loginViaBrowser,
    loginLuogu,
    submitLuogu,
    cancelLuoguCaptcha,
    checkSession,
    refreshAccounts,
    initApp,
    fetchProblems,
    refreshCfCatalog,
    fetchAtCoderProblems,
    fetchLuoguProblems,
    importProblem,
    setPlatform,
    selectProblem,
    refreshCurrentProblem,
    addTestCase,
    removeTestCase,
    selectTestCase,
    updateTestCase,
    updateCode,
    resetCurrentCode,
    setLanguage,
    runLocally,
    runTestCase,
    runAllTestCases,
    debugLocally,
    startDebugSession,
    debugAction,
    addWatchExpression,
    removeWatchExpression,
    stopDebugSession,
    toggleBreakpoint,
    persistDraft,
    loadDraftFiles,
    openDraftFile,
    createEmptyDraft,
    workspacePathChanged,
    workspacePathDeleted,
    submitCode,
    confirmCfSubmission,
    fetchLuoguRecordDetail,
    openRecommendedProblem,
  }
})
