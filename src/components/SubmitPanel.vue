<script setup lang="ts">
import { useProblemStore } from '../stores/problemStore'
import { openUrl } from '@tauri-apps/plugin-opener'
import { ref } from 'vue'
import DebugPanel from './DebugPanel.vue'
import type { LuoguRecordDetail, Submission } from '../types'
import { getDataCenterValue, saveDataCenterValue } from '../dataCenter'
import { usePointerResize } from '../composables/usePointerResize'

const store = useProblemStore()
const { startPointerResize } = usePointerResize()
withDefaults(defineProps<{ submissionOnly?: boolean }>(), { submissionOnly: false })
const copiedBox = ref('')
const savedPaneSizes = getDataCenterValue<{ runner?: number; actions?: number }>('submit-pane-sizes', {})
const runnerHeight = ref(Number(savedPaneSizes.runner) || 420)
const actionsHeight = ref(Number(savedPaneSizes.actions) || 210)
const recordDetail = ref<LuoguRecordDetail | null>(null)
const recordDetailLoading = ref(false)
const recordDetailError = ref('')
const selectedSubmission = ref<Submission | null>(null)
function startPaneResize(kind: 'runner' | 'actions', event: PointerEvent) {
  const panel = (event.currentTarget as HTMLElement).closest('.submit-panel') as HTMLElement | null
  const startY = event.clientY
  const startHeight = kind === 'runner' ? runnerHeight.value : actionsHeight.value
  const panelHeight = panel?.clientHeight ?? window.innerHeight
  startPointerResize(event, {
    axis: 'y',
    onMove: current => {
      const next = startHeight + current.clientY - startY
      if (kind === 'runner') runnerHeight.value = Math.max(150, Math.min(next, panelHeight - actionsHeight.value - 130))
      else actionsHeight.value = Math.max(125, Math.min(next, panelHeight - runnerHeight.value - 130))
    },
    onEnd: () => { void saveDataCenterValue('submit-pane-sizes', { runner: runnerHeight.value, actions: actionsHeight.value }) },
  })
}

async function openRecordDetail(submission: Submission) {
  if (submission.platform !== 'luogu') return
  selectedSubmission.value = submission
  recordDetail.value = null
  recordDetailError.value = ''
  recordDetailLoading.value = true
  try { recordDetail.value = await store.fetchLuoguRecordDetail(submission) }
  catch (cause) { recordDetailError.value = String(cause) }
  finally { recordDetailLoading.value = false }
}

function closeRecordDetail() { selectedSubmission.value = null; recordDetail.value = null; recordDetailError.value = '' }
async function handleSubmit() {
  if (!store.currentProblem) return
  if (!store.currentCode.trim()) {
    console.warn('代码为空，无法提交')
    return
  }
  await store.submitCode()
}

async function openOriginalOj() {
  if (store.currentProblem?.url) await openUrl(store.currentProblem.url)
}

async function copyBox(value: string, key: string) {
  await navigator.clipboard.writeText(value)
  copiedBox.value = key
  window.setTimeout(() => { if (copiedBox.value === key) copiedBox.value = '' }, 1500)
}

async function handleDebug() { await store.debugLocally() }

const statusInfo: Record<string, { text: string; color: string }> = {
  Pending:       { text: '⏳ Queue',      color: 'var(--color-accent)' },
  Compiling:     { text: '🔨 Compiling',  color: 'var(--color-warning)' },
  Running:       { text: '🏃 Running',    color: 'var(--color-accent)' },
  Accepted:      { text: '✅ AC',          color: 'var(--color-success)' },
  'Wrong Answer':{ text: '❌ WA',          color: 'var(--color-danger-strong)' },
  'Time Limit Exceeded': { text: '⏱ TLE', color: 'var(--color-warning)' },
  'Runtime Error':       { text: '💥 RE', color: 'var(--color-danger-strong)' },
  'Memory Limit Exceeded': { text: '📦 MLE', color: 'var(--color-warning)' },
  'Compilation Error':    { text: '🔴 CE', color: 'var(--color-danger-strong)' },
  Skipped:        { text: '⏭ Skipped',    color: 'var(--color-text-muted)' },
  Interrupted:    { text: '⏸ 已中断',      color: 'var(--color-warning)' },
  Failed:         { text: '⚠ Failed',     color: 'var(--color-danger-strong)' },
}

