<script setup lang="ts">
import { ref } from 'vue'
import { useProblemStore } from '../stores/problemStore'

const store = useProblemStore()
const newWatch = ref('')

async function addWatch() {
  const value = newWatch.value
  newWatch.value = ''
  await store.addWatchExpression(value)
}
</script>

<template>
  <section class="debug-panel">
    <header class="debug-panel__header">
      <div><strong>调试</strong><span>{{ store.currentProblem?.id }} · {{ store.currentLanguage }}</span></div>
      <button @click="store.stopDebugSession()">退出调试</button>
    </header>

    <div class="debug-panel__body">
      <label class="debug-panel__label" for="debug-input">输入数据</label>
      <textarea id="debug-input" v-model="store.debugInput" :disabled="!!store.debugSession?.active" spellcheck="false" placeholder="程序的标准输入将在开始调试时一次性提供" />

      <button class="debug-panel__start" :disabled="store.isDebugging || !store.currentCode.trim()" @click="store.startDebugSession">
        {{ store.isDebugging && !store.debugSession ? '正在启动调试器…' : store.debugSession?.active ? '重新开始调试' : '▶ 开始调试' }}
      </button>

      <div v-if="store.debugSession" class="debug-panel__status" :class="{ ended: !store.debugSession.active }">
        <span>{{ store.debugSession.message }}</span>
        <span v-if="store.debugSession.line">第 {{ store.debugSession.line }} 行<span v-if="store.debugSession.function"> · {{ store.debugSession.function }}</span></span>
      </div>
      <div v-if="store.debugError" class="debug-panel__error">{{ store.debugError }}</div>

      <div class="debug-panel__controls">
        <button :disabled="store.isDebugging || !store.debugSession?.active" title="运行到下一个断点" @click="store.debugAction('continue')">▶<span>下个断点</span></button>
        <button :disabled="store.isDebugging || !store.debugSession?.active" title="执行当前行，但不进入函数" @click="store.debugAction('next')">↷<span>下一步</span></button>
        <button :disabled="store.isDebugging || !store.debugSession?.active" title="进入当前行调用的函数" @click="store.debugAction('step')">↓<span>步入</span></button>
        <button :disabled="store.isDebugging || !store.debugSession?.active" title="运行到当前函数返回" @click="store.debugAction('finish')">↑<span>步出</span></button>
      </div>

      <section class="watch-section">
        <h3>变量监视</h3>
        <form class="watch-section__add" @submit.prevent="addWatch">
          <input v-model="newWatch" spellcheck="false" placeholder="输入变量或表达式，例如 ans、a[i]" />
          <button :disabled="!newWatch.trim()">＋</button>
        </form>
        <div v-if="!store.watchExpressions.length" class="debug-panel__empty">添加要持续查看的变量或表达式</div>
        <div v-for="expression in store.watchExpressions" :key="expression" class="variable-row">
          <code>{{ expression }}</code>
          <span :class="{ error: store.debugSession?.watches.find(item => item.name === expression)?.error }">
            {{ store.debugSession?.watches.find(item => item.name === expression)?.error || store.debugSession?.watches.find(item => item.name === expression)?.value || '—' }}
          </span>
          <button title="移除监视" @click="store.removeWatchExpression(expression)">×</button>
        </div>
      </section>

      <section class="watch-section">
        <h3>局部变量</h3>
        <div v-if="!store.debugSession?.variables.length" class="debug-panel__empty">暂停后显示当前作用域中的变量</div>
        <div v-for="variable in store.debugSession?.variables" :key="variable.name" class="variable-row variable-row--local">
          <code>{{ variable.name }}</code><span>{{ variable.value }}</span>
        </div>
      </section>

      <section v-if="store.debugSession?.stdout || store.debugSession?.stderr" class="debug-output">
        <h3>程序输出</h3>
        <pre v-if="store.debugSession.stdout">{{ store.debugSession.stdout }}</pre>
        <pre v-if="store.debugSession.stderr" class="error">{{ store.debugSession.stderr }}</pre>
      </section>
    </div>
  </section>
