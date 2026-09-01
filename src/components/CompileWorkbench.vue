<script setup lang="ts">
import { computed, ref } from 'vue'
import { useProblemStore } from '../stores/problemStore'

const store = useProblemStore()
const copied = ref(false)
const message = computed(() => store.runResult?.compileFailed ? store.runResult.stderr : '')

async function copyMessage() {
  if (!message.value) return
  await navigator.clipboard.writeText(message.value)
  copied.value = true
  window.setTimeout(() => { copied.value = false }, 1200)
}

function close() {
  if (store.runResult?.compileFailed) store.runResult = null
}
</script>

<template>
  <section v-if="message" class="compile-workbench">
    <header>
      <div><span class="compile-workbench__icon">×</span><strong>编译问题</strong><small v-if="store.runResult?.compileDurationMs != null">{{ store.runResult.compileDurationMs }} ms</small></div>
      <div><button type="button" @click="copyMessage">{{ copied ? '已复制' : '复制全部' }}</button><button type="button" class="close" title="关闭编译问题" @click="close">×</button></div>
    </header>
    <pre>{{ message }}</pre>
  </section>
</template>

<style scoped lang="scss">
.compile-workbench {
  display: flex;
  flex: 0 0 190px;
  min-height: 110px;
  flex-direction: column;
  overflow: hidden;
  border-top: 1px solid #5a3535;
  background: #181818;
  color: #d4d4d4;

  header { display: flex; flex: 0 0 auto; align-items: center; justify-content: space-between; min-height: 32px; padding: 0 9px 0 11px; border-bottom: 1px solid #353535; background: #202020; font-size: 11px; > div { display: flex; align-items: center; gap: 7px; } strong { color: #f0b1a6; } small { color: #858585; } button { padding: 3px 7px; border: 1px solid #484848; border-radius: 3px; background: #2d2d2d; color: #ccc; font-size: 10px; cursor: pointer; } button.close { border: 0; background: transparent; color: #aaa; font-size: 17px; } }
  pre { flex: 1; min-height: 0; overflow: auto; margin: 0; padding: 10px 12px 14px; color: #f48771; font: 11px/1.55 Consolas, "Cascadia Mono", monospace; white-space: pre-wrap; word-break: break-word; user-select: text; }
  &__icon { display: inline-flex; width: 15px; height: 15px; align-items: center; justify-content: center; border-radius: 50%; background: #a33b3b; color: white; font-size: 12px; font-weight: 700; }
}
</style>