const testStatusInfo = {
  idle: { text: '未运行', className: '' },
  running: { text: '运行中…', className: 'test-status--running' },
  passed: { text: '✓ 通过', className: 'test-status--passed' },
  failed: { text: '✕ 答案不同', className: 'test-status--failed' },
  completed: { text: '运行完成', className: 'test-status--completed' },
  error: { text: '运行错误', className: 'test-status--error' },
} as const

const luoguStatus: Record<number, { short: string; name: string }> = {
  0: { short: 'WJ', name: '等待评测' }, 1: { short: 'Judging', name: '评测中' }, 2: { short: 'CE', name: '编译错误' },
  3: { short: 'OLE', name: '输出超限' }, 4: { short: 'MLE', name: '内存超限' }, 5: { short: 'TLE', name: '时间超限' },
  6: { short: 'WA', name: '答案错误' }, 7: { short: 'RE', name: '运行错误' }, 11: { short: 'UKE', name: '未知错误' },
  12: { short: 'AC', name: 'Accepted' }, 14: { short: 'WA', name: '未通过' }, 21: { short: 'AC', name: 'Accepted' },
}

function luoguStatusClass(status: number) { return status === 12 || status === 21 ? 'accepted' : status === 0 || status === 1 ? 'judging' : 'rejected' }

function formatMem(bytes?: number): string {
  if (!bytes) return ''
  const mb = bytes / 1024 / 1024
  return mb >= 1 ? `${mb.toFixed(0)} MB` : `${(bytes / 1024).toFixed(0)} KB`
}
</script>

