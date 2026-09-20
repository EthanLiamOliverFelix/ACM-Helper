<script setup lang="ts">
import { computed, ref } from 'vue'
import { useProblemStore } from '../stores/problemStore'
import '@vscode/codicons/dist/codicon.css'

const store = useProblemStore()
const collapsed = ref(new Set<string>())
const copied = ref('')
const passedCount = computed(() => store.testCases.filter(test => test.status === 'passed').length)
const statuses = { idle: '未运行', running: '运行中…', passed: '通过', failed: '答案不同', completed: '已运行', error: '运行错误' }

function toggle(testId: string) {
  const next = new Set(collapsed.value)
  if (next.has(testId)) next.delete(testId)
  else next.add(testId)
  collapsed.value = next
}

async function copy(value: string, key: string) {
  await navigator.clipboard.writeText(value)
  copied.value = key
  window.setTimeout(() => { if (copied.value === key) copied.value = '' }, 1200)
}

function clearAll() {
  if (!store.testCases.length || !window.confirm('确定删除全部测试用例吗？此操作会清空已经填写的输入和输出。')) return
  store.clearTestCases()
}
</script>

<template>
  <section class="test-explorer">
    <div class="problem-summary">
      <strong>{{ store.currentProblem?.id || '未选择题目' }}</strong>
      <span>{{ passedCount }} / {{ store.testCases.length }} 通过</span>
    </div>

    <div v-if="!store.currentProblem" class="empty">打开一个题目或本地代码标签后显示测试点。</div>
    <template v-else>
      <div class="batch-actions">
        <button class="run-all" :disabled="store.isRunning || !store.currentCode.trim() || !store.testCases.length" @click="store.runAllTestCases"><i class="codicon codicon-run-all" />{{ store.isRunning ? '运行中…' : '运行全部' }}</button>
        <button class="delete-all" title="删除全部测试用例" :disabled="!store.testCases.length" @click="clearAll"><i class="codicon codicon-trash" /></button>
      </div>

      <div class="cases">
        <article v-for="(test, index) in store.testCases" :key="test.id" :class="{ active: test.id === store.activeTestCaseId }" @click="store.selectTestCase(test.id)">
          <div class="case-title">
            <button class="collapse" :title="collapsed.has(test.id) ? '展开' : '收起'" @click.stop="toggle(test.id)"><i class="codicon" :class="collapsed.has(test.id) ? 'codicon-chevron-right' : 'codicon-chevron-down'" /></button>
            <strong>TC {{ index + 1 }}</strong>
            <span :class="test.status">{{ statuses[test.status] }}</span>
            <button class="case-run" title="运行当前测试点" :disabled="store.isRunning || !store.currentCode.trim()" @click.stop="store.runTestCase(test.id)"><i class="codicon codicon-play" /></button>
            <button class="case-delete" title="删除测试点" @click.stop="store.removeTestCase(test.id)"><i class="codicon codicon-trash" /></button>
          </div>

          <div v-if="!collapsed.has(test.id)" class="case-body">
            <label><span>输入:</span><button @click.stop="copy(test.input, `${test.id}:input`)">{{ copied === `${test.id}:input` ? '已复制' : '复制' }}</button><textarea v-model="test.input" spellcheck="false" @input="store.updateTestCase(test.id)" /></label>
            <label><span>预期输出:</span><button @click.stop="copy(test.expectedOutput, `${test.id}:expected`)">{{ copied === `${test.id}:expected` ? '已复制' : '复制' }}</button><textarea v-model="test.expectedOutput" spellcheck="false" @input="store.updateTestCase(test.id)" /></label>
            <label v-if="test.status !== 'idle' && test.status !== 'running'" class="actual"><span>实际输出:</span><button @click.stop="copy(test.actualOutput, `${test.id}:actual`)">{{ copied === `${test.id}:actual` ? '已复制' : '复制' }}</button><textarea :value="test.actualOutput" readonly /></label>
          </div>
        </article>

        <button class="add-case" @click="store.addTestCase()"><i class="codicon codicon-add" />新建测试用例</button>
      </div>
    </template>
  </section>
