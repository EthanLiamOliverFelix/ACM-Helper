<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { useProblemStore } from '../stores/problemStore'
import type { CodeHistory, CodeHistoryCheckout, CodeSnapshot } from '../types'

const store = useProblemStore()
const open = ref(false)
const loading = ref(false)
const busy = ref(false)
const error = ref('')
const snapshotName = ref('')
const branchName = ref('')
const history = ref<CodeHistory | null>(null)
const activeBranch = computed(() => history.value?.branches.find((branch) => branch.name === history.value?.activeBranch))

function context() {
  const problem = store.currentProblem
  if (!problem) throw new Error('请先打开一道题目或本地代码文件')
  return { platform: problem.platform, problemId: problem.id, language: store.currentLanguage }
}

async function show() {
  open.value = true
  loading.value = true
  error.value = ''
  try { history.value = await invoke<CodeHistory>('load_code_history', context()) }
  catch (cause) { error.value = cause instanceof Error ? cause.message : String(cause) }
  finally { loading.value = false }
}

async function saveSnapshot() {
  if (!snapshotName.value.trim() || busy.value) return
  busy.value = true
  error.value = ''
  try {
    history.value = await invoke<CodeHistory>('create_code_snapshot', { ...context(), name: snapshotName.value, code: store.currentCode })
    snapshotName.value = ''
  } catch (cause) { error.value = cause instanceof Error ? cause.message : String(cause) }
  finally { busy.value = false }
}

async function createBranch() {
  if (!branchName.value.trim() || busy.value) return
  busy.value = true
  error.value = ''
  try {
    history.value = await invoke<CodeHistory>('create_code_branch', { ...context(), name: branchName.value, code: store.currentCode })
    branchName.value = ''
  } catch (cause) { error.value = cause instanceof Error ? cause.message : String(cause) }
  finally { busy.value = false }
}

async function switchBranch(name: string) {
  if (!history.value || name === history.value.activeBranch || busy.value) return
  if (!window.confirm(`切换到分支“${name}”会用该分支的最新版本替换编辑器中的代码，是否继续？`)) return
  busy.value = true
  error.value = ''
  try {
    const result = await invoke<CodeHistoryCheckout>('switch_code_branch', { ...context(), branchName: name })
    history.value = result.history
    store.updateCode(result.code)
    await store.persistDraft()
  } catch (cause) { error.value = cause instanceof Error ? cause.message : String(cause) }
  finally { busy.value = false }
}

async function restoreSnapshot(snapshot: CodeSnapshot) {
  if (!history.value || busy.value) return
  if (!window.confirm(`回退到“${snapshot.name}”会替换编辑器中的代码，是否继续？\n当前代码仍可先另存为一个版本。`)) return
  busy.value = true
  error.value = ''
  try {
    const code = await invoke<string>('restore_code_snapshot', { ...context(), branchName: history.value.activeBranch, snapshotId: snapshot.id })
    store.updateCode(code)
    await store.persistDraft()
    open.value = false
  } catch (cause) { error.value = cause instanceof Error ? cause.message : String(cause) }
  finally { busy.value = false }
}

async function deleteSnapshot(snapshot: CodeSnapshot) {
  if (!history.value || busy.value || !window.confirm(`确认永久删除版本“${snapshot.name}”吗？`)) return
  busy.value = true
  error.value = ''
  try {
    history.value = await invoke<CodeHistory>('delete_code_snapshot', { ...context(), branchName: history.value.activeBranch, snapshotId: snapshot.id })
  } catch (cause) { error.value = cause instanceof Error ? cause.message : String(cause) }
  finally { busy.value = false }
}

async function deleteBranch(name: string) {
  if (!history.value || busy.value || !window.confirm(`确认永久删除分支“${name}”及其中的全部版本吗？`)) return
  busy.value = true
  error.value = ''
  try { history.value = await invoke<CodeHistory>('delete_code_branch', { ...context(), branchName: name }) }
  catch (cause) { error.value = cause instanceof Error ? cause.message : String(cause) }
  finally { busy.value = false }
}

function displayTime(seconds: number) {
  return new Date(seconds * 1000).toLocaleString('zh-CN', { hour12: false })
}

watch(() => [store.currentProblem?.platform, store.currentProblem?.id, store.currentLanguage], () => {
  open.value = false
  history.value = null
})
</script>