<template>
  <div class="submit-panel">
    <header v-if="submissionOnly" class="submit-panel__compact-header"><div><strong>提交与记录</strong><span>{{ store.currentProblem ? `${store.currentProblem.id} · ${store.currentLanguage}` : '请选择代码标签' }}</span></div></header>
    <DebugPanel v-if="!submissionOnly && store.runnerMode === 'debug'" />
    <template v-else>
    <section v-if="!submissionOnly" class="submit-pane submit-pane--runner" :style="{ height: `${runnerHeight}px` }"><div class="runner">
      <div class="runner__heading">
        <div class="runner__heading-title">
          <span>本地测试 · {{ store.testCases.length }} 组</span>
          <span
            v-if="store.allTestRunSummary"
            class="all-tests-status"
            :class="`all-tests-status--${store.allTestRunSummary.status}`"
          >{{ store.allTestRunSummary.text }}</span>
        </div>
        <button class="runner__add" title="新建一组空测试数据" @click="store.addTestCase()">＋ 新建</button>
      </div>
      <div class="runner__toolbar">
        <button class="run-btn" :disabled="store.isRunning || !store.currentCode.trim() || !store.testCases.length" @click="store.runAllTestCases">
          {{ store.isRunning ? '运行中…' : '▶ 运行全部' }}
        </button>
      </div>
      <div class="runner__cases">
        <section
          v-for="(test, index) in store.testCases"
          :key="test.id"
          class="test-case"
          :class="{ 'test-case--active': store.activeTestCaseId === test.id }"
          @click="store.selectTestCase(test.id)"
        >
          <div class="test-case__heading">
            <strong>测试点 {{ index + 1 }}</strong>
            <span class="test-status" :class="testStatusInfo[test.status].className">{{ testStatusInfo[test.status].text }}</span>
            <span v-if="test.durationMs != null" class="test-case__time">
              <template v-if="test.compileDurationMs">编译 {{ test.compileDurationMs }} ms · </template>运行 {{ test.durationMs }} ms
            </span>
            <button class="test-case__run" :disabled="store.isRunning || !store.currentCode.trim()" @click.stop="store.runTestCase(test.id)">▶</button>
            <button class="test-case__delete" title="删除测试点" @click.stop="store.removeTestCase(test.id)">×</button>
          </div>
          <div class="io-box">
            <div class="io-box__heading"><span>输入</span><button @click.stop="copyBox(test.input, `${test.id}:input`)">{{ copiedBox === `${test.id}:input` ? '已复制' : '复制' }}</button></div>
            <textarea v-model="test.input" spellcheck="false" placeholder="输入数据" @focus="store.selectTestCase(test.id)" @input="store.updateTestCase(test.id)" />
          </div>
          <div class="io-box">
            <div class="io-box__heading"><span>预期输出</span><button @click.stop="copyBox(test.expectedOutput, `${test.id}:expected`)">{{ copiedBox === `${test.id}:expected` ? '已复制' : '复制' }}</button></div>
            <textarea v-model="test.expectedOutput" spellcheck="false" placeholder="填写后将自动对比；留空则只运行" @input="store.updateTestCase(test.id)" />
          </div>
          <div class="io-box" :class="{ 'io-box--passed': test.status === 'passed', 'io-box--failed': test.status === 'failed' || test.status === 'error' }">
            <div class="io-box__heading"><span>实际输出</span><button @click.stop="copyBox(test.actualOutput, `${test.id}:actual`)">{{ copiedBox === `${test.id}:actual` ? '已复制' : '复制' }}</button></div>
            <textarea :value="test.actualOutput" readonly spellcheck="false" placeholder="运行后显示程序输出" />
          </div>
        </section>
      </div>
      <button class="debug-btn" :disabled="store.isDebugging || !store.currentCode.trim()" @click="handleDebug">
        {{ `◆ 打开调试器 (${store.breakpoints.length} 个断点)` }}
      </button>
      <div v-if="store.debugResult" class="runner__result" :class="store.debugResult.success ? 'runner__result--ok' : 'runner__result--error'">
        <div class="runner__result-title">{{ store.debugResult.adapter }} · {{ store.debugResult.durationMs }} ms</div>
        <pre v-if="store.debugResult.output">{{ store.debugResult.output }}</pre>
        <pre v-if="store.debugResult.stdout">程序输出：\n{{ store.debugResult.stdout }}</pre>
        <pre v-if="store.debugResult.stderr" class="runner__stderr">{{ store.debugResult.stderr }}</pre>
        <div v-if="store.debugResult.diagnostic" class="runner__diagnostic">{{ store.debugResult.diagnostic }}</div>
      </div>
    </div></section>

    <div v-if="!submissionOnly" class="submit-panel__divider" title="拖动调整本地测试区域大小" @pointerdown="startPaneResize('runner', $event)" />

    <!-- 操作区 -->
    <section class="submit-pane submit-pane--actions" :style="{ height: submissionOnly ? 'auto' : `${actionsHeight}px` }"><div class="submit-panel__actions">
      <h3 class="submit-panel__heading">提交</h3>
      <button
        v-if="store.currentProblem?.platform === 'codeforces'"
        class="submit-btn"
        :class="{
          'submit-btn--disabled': !store.currentProblem || !store.currentCode.trim(),
          'submit-btn--running': store.isSubmitting,
        }"
        :disabled="!store.currentProblem || !store.currentCode.trim() || store.isSubmitting || !!store.cfManualConfirmation"
        @click="handleSubmit"
      >
        <span v-if="store.isSubmitting" class="spinner" />
        {{ store.isSubmitting ? '正在打开…' : store.cfManualConfirmation ? '请先确认上次提交结果' : '复制代码并打开 CF 提交页 ↗' }}
      </button>
      <template v-else-if="store.currentProblem?.platform === 'luogu'">
        <div v-if="store.luoguCaptchaImage && store.currentProblem?.id === store.luoguCaptchaProblemId" class="captcha-box">
          <img :src="store.luoguCaptchaImage" alt="洛谷验证码" />
          <input v-model="store.luoguCaptcha" autocomplete="off" placeholder="输入图形验证码" @keyup.enter="store.submitLuogu" />
          <button class="submit-btn" :disabled="store.isSubmitting || !store.luoguCaptcha.trim()" @click="store.submitLuogu">{{ store.isSubmitting ? '提交中…' : '验证并提交' }}</button>
          <button class="submit-btn submit-btn--external" @click="store.cancelLuoguCaptcha">取消本次提交</button>
        </div>
        <button v-else-if="store.luoguCaptchaImage" class="submit-btn" disabled>请先完成 {{ store.luoguCaptchaProblemId }} 的验证码</button>
        <button v-else class="submit-btn" :disabled="store.isSubmitting || !store.currentCode.trim()" @click="store.submitLuogu">{{ store.isSubmitting ? '等待洛谷评测…' : '🚀 提交到洛谷' }}</button>
      </template>
      <button v-else-if="store.currentProblem?.platform === 'atcoder'" class="submit-btn" :disabled="!store.currentProblem?.url || !store.currentCode.trim() || store.isSubmitting || !!store.cfManualConfirmation" @click="handleSubmit">{{ store.isSubmitting ? '正在打开…' : store.cfManualConfirmation ? '请先确认上次提交结果' : '复制代码并打开 AtCoder ↗' }}</button>
      <button v-else class="submit-btn submit-btn--external" :disabled="!store.currentProblem?.url" @click="openOriginalOj">在原 OJ 打开提交页 ↗</button>
      <div v-if="store.currentProblem?.platform === 'codeforces'" class="submit-panel__notice">提交前会检测登录状态。代码将复制到剪贴板并打开 Codeforces 官方提交页；账号管理请使用顶部“设置”。</div>
      <div v-if="store.cfManualConfirmation" class="cf-confirm">
        <strong>{{ store.cfManualConfirmation.problemId }} 提交后是否 AC？</strong>
        <span>只有确认 AC 后，题目才会标记为完成。</span>
        <div>
          <button class="cf-confirm__yes" @click="store.confirmCfSubmission(true)">✓ 已 AC</button>
          <button class="cf-confirm__no" @click="store.confirmCfSubmission(false)">尚未 AC</button>
        </div>
      </div>
      <div v-if="store.currentProblem?.platform === 'atcoder'" class="submit-panel__notice">代码会复制到剪贴板，并在隔离进程中打开 AtCoder 官方提交页；网页异常不会阻塞主程序。</div>
      <div v-if="store.currentProblem?.platform === 'luogu'" class="submit-panel__notice">提交前会检测登录状态。需要验证码时会在这里显示；账号管理请使用顶部“设置”。</div>
      <div v-if="store.lastSubmitError" class="submit-panel__error">
        {{ store.lastSubmitError }}
      </div>
      <div class="submit-panel__info">
        <span v-if="store.currentProblem">
          {{ store.currentProblem.id }} · {{ store.currentLanguage }}
        </span>
        <span v-else class="text-dim">未选择题目</span>
      </div>
    </div></section>

    <div v-if="!submissionOnly" class="submit-panel__divider" title="拖动调整提交按钮区域大小" @pointerdown="startPaneResize('actions', $event)" />

    <!-- 提交记录 -->
    <div class="submit-panel__records">
      <h3 class="submit-panel__heading">提交记录</h3>
      <div v-if="store.currentSubmissions.length === 0" class="submit-panel__empty">
        暂无提交记录
      </div>
      <ul class="submit-list">
        <li
          v-for="sub in store.currentSubmissions"
          :key="sub.id"
          class="submit-item"
          :class="{ 'submit-item--clickable': sub.platform === 'luogu' }"
          :title="sub.platform === 'luogu' ? (sub.remoteId ? `查看洛谷记录 R${sub.remoteId} 的测试点详情` : '自动查找这条旧版洛谷记录') : ''"
          @click="openRecordDetail(sub)"
        >
          <span
            class="submit-item__status"
            :style="{ color: (statusInfo[sub.status] || statusInfo.Failed).color }"
          >
            {{ (statusInfo[sub.status] || statusInfo.Failed).text }}
          </span>
          <span class="submit-item__lang">{{ sub.language }}</span>
          <span
            v-if="sub.timeMs"
            class="submit-item__detail"
          >{{ sub.timeMs }}ms</span>
          <span
            v-if="sub.memoryBytes"
            class="submit-item__detail"
          >{{ formatMem(sub.memoryBytes) }}</span>
          <span class="submit-item__time">
            {{ new Date(sub.timestamp).toLocaleTimeString() }}
          </span>
          <span v-if="sub.message" class="submit-item__message" :title="sub.message">{{ sub.message }}</span>
        </li>
      </ul>
    </div>
    </template>
    <div v-if="selectedSubmission" class="record-modal" @click.self="closeRecordDetail">
      <section class="record-card">
        <header><div><strong>{{ selectedSubmission.remoteId ? `R${selectedSubmission.remoteId} 记录详情` : '记录详情' }}</strong><span>{{ selectedSubmission.problemId }} · 洛谷</span></div><button @click="closeRecordDetail">×</button></header>
        <div v-if="recordDetailLoading" class="record-state">正在读取洛谷评测记录…</div>
        <div v-else-if="recordDetailError" class="record-state record-state--error"><span>{{ recordDetailError }}</span><button v-if="selectedSubmission.remoteId" @click="openRecordDetail(selectedSubmission)">重试</button></div>
        <div v-else-if="recordDetail" class="record-content">
          <div class="record-summary">
            <div><span>所属题目</span><strong>{{ recordDetail.problemId }} {{ recordDetail.problemTitle }}</strong></div>
            <div><span>评测状态</span><strong :class="luoguStatusClass(recordDetail.status)">{{ luoguStatus[recordDetail.status]?.name || `状态 ${recordDetail.status}` }}</strong></div>
            <div><span>评测分数</span><strong>{{ recordDetail.score ?? selectedSubmission.score ?? '-' }}</strong></div>
            <div><span>提交时间</span><strong>{{ recordDetail.submitTime ? new Date(recordDetail.submitTime).toLocaleString() : new Date(selectedSubmission.timestamp).toLocaleString() }}</strong></div>
            <div><span>语言</span><strong>{{ selectedSubmission.language }}</strong></div>
            <div><span>代码长度</span><strong>{{ recordDetail.sourceCodeLength != null ? `${recordDetail.sourceCodeLength} B` : '-' }}</strong></div>
            <div><span>用时 / 内存</span><strong>{{ recordDetail.timeMs ?? selectedSubmission.timeMs ?? '-' }} ms / {{ formatMem(recordDetail.memoryBytes ?? selectedSubmission.memoryBytes) || '-' }}</strong></div>
            <div class="record-summary__empty" aria-hidden="true"></div>
          </div>
          <section v-if="recordDetail.subtasks.length" class="remote-tests"><h3>测试点信息</h3><div v-for="subtask in recordDetail.subtasks" :key="subtask.id" class="remote-subtask"><h4>Subtask #{{ subtask.id }} <span>{{ subtask.score }} 分</span></h4><div class="remote-grid"><article v-for="test in subtask.testCases" :key="test.id" :class="luoguStatusClass(test.status)" :title="[test.description, test.signal ? `Signal ${test.signal}` : '', test.exitCode ? `Exit ${test.exitCode}` : ''].filter(Boolean).join('\n')"><small>#{{ test.id }}</small><b>{{ luoguStatus[test.status]?.short || test.status }}</b><span>{{ test.timeMs }}ms / {{ formatMem(test.memoryBytes) }}</span><em v-if="test.score">{{ test.score }} 分</em></article></div></div></section>
          <div v-else class="record-state">该记录没有返回逐测试点信息。</div>
          <section v-if="recordDetail.compileMessage" class="compile-detail"><h3>编译信息</h3><pre>{{ recordDetail.compileMessage }}</pre></section>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped lang="scss">
