<script setup lang="ts">
import UiIcon from './UiIcon.vue'
import { ref } from 'vue'
import DebugVariableNode from './DebugVariableNode.vue'
import { useProblemStore } from '../stores/problemStore'

const store = useProblemStore()
const newWatch = ref('')
const expanded = ref(new Set<string>())

const watchesOpen = ref(true)
const localsOpen = ref(true)

function toggleExpanded(key: string) {
  const next = new Set(expanded.value)
  if (next.has(key)) next.delete(key); else next.add(key)
  expanded.value = next
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
        <UiIcon name="play" />{{ store.isDebugging && !store.debugSession ? '正在启动调试器…' : store.debugSession?.active ? '重新开始调试' : '开始调试' }}
      </button>

      <div v-if="store.debugSession" class="debug-panel__status" :class="{ ended: !store.debugSession.active }">
        <span>{{ store.debugSession.message }}</span>
        <span v-if="store.debugSession.line">第 {{ store.debugSession.line }} 行<span v-if="store.debugSession.function"> · {{ store.debugSession.function }}</span></span>
      </div>
      <div v-if="store.debugError" class="debug-panel__error">{{ store.debugError }}</div>

      <div class="debug-panel__controls">
        <button :disabled="store.isDebugging || !store.debugSession?.active" title="运行到下一个断点" @click="store.debugAction('continue')"><UiIcon name="play" /><span>下个断点</span></button>
        <button :disabled="store.isDebugging || !store.debugSession?.active" title="执行当前行，但不进入函数" @click="store.debugAction('next')"><UiIcon name="step-over" /><span>下一步</span></button>
        <button :disabled="store.isDebugging || !store.debugSession?.active" title="进入当前行调用的函数" @click="store.debugAction('step')"><UiIcon name="step-into" /><span>步入</span></button>
        <button :disabled="store.isDebugging || !store.debugSession?.active" title="运行到当前函数返回" @click="store.debugAction('finish')"><UiIcon name="step-out" /><span>步出</span></button>
      </div>
      <p v-if="store.debugSession?.active" class="debug-panel__hint">循环内的断点每轮都会命中。要运行到循环后，请移除循环内断点，在循环后设置断点，再点“下个断点”；“步出”会返回调用函数。</p>

      <section class="watch-section">
        <button type="button" class="watch-section__heading" :aria-expanded="watchesOpen" aria-controls="debug-watches" @click="watchesOpen = !watchesOpen"><span><UiIcon :name="watchesOpen ? 'chevron-down' : 'chevron-right'" /> 变量监视</span></button>
        <div v-show="watchesOpen" id="debug-watches">
          <form class="watch-section__add" @submit.prevent="addWatch">
            <input v-model="newWatch" spellcheck="false" placeholder="输入变量或表达式，例如 ans、a[i]" />
            <button :disabled="!newWatch.trim()">＋</button>
          </form>
          <div v-if="!store.watchExpressions.length" class="debug-panel__empty">添加要持续查看的变量或表达式</div>
          <DebugVariableNode v-for="expression in store.watchExpressions" :key="expression" :name="expression" :value="store.debugSession?.watches.find(item => item.name === expression)?.value" :error="store.debugSession?.watches.find(item => item.name === expression)?.error" :node-key="`watch:${expression}`" :expanded="expanded" @toggle="toggleExpanded">
            <button title="移除监视" @click="store.removeWatchExpression(expression)">×</button>
          </DebugVariableNode>
        </div>
      </section>

      <section class="watch-section">
        <button type="button" class="watch-section__heading" :aria-expanded="localsOpen" aria-controls="debug-locals" @click="localsOpen = !localsOpen"><span><UiIcon :name="localsOpen ? 'chevron-down' : 'chevron-right'" /> 局部变量</span></button>
        <div v-show="localsOpen" id="debug-locals">
          <div v-if="!store.debugSession?.variables.length" class="debug-panel__empty">暂停后显示当前作用域中的变量</div>
          <DebugVariableNode v-for="variable in store.debugSession?.variables" :key="variable.name" :name="variable.name" :value="variable.value" :error="variable.error" :node-key="`local:${variable.name}`" :expanded="expanded" @toggle="toggleExpanded" />
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
.debug-panel { flex: 1; min-height: 0; display: flex; flex-direction: column; background: var(--color-bg-app); color: var(--color-tone-ccc); font-size: 13px; }
.debug-panel__header { display: flex; align-items: center; justify-content: space-between; padding: 11px 13px; border-bottom: 1px solid var(--color-border-soft); div { display: flex; flex-direction: column; gap: 2px; } strong { color: var(--color-tone-eee); font-size: 15px; } span { color: var(--color-text-faint); font-size: 12px; } button { padding: 5px 9px; border: 1px solid var(--color-tone-814242); border-radius: 4px; background: var(--color-tone-3b2525); color: var(--color-tone-f1a3a3); font: inherit; cursor: pointer; } }
.debug-panel__body { flex: 1; min-height: 0; overflow-y: auto; padding: 12px; }
.debug-panel__label { display: block; margin-bottom: 5px; color: var(--color-text-soft); font-size: 13px; font-weight: 600; }
textarea { box-sizing: border-box; width: 100%; min-height: 92px; max-height: 210px; resize: vertical; padding: 8px; border: 1px solid var(--color-border-control); border-radius: 5px; outline: none; background: var(--color-bg-deep); color: var(--color-text-strong); font: 13px/1.45 Consolas, monospace; &:focus { border-color: var(--color-tone-6d4d91); } &:disabled { color: var(--color-tone-888); } }
.debug-panel__start { width: 100%; margin-top: 8px; padding: 9px; border: 0; border-radius: 5px; background: var(--color-accent-strong); color: var(--color-text-on-accent); font: inherit; font-weight: 600; cursor: pointer; &:disabled { opacity: .45; cursor: not-allowed; } }
.debug-panel__status { display: flex; justify-content: space-between; gap: 6px; margin-top: 8px; padding: 7px 8px; border-left: 3px solid var(--color-purple); background: var(--color-tone-2b2234); color: var(--color-tone-dcc9ef); font-size: 12px; &.ended { border-color: var(--color-text-faint); background: var(--color-bg-control-alt); color: var(--color-text-soft); } }
.debug-panel__error { margin-top: 8px; padding: 8px; border: 1px solid var(--color-tone-713838); border-radius: 4px; background: var(--color-tone-351d1d); color: var(--color-danger); font-size: 13px; line-height: 1.45; word-break: break-word; }
.debug-panel__controls { display: grid; grid-template-columns: repeat(4, 1fr); gap: 5px; margin: 10px 0 14px; button { min-width: 0; padding: 7px 2px; border: 1px solid var(--color-tone-4c3b5c); border-radius: 4px; background: var(--color-tone-30243b); color: var(--color-purple); font-size: 18px; cursor: pointer; span { display: block; margin-top: 2px; font-family: var(--font-ui); font-size: 12px; } &:disabled { opacity: .35; cursor: not-allowed; } } }
.debug-panel__hint { margin: -6px 0 12px; color: var(--color-text-faint); font-size: 12px; line-height: 1.45; }
.debug-output { margin-top: 12px; border-top: 1px solid var(--color-tone-353535); padding-top: 10px; h3 { margin: 0 0 7px; color: var(--color-text-secondary); font-size: 13px; } }
.watch-section { margin-top: 12px; }
.watch-section__heading { display: block; width: 100%; padding: 10px 0 7px; border: 0; border-top: 1px solid var(--color-tone-353535); background: transparent; color: var(--color-text-secondary); text-align: left; font: inherit; font-weight: 600; cursor: pointer;
  &:hover { border-top-color: var(--color-accent-text); color: var(--color-accent-text); }
  &:focus-visible { outline: 1px solid var(--color-accent-text); outline-offset: 2px; }
}
.watch-section__add { display: flex; gap: 5px; margin-bottom: 6px; input { min-width: 0; flex: 1; padding: 6px 7px; border: 1px solid var(--color-border-control); border-radius: 4px; outline: none; background: var(--color-bg-deep); color: var(--color-text-strong); font: 13px/1.45 Consolas, monospace; &:focus { border-color: var(--color-tone-6d4d91); } } button { width: 32px; border: 1px solid var(--color-tone-4f6f89); border-radius: 4px; background: var(--color-tone-243747); color: var(--color-accent-text); font-size: 16px; cursor: pointer; } }
.debug-panel__empty { padding: 10px 4px; color: var(--color-text-disabled); font-size: 12px; text-align: center; }
.debug-output pre { max-height: 140px; overflow: auto; margin: 0; padding: 7px; background: var(--color-bg-deep); color: var(--color-text-strong); font: 13px/1.45 Consolas, monospace; white-space: pre-wrap; &.error { color: var(--color-danger); } }
</style>