</template>

<style scoped lang="scss">
.test-explorer { height: 100%; min-height: 0; display: flex; flex-direction: column; background: var(--color-bg-app); color: var(--color-text-primary); }
.problem-summary { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 12px 18px; strong { min-width: 0; overflow: hidden; color: var(--color-text-strong); font-size: 20px; text-overflow: ellipsis; white-space: nowrap; } span { flex: 0 0 auto; padding: 7px 10px; border-radius: 6px; background: var(--color-bg-control-alt); color: var(--color-text-soft); font-size: 13px; font-weight: 600; } }
.batch-actions { display: grid; grid-template-columns: minmax(0, 1fr) 44px; gap: 8px; margin: 0 18px 12px; button { height: 40px; border: 0; border-radius: 6px; color: var(--color-text-on-accent); cursor: pointer; &:hover:not(:disabled) { filter: brightness(1.1); } &:disabled { opacity: .4; cursor: not-allowed; } } .run-all { display: flex; align-items: center; justify-content: center; gap: 7px; background: var(--color-accent-strong); font-size: 13px; font-weight: 700; } .delete-all { display: grid; place-items: center; background: var(--color-danger-strong); } .codicon { font-size: 18px; } }
.cases { min-height: 0; overflow-y: auto; padding: 0 10px 22px; }
.cases article { margin-bottom: 10px; overflow: hidden; border: 1px solid var(--color-border-control); border-radius: 5px; background: var(--color-bg-panel); &.active { border-color: var(--color-accent); } }
.case-title { height: 48px; display: flex; align-items: center; gap: 7px; padding: 0 10px; strong { flex: 1; color: var(--color-accent-text); font-size: 15px; } > span { color: var(--color-text-faint); font-size: 12px; &.passed { color: var(--color-success); } &.failed, &.error { color: var(--color-danger); } &.running { color: var(--color-accent-text); } } button { display: grid; place-items: center; border: 0; cursor: pointer; &:disabled { opacity: .4; cursor: not-allowed; } } .collapse { width: 22px; padding: 0; background: transparent; color: var(--color-accent-text); font-size: 17px; } .case-run, .case-delete { width: 36px; height: 36px; border-radius: 6px; color: white; font-size: 20px; } .case-run { background: var(--color-tone-2e7d32); &:hover:not(:disabled) { background: var(--color-tone-388e3c); } } .case-delete { background: var(--color-danger-strong); } }
.case-body { padding: 0 10px 10px; border-top: 1px solid var(--color-border-soft); }
label { display: grid; grid-template-columns: 1fr auto; align-items: center; margin-top: 9px; color: var(--color-text-soft); font-size: 13px; > button { padding: 2px 3px; border: 0; background: transparent; color: var(--color-text-faint); font-size: 10px; cursor: pointer; &:hover { color: var(--color-accent-text); } } &.actual textarea { color: var(--color-code); } }
textarea { grid-column: 1 / -1; box-sizing: border-box; width: 100%; min-height: 58px; margin-top: 4px; resize: vertical; padding: 7px 9px; border: 1px solid var(--color-border); border-radius: 2px; outline: none; background: var(--color-bg-deep); color: var(--color-text-strong); font: 13px/1.45 Consolas, monospace; &:focus { border-color: var(--color-accent); } }
.add-case { width: 100%; display: flex; align-items: center; justify-content: center; gap: 8px; padding: 11px; border: 0; border-radius: 6px; background: var(--color-tone-2e7d32); color: var(--color-text-on-accent); font-size: 14px; font-weight: 700; cursor: pointer; &:hover { background: var(--color-tone-388e3c); } .codicon { font-size: 18px; } }
.empty { padding: 32px 18px; color: var(--color-text-faint); text-align: center; font-size: 12px; line-height: 1.6; }
</style>