.submit-panel {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--color-bg-app);
  overflow: hidden;

  &__actions {
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    box-sizing: border-box;
    height: 100%;
    overflow-y: auto;
  }

  &__compact-header {
    flex: 0 0 auto;
    padding: 10px 12px;
    border-bottom: 1px solid var(--color-border);
    div { display: flex; flex-direction: column; gap: 2px; }
    strong { color: var(--color-text-strong); font-size: 12px; }
    span { overflow: hidden; color: var(--color-text-faint); font-size: 8px; text-overflow: ellipsis; white-space: nowrap; }
  }

  &__error {
    padding: 8px 10px;
    background: var(--color-tone-3a1b1b);
    border: 1px solid var(--color-danger-strong);
    border-radius: 6px;
    color: var(--color-danger-strong);
    font-size: 12px;
    word-break: break-all;
    line-height: 1.5;
  }

  &__info {
    font-size: 12px;
    color: var(--color-text-muted);
    text-align: center;
    font-family: 'Consolas', 'Courier New', monospace;
  }

  &__divider {
    position: relative;
    z-index: 5;
    height: 7px;
    margin: -3px 0;
    border-block: 3px solid var(--color-bg-app);
    background: var(--color-border);
    flex: 0 0 7px;
    cursor: row-resize;
    transition: background .12s;
    &:hover { background: var(--color-accent); }
  }

  &__records {
    flex: 1;
    min-height: 90px;
    overflow-y: auto;
    padding: 12px 16px;
  }

  &__heading {
    margin: 0 0 10px;
    font-size: 13px;
    font-weight: 600;
    color: var(--color-tone-cccccc);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  &__empty {
    font-size: 13px;
    color: var(--color-tone-6a6a6a);
    text-align: center;
    padding: 24px 0;
  }
}
.submit-pane { flex: 0 0 auto; min-height: 0; overflow: hidden; &--runner { min-height: 150px; } &--actions { min-height: 125px; } }
.cf-confirm { display: flex; flex-direction: column; gap: 7px; padding: 10px; border: 1px solid var(--color-tone-3d7e58); border-radius: 6px; background: var(--color-tone-183023); color: var(--color-tone-d5ebdc); font-size: 12px; span { color: var(--color-tone-9ab3a2); font-size: 10px; } div { display: flex; gap: 7px; } button { flex: 1; padding: 7px; border: 0; border-radius: 4px; color: var(--color-text-on-accent); cursor: pointer; } &__yes { background: var(--color-tone-27834b); } &__no { background: var(--color-border-strong); } }