</template>

<style scoped lang="scss">
.debug-panel { flex: 1; min-height: 0; display: flex; flex-direction: column; background: #1e1e1e; color: #ccc; }
.debug-panel__header { display: flex; align-items: center; justify-content: space-between; padding: 11px 13px; border-bottom: 1px solid #383838; div { display: flex; flex-direction: column; gap: 2px; } strong { color: #eee; font-size: 14px; } span { color: #777; font-size: 9px; } button { padding: 5px 9px; border: 1px solid #814242; border-radius: 4px; background: #3b2525; color: #f1a3a3; cursor: pointer; } }
.debug-panel__body { flex: 1; min-height: 0; overflow-y: auto; padding: 12px; }
.debug-panel__label { display: block; margin-bottom: 5px; color: #aaa; font-size: 11px; font-weight: 600; }
textarea { box-sizing: border-box; width: 100%; min-height: 92px; max-height: 210px; resize: vertical; padding: 8px; border: 1px solid #444; border-radius: 5px; outline: none; background: #181818; color: #ddd; font: 11px/1.45 Consolas, monospace; &:focus { border-color: #6d4d91; } &:disabled { color: #888; } }
.debug-panel__start { width: 100%; margin-top: 8px; padding: 9px; border: 0; border-radius: 5px; background: #0e639c; color: white; font-weight: 600; cursor: pointer; &:disabled { opacity: .45; cursor: not-allowed; } }
.debug-panel__status { display: flex; justify-content: space-between; gap: 6px; margin-top: 8px; padding: 7px 8px; border-left: 3px solid #d7b9f2; background: #2b2234; color: #dcc9ef; font-size: 10px; &.ended { border-color: #777; background: #292929; color: #aaa; } }
.debug-panel__error { margin-top: 8px; padding: 8px; border: 1px solid #713838; border-radius: 4px; background: #351d1d; color: #f48771; font-size: 10px; line-height: 1.45; word-break: break-word; }
.debug-panel__controls { display: grid; grid-template-columns: repeat(4, 1fr); gap: 5px; margin: 10px 0 14px; button { min-width: 0; padding: 7px 2px; border: 1px solid #4c3b5c; border-radius: 4px; background: #30243b; color: #d7b9f2; font-size: 15px; cursor: pointer; span { display: block; margin-top: 2px; font-size: 9px; } &:disabled { opacity: .35; cursor: not-allowed; } } }
.watch-section, .debug-output { margin-top: 12px; border-top: 1px solid #353535; padding-top: 10px; h3 { margin: 0 0 7px; color: #bbb; font-size: 11px; } }
.watch-section__add { display: flex; gap: 5px; margin-bottom: 6px; input { min-width: 0; flex: 1; padding: 6px 7px; border: 1px solid #444; border-radius: 4px; outline: none; background: #181818; color: #ddd; font: 10px Consolas, monospace; &:focus { border-color: #6d4d91; } } button { width: 28px; border: 1px solid #4f6f89; border-radius: 4px; background: #243747; color: #9cdcfe; cursor: pointer; } }
.variable-row { display: grid; grid-template-columns: minmax(65px, .8fr) minmax(0, 1.3fr) 20px; align-items: start; gap: 6px; padding: 6px; border-bottom: 1px solid #303030; background: #222; font-size: 10px; code { overflow: hidden; color: #9cdcfe; text-overflow: ellipsis; } span { overflow-wrap: anywhere; color: #ce9178; font-family: Consolas, monospace; &.error { color: #f48771; } } button { border: 0; background: transparent; color: #777; cursor: pointer; &:hover { color: #f48771; } } &--local { grid-template-columns: minmax(65px, .8fr) minmax(0, 1.3fr); } }
.debug-panel__empty { padding: 10px 4px; color: #666; font-size: 10px; text-align: center; }
.debug-output pre { max-height: 140px; overflow: auto; margin: 0; padding: 7px; background: #181818; color: #ddd; font: 10px/1.45 Consolas, monospace; white-space: pre-wrap; &.error { color: #f48771; } }
</style>
