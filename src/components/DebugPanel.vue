<script setup lang="ts">
import { ref } from 'vue'
import { useProblemStore } from '../stores/problemStore'

const store = useProblemStore()
const newWatch = ref('')
const expanded = ref(new Set<string>())

function splitContainer(value = '') {
  const open = value.indexOf('{')
  const close = value.lastIndexOf('}')
  if (open < 0 || close <= open) return []
  const source = value.slice(open + 1, close)
  const result: string[] = []
  let start = 0; let depth = 0; let quote = ''; let escaped = false
  for (let index = 0; index < source.length; index++) {
    const char = source[index]
    if (quote) {
      if (char === quote && !escaped) quote = ''
      escaped = char === '\\' && !escaped
      if (char !== '\\') escaped = false
      continue
    }
    if (char === '"' || char === "'") { quote = char; continue }
    if ('{[('.includes(char)) depth++
    else if ('}])'.includes(char)) depth--
    else if (char === ',' && depth === 0) { result.push(source.slice(start, index).trim()); start = index + 1 }
  }
  const tail = source.slice(start).trim()
  if (tail) result.push(tail)
  return result.length > 1 || (result.length === 1 && /^\s*\[?\d+\]?\s*=/.test(result[0])) ? result : []
}

function toggleExpanded(key: string) {
  const next = new Set(expanded.value)
  if (next.has(key)) next.delete(key); else next.add(key)
  expanded.value = next
}

function elementLabel(value: string, index: number) {
  const match = value.match(/^\s*(\[[^\]]+\]|[^=]+?)\s*=\s*(.*)$/s)
  return match ? { name: match[1].trim(), value: match[2] } : { name: `[${index}]`, value }
}

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
        <div v-for="expression in store.watchExpressions" :key="expression" class="variable-tree">
          <div class="variable-row">
            <code><button v-if="splitContainer(store.debugSession?.watches.find(item => item.name === expression)?.value).length" class="variable-row__toggle" @click="toggleExpanded(`watch:${expression}`)">{{ expanded.has(`watch:${expression}`) ? '⌄' : '›' }}</button>{{ expression }}</code>
            <span :class="{ error: store.debugSession?.watches.find(item => item.name === expression)?.error }">{{ store.debugSession?.watches.find(item => item.name === expression)?.error || (splitContainer(store.debugSession?.watches.find(item => item.name === expression)?.value).length ? `容器 · ${splitContainer(store.debugSession?.watches.find(item => item.name === expression)?.value).length} 项` : store.debugSession?.watches.find(item => item.name === expression)?.value) || '—' }}</span>
            <button title="移除监视" @click="store.removeWatchExpression(expression)">×</button>
          </div>
          <div v-if="expanded.has(`watch:${expression}`)" class="variable-tree__children"><div v-for="(item, index) in splitContainer(store.debugSession?.watches.find(value => value.name === expression)?.value)" :key="index"><code>{{ elementLabel(item, index).name }}</code><span>{{ elementLabel(item, index).value }}</span></div></div>
        </div>
      </section>

      <section class="watch-section">
        <h3>局部变量</h3>
        <div v-if="!store.debugSession?.variables.length" class="debug-panel__empty">暂停后显示当前作用域中的变量</div>
        <div v-for="variable in store.debugSession?.variables" :key="variable.name" class="variable-tree">
          <div class="variable-row variable-row--local"><code><button v-if="splitContainer(variable.value).length" class="variable-row__toggle" @click="toggleExpanded(`local:${variable.name}`)">{{ expanded.has(`local:${variable.name}`) ? '⌄' : '›' }}</button>{{ variable.name }}</code><span>{{ splitContainer(variable.value).length ? `容器 · ${splitContainer(variable.value).length} 项` : variable.value }}</span></div>
          <div v-if="expanded.has(`local:${variable.name}`)" class="variable-tree__children"><div v-for="(item, index) in splitContainer(variable.value)" :key="index"><code>{{ elementLabel(item, index).name }}</code><span>{{ elementLabel(item, index).value }}</span></div></div>
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
.variable-row__toggle { width: 16px; padding: 0 !important; color: #9cdcfe !important; font-size: 14px; text-align: left; }.variable-tree__children { border-left: 1px solid #4a4a4a; margin-left: 12px; > div { display: grid; grid-template-columns: minmax(55px,.55fr) 1fr; gap: 8px; padding: 5px 8px; border-bottom: 1px solid #2d2d2d; background: #1b1b1b; font: 10px Consolas,monospace; code { color: #d16dce; } span { overflow-wrap: anywhere; color: #b5cea8; } } }
.debug-panel__empty { padding: 10px 4px; color: #666; font-size: 10px; text-align: center; }
.debug-output pre { max-height: 140px; overflow: auto; margin: 0; padding: 7px; background: #181818; color: #ddd; font: 10px/1.45 Consolas, monospace; white-space: pre-wrap; &.error { color: #f48771; } }
</style>