.runner {
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  box-sizing: border-box;
  height: 100%;
  min-height: 0;
  overflow: hidden;

  &__heading { display: flex; align-items: center; justify-content: space-between; color: var(--color-tone-cccccc); font-size: 13px; font-weight: 600; }
  &__heading-title { display: flex; min-width: 0; align-items: center; gap: 7px; }
  &__add { padding: 2px 7px; border: 1px solid var(--color-accent-border); border-radius: 4px; background: var(--color-tone-233544); color: var(--color-accent-text); font-size: 10px; cursor: pointer; }
  &__toolbar { display: flex; gap: 7px; .run-btn { flex: 1; } }
  &__cases { display: flex; flex-direction: column; gap: 9px; min-height: 0; overflow-y: auto; padding-right: 3px; scrollbar-gutter: stable; }
  &__result { min-height: 48px; max-height: 150px; overflow: auto; padding: 8px; border-radius: 4px; background: var(--color-bg-deep); border-left: 3px solid var(--color-danger-strong); }
  &__result--ok { border-left-color: var(--color-success); }
  &__result-title { margin-bottom: 5px; color: var(--color-text-muted); font-size: 11px; }
  pre { margin: 0; color: var(--color-text-primary); font: 12px/1.45 Consolas, monospace; white-space: pre-wrap; word-break: break-word; }
  .runner__stderr { color: var(--color-danger); }
}