<template>
  <button class="version-trigger" :disabled="!store.currentProblem" title="保存、切换或回退本地代码版本" @click="show">⑂ 版本</button>
  <div v-if="open" class="version-modal" @click.self="open = false">
    <section>
      <header><div><strong>代码版本管理</strong><span>{{ store.contextFileName }} · {{ store.currentLanguage }}</span></div><button aria-label="关闭" @click="open = false">×</button></header>
      <div v-if="error" class="version-error">{{ error }}</div>
      <div v-if="loading" class="version-loading">正在读取本地版本库…</div>
      <div v-else-if="history" class="version-body">
        <aside>
          <h3>分支</h3>
          <div class="branch-create"><input v-model="branchName" maxlength="80" placeholder="新分支名称" @keydown.enter="createBranch"><button :disabled="busy || !branchName.trim()" @click="createBranch">创建并进入</button></div>
          <article v-for="branch in history.branches" :key="branch.name" :class="{ active: branch.name === history.activeBranch }">
            <div><b>{{ branch.name }}</b><small>{{ branch.snapshots.length }} 个版本</small></div>
            <button v-if="branch.name !== history.activeBranch" :disabled="busy || !branch.snapshots.length" @click="switchBranch(branch.name)">切换</button>
            <span v-else>当前</span>
            <button v-if="branch.name !== history.activeBranch" class="danger" :disabled="busy" title="删除分支" @click="deleteBranch(branch.name)">删除</button>
          </article>
        </aside>
        <main>
          <h3>{{ history.activeBranch }} 的版本</h3>
          <div class="snapshot-create"><input v-model="snapshotName" maxlength="80" placeholder="输入版本名称，例如：完成二分边界" @keydown.enter="saveSnapshot"><button :disabled="busy || !snapshotName.trim()" @click="saveSnapshot">保存当前版本</button></div>
          <p class="version-hint">提交并获得判题结果后，程序也会自动在当前分支保存“提交时间 + 判题状态”版本。</p>
          <div class="snapshot-list">
            <article v-for="snapshot in [...(activeBranch?.snapshots ?? [])].reverse()" :key="snapshot.id">
              <div><b>{{ snapshot.name }}</b><time>{{ displayTime(snapshot.createdAt) }}</time></div>
              <button :disabled="busy" @click="restoreSnapshot(snapshot)">回退</button>
              <button class="danger" :disabled="busy" @click="deleteSnapshot(snapshot)">删除</button>
            </article>
            <div v-if="!activeBranch?.snapshots.length" class="empty">当前分支还没有版本，先为当前代码命名并保存。</div>
          </div>
        </main>
      </div>
    </section>
  </div>
</template>

<style scoped lang="scss">
.version-trigger { padding: 4px 8px; border: 1px solid var(--color-tone-566c86); border-radius: 4px; background: var(--color-tone-243242); color: var(--color-tone-a9ccec); font-size: 10px; cursor: pointer; white-space: nowrap; &:disabled { opacity: .4; cursor: not-allowed; } }
.version-modal { position: fixed; inset: 36px 0 0; z-index: 1800; display: grid; place-items: center; padding: 24px; background: var(--color-overlay); > section { width: min(920px, 94vw); height: min(650px, 84vh); display: flex; flex-direction: column; overflow: hidden; border: 1px solid var(--color-tone-505050); border-radius: 9px; background: var(--color-bg-app); box-shadow: 0 18px 60px var(--color-overlay-strong); > header { display: flex; align-items: center; padding: 11px 14px; border-bottom: 1px solid var(--color-border); background: var(--color-bg-panel); > div { flex: 1; display: flex; flex-direction: column; gap: 2px; } strong { color: var(--color-text-strong); font-size: 14px; } span { color: var(--color-text-faint); font: 9px Consolas, monospace; } button { border: 0; background: transparent; color: var(--color-text-soft); font-size: 22px; cursor: pointer; } } } }
.version-body { min-height: 0; flex: 1; display: grid; grid-template-columns: 300px 1fr; }
aside, main { min-width: 0; min-height: 0; padding: 15px; overflow: auto; }
aside { border-right: 1px solid var(--color-border); background: var(--color-bg-panel-alt); }
h3 { margin: 0 0 11px; color: var(--color-accent-text); font-size: 13px; }
.branch-create, .snapshot-create { display: flex; gap: 6px; margin-bottom: 13px; }
input { min-width: 0; flex: 1; padding: 7px 9px; border: 1px solid var(--color-border-control); border-radius: 4px; outline: none; background: var(--color-bg-deep); color: var(--color-text-strong); font-size: 11px; &:focus { border-color: var(--color-accent); } }
button { padding: 5px 8px; border: 1px solid var(--color-accent-border); border-radius: 4px; background: var(--color-tone-233544); color: var(--color-accent-text); font-size: 10px; cursor: pointer; &:disabled { opacity: .4; cursor: not-allowed; } &.danger { border-color: var(--color-tone-744848); background: var(--color-tone-382424); color: var(--color-tone-e8aaaa); } }
aside article, .snapshot-list article { display: flex; align-items: center; gap: 7px; padding: 9px; border: 1px solid var(--color-border-soft); border-radius: 5px; margin-bottom: 7px; background: var(--color-tone-252525); &.active { border-color: var(--color-tone-47735b); background: var(--color-tone-203128); } > div { min-width: 0; flex: 1; display: flex; flex-direction: column; gap: 3px; } b { overflow-wrap: anywhere; color: var(--color-text-strong); font-size: 11px; } small, time { color: var(--color-text-faint); font-size: 9px; } > span { color: var(--color-tone-70d6ae); font-size: 9px; } }
.version-hint { margin: -4px 0 12px; color: var(--color-text-faint); font-size: 9px; line-height: 1.5; }
.empty, .version-loading { display: grid; place-items: center; min-height: 160px; color: var(--color-text-faint); font-size: 11px; }
.version-error { padding: 7px 14px; border-bottom: 1px solid var(--color-tone-623939); background: var(--color-danger-surface); color: var(--color-danger); font-size: 10px; }
@media (max-width: 720px) { .version-body { grid-template-columns: 1fr; grid-template-rows: minmax(180px, 40%) 1fr; } aside { border-right: 0; border-bottom: 1px solid var(--color-border); } }
</style>