.all-tests-status { padding: 2px 6px; border-radius: 4px; background: var(--color-bg-subtle); color: var(--color-accent-text); font-size: 9px; font-weight: 500; white-space: nowrap; &--passed { background: var(--color-tone-193428); color: var(--color-success); } &--failed { background: var(--color-tone-3a2020); color: var(--color-danger); } }

.test-case { padding: 8px; border: 1px solid var(--color-tone-353535); border-radius: 6px; background: var(--color-tone-232323); cursor: default; &--active { border-color: var(--color-accent-border); } }
.test-case__heading { display: flex; align-items: center; gap: 6px; margin-bottom: 7px; color: var(--color-tone-ccc); font-size: 11px; strong { white-space: nowrap; } }
.test-case__time { margin-left: auto; color: var(--color-text-faint); font-size: 9px; white-space: nowrap; }
.test-case__run, .test-case__delete { width: 24px; height: 22px; padding: 0; border: 1px solid var(--color-border-control); border-radius: 3px; background: var(--color-bg-subtle); color: var(--color-text-secondary); cursor: pointer; &:disabled { opacity: .4; cursor: not-allowed; } }
.test-case__run { color: var(--color-tone-80c783); }.test-case__delete:hover { border-color: var(--color-tone-8b4242); color: var(--color-danger); }
.test-status { padding: 1px 5px; border-radius: 3px; background: var(--color-bg-subtle); color: var(--color-tone-888); font-size: 9px; white-space: nowrap; &--running { color: var(--color-accent-text); } &--passed { background: var(--color-tone-193428); color: var(--color-success); } &--failed, &--error { background: var(--color-tone-3a2020); color: var(--color-danger); } &--completed { color: var(--color-warning); } }
.io-box { margin-top: 6px; border: 1px solid var(--color-border-soft); border-radius: 4px; overflow: hidden; background: var(--color-bg-deep); &--passed { border-color: var(--color-tone-315b4c); } &--failed { border-color: var(--color-tone-6b3636); } textarea { display: block; width: 100%; min-height: 58px; max-height: 180px; resize: vertical; box-sizing: border-box; padding: 7px; border: 0; outline: none; background: var(--color-bg-deep); color: var(--color-text-primary); font: 11px/1.4 Consolas, monospace; overflow: auto; } textarea:focus { box-shadow: inset 0 0 0 1px var(--color-accent-border); } }
.io-box__heading { display: flex; align-items: center; justify-content: space-between; padding: 4px 6px; border-bottom: 1px solid var(--color-bg-subtle); background: var(--color-bg-control-alt); color: var(--color-tone-999); font-size: 9px; button { padding: 1px 5px; border: 0; background: transparent; color: var(--color-tone-75a9cf); font-size: 9px; cursor: pointer; } }
.io-box__stderr { max-height: 90px; overflow: auto; margin: 0; padding: 6px 7px; border-top: 1px solid var(--color-danger-border); color: var(--color-danger) !important; background: var(--color-tone-261b1b); white-space: pre-wrap !important; }

.run-btn { padding: 8px; border: none; border-radius: 5px; background: var(--color-tone-2e7d32); color: var(--color-text-on-accent); cursor: pointer; }
.run-btn:hover:not(:disabled) { background: var(--color-tone-388e3c); }
.run-btn:disabled { opacity: .45; cursor: not-allowed; }
.debug-btn { padding: 8px; border: 1px solid var(--color-tone-7950a2); border-radius: 5px; background: var(--color-tone-352443); color: var(--color-purple); cursor: pointer; }
.debug-btn:hover:not(:disabled) { background: var(--color-tone-49305d); }.debug-btn:disabled { opacity: .45; cursor: not-allowed; }
.runner__diagnostic { margin-top: 6px; color: var(--color-warning); font-size: 10px; line-height: 1.4; }

.submit-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  width: 100%;
  padding: 10px 0;
  border: none;
  border-radius: 6px;
  background: var(--color-accent-strong);
  color: var(--color-text-on-accent);
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s, opacity 0.15s;

  &:hover:not(:disabled) {
    background: var(--color-accent-hover);
  }

  &:active:not(:disabled) {
    background: var(--color-tone-0d5689);
  }

  &--disabled,
  &:disabled {
    background: var(--color-border);
    color: var(--color-text-muted);
    cursor: not-allowed;
  }

  &--running {
    background: var(--color-accent-strong);
    cursor: wait;
  }
}
.submit-btn--external { background: var(--color-border-control); }
.submit-panel__notice { color: var(--color-text-muted); font-size: 10px; line-height: 1.45; text-align: center; }
.captcha-box { display: grid; grid-template-columns: 92px 1fr; gap: 6px; width: 100%; img { width: 92px; height: 38px; object-fit: contain; background: var(--color-media-canvas); border-radius: 4px; } input { min-width: 0; padding: 7px; border: 1px solid var(--color-border-strong); border-radius: 4px; background: var(--color-bg-deep); color: var(--color-tone-eee); } .submit-btn { grid-column: 1 / -1; } }

.submit-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.submit-item {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  padding: 8px 10px;
  background: var(--color-bg-panel);
  border-radius: 4px;
  font-size: 12px;

  &--clickable { cursor: pointer; &:hover { background: var(--color-tone-2e2e31); outline: 1px solid var(--color-accent-border); } }

  &__status {
    font-weight: 600;
    min-width: 70px;
  }

  &__lang {
    font-family: 'Consolas', 'Courier New', monospace;
    color: var(--color-accent-text);
    background: var(--color-bg-control);
    padding: 1px 6px;
    border-radius: 3px;
    font-size: 11px;
  }

  &__detail {
    color: var(--color-text-muted);
    font-family: 'Consolas', 'Courier New', monospace;
    font-size: 11px;
  }

  &__time {
    color: var(--color-text-muted);
    font-family: 'Consolas', 'Courier New', monospace;
    margin-left: auto;
  }

  &__message { flex-basis: 100%; overflow: hidden; color: var(--color-warning); font-size: 10px; white-space: nowrap; text-overflow: ellipsis; }
}

.record-modal { position: fixed; inset: 36px 0 0; z-index: 1700; display: flex; align-items: center; justify-content: center; padding: 24px; background: var(--color-overlay-strong); }.record-card { display: flex; width: min(920px, 92vw); max-height: 88vh; flex-direction: column; overflow: hidden; border: 1px solid var(--color-border-input); border-radius: 9px; background: var(--color-bg-panel-alt); color: var(--color-text-primary); box-shadow: 0 22px 75px var(--color-tone-000c); > header { display: flex; align-items: center; justify-content: space-between; padding: 15px 18px; border-bottom: 1px solid var(--color-tone-3b3b3b); > div { display: flex; flex-direction: column; gap: 3px; } strong { color: var(--color-tone-6cbcff); font-size: 20px; } span { color: var(--color-text-muted); font-size: 10px; } button { border: 0; background: transparent; color: var(--color-text-soft); font-size: 24px; cursor: pointer; } } }.record-content { overflow-y: auto; padding: 18px; }.record-summary { display: grid; grid-template-columns: 1fr 1fr; gap: 1px; overflow: hidden; border: 1px solid var(--color-tone-363636); border-radius: 6px; background: var(--color-tone-363636); > div { display: grid; grid-template-columns: 90px 1fr; align-items: center; padding: 9px 11px; background: var(--color-bg-panel); font-size: 12px; span { color: var(--color-tone-888); } strong { overflow: hidden; font-weight: 500; text-overflow: ellipsis; white-space: nowrap; } } > .record-summary__empty { background: var(--color-bg-panel-alt); } }.accepted { color: var(--color-tone-52d11a) !important; }.rejected { color: var(--color-danger) !important; }.judging { color: var(--color-warning) !important; }.record-state { display: flex; min-height: 180px; align-items: center; justify-content: center; gap: 12px; padding: 25px; color: var(--color-text-muted); &--error { color: var(--color-danger); } button { padding: 6px 12px; border: 0; border-radius: 4px; background: var(--color-accent-strong); color: var(--color-text-on-accent); cursor: pointer; } }.remote-tests { margin-top: 20px; > h3 { margin: 0 0 13px; font-size: 18px; } }.remote-subtask { margin-bottom: 17px; h4 { margin: 0 0 8px; color: var(--color-tone-ccc); font-size: 13px; span { margin-left: 6px; color: var(--color-text-muted); font-size: 10px; font-weight: 400; } } }.remote-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(125px, 1fr)); gap: 8px; article { display: flex; min-height: 92px; flex-direction: column; align-items: center; justify-content: center; border-radius: 4px; background: var(--color-border-control); color: var(--color-text-on-accent) !important; small { align-self: flex-start; margin: -4px 0 8px 9px; font-size: 9px; } b { font-size: 23px; } span { margin-top: 8px; font: 10px Consolas, monospace; } em { margin-top: 3px; font-size: 9px; font-style: normal; } &.accepted { background: var(--color-tone-35a616); } &.rejected { background: var(--color-tone-a33b3b); } &.judging { background: var(--color-tone-796a24); } } }.compile-detail { margin-top: 18px; border-top: 1px solid var(--color-tone-3b3b3b); h3 { font-size: 15px; } pre { max-height: 180px; overflow: auto; padding: 10px; border-radius: 5px; background: var(--color-bg-deep); color: var(--color-text-strong); font: 11px/1.45 Consolas, monospace; white-space: pre-wrap; } }

.text-dim {
  color: var(--color-tone-6a6a6a);
}

.spinner {
  display: inline-block;
  width: 14px;
  height: 14px;
  border: 2px solid var(--color-tone-rgba-255-255-255-0-3);
  border-top-color: var(--color-text-on-accent);
  border-radius: 50%;
  animation: spin 0.6s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}
</style>
