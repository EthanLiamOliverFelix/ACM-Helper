<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import { useAiStore } from '../stores/aiStore'
import DOMPurify from 'dompurify'
import { renderLuoguMarkdown } from '../utils/luoguMarkdown'
import { normalizeAiMarkdown } from '../utils/aiMarkdown'
import { stripChatProblemSetBlock } from '../utils/skillPlan'
import { useProblemSetStore } from '../stores/problemSetStore'
import { useProblemStore } from '../stores/problemStore'
import 'katex/dist/katex.min.css'

const ai = useAiStore()
const problemSets = useProblemSetStore()
const problems = useProblemStore()
const messagesEl = ref<HTMLElement | null>(null)
const importedMessages = ref(new Set<number>())
watch(() => ai.messages.length, async () => { await nextTick(); messagesEl.value?.scrollTo({ top: messagesEl.value.scrollHeight, behavior: 'smooth' }) })
function quickAsk(text: string) { ai.draft = text; ai.send() }
function renderMessage(content: string) {
  const html = renderLuoguMarkdown(normalizeAiMarkdown(stripChatProblemSetBlock(content)))
  return DOMPurify.sanitize(html, { USE_PROFILES: { html: true }, ADD_ATTR: ['target'] })
}
function importProblemSet(index: number) {
  const set = ai.messages[index]?.problemSet
  if (!set || importedMessages.value.has(index)) return
  problemSets.importPlan(set.name, set.problems)
  importedMessages.value = new Set([...importedMessages.value, index])
}
</script>

<template>
  <div class="ai-view">
    <header class="ai-header">
      <div class="ai-header__intro"><div class="ai-header__title"><h1>AI 刷题助手</h1><span class="context-file" :title="problems.draftPath || problems.contextFileName"><small>当前上下文</small><b>{{ problems.contextFileName }}</b></span></div><p>可读取当前题目、代码、提交记录、技能进度和最近的 VP 分析。</p></div>
      <button @click="ai.clear">清空对话</button>
    </header>
    <div class="ai-layout">
      <main class="chat">
        <div ref="messagesEl" class="chat__messages">
          <div v-if="!ai.messages.length" class="chat-empty"><strong>从哪里卡住了？</strong><p>你可以让我给一个小提示、检查当前代码、结合技能树推荐具体题目，或直接粘贴 Codeforces 比赛链接进行 VP 知识点分析。</p></div>
          <div v-if="!ai.messages.length" class="quick-actions">
            <button @click="quickAsk('根据我的已完成题目和技能树，推荐接下来适合练习的 3 道题型，并说明原因。')">推荐下一步训练</button>
            <button @click="quickAsk('检查我当前的代码，先只指出最可能的问题位置，不要直接重写代码。')">检查当前代码</button>
            <button @click="quickAsk('分析当前题目的关键知识点，以及我还缺少哪些前置技能。')">分析知识缺口</button>
          </div>
          <article v-for="(message, index) in ai.messages" :key="index" class="message" :class="`message--${message.role}`">
            <span>{{ message.role === 'user' ? '你' : 'AI' }}</span>
            <div class="message__body">
              <div class="message__content" v-html="renderMessage(message.content)" />
              <div v-if="message.problemSet" class="generated-set">
                <div><strong>{{ message.problemSet.name }}</strong><span>{{ message.problemSet.problems.length }} 道题 · 可导入左侧题单</span></div>
                <button :disabled="importedMessages.has(index)" @click="importProblemSet(index)">{{ importedMessages.has(index) ? '✓ 已导入' : '导入题单' }}</button>
              </div>
            </div>
          </article>
          <article v-if="ai.isSending" class="message message--assistant"><span>AI</span><pre>正在思考…</pre></article>
        </div>
        <div v-if="ai.error" class="chat-error">{{ ai.error }}</div>
        <div class="composer">
          <textarea v-model="ai.draft" placeholder="描述你卡住的位置；Ctrl + Enter 发送" @keydown.ctrl.enter.prevent="ai.send" />
          <button :disabled="ai.isSending || !ai.draft.trim() || !ai.model.trim() || !ai.apiKey.trim()" @click="ai.send">发送</button>
        </div>
      </main>
    </div>
  </div>
</template>

<style scoped lang="scss">
.ai-view { flex: 1; height: 100%; min-width: 0; background: #181818; color: #d4d4d4; display: flex; flex-direction: column; }
.ai-header { display: flex; justify-content: space-between; align-items: center; gap: 18px; padding: 22px 28px; border-bottom: 1px solid #333; &__intro { min-width: 0; flex: 1; } &__title { display: flex; min-width: 0; align-items: center; gap: 14px; } h1 { flex: 0 0 auto; margin: 0 0 4px; font-size: 23px; } p { margin: 0; color: #858585; font-size: 12px; } > button { flex: 0 0 auto; background: transparent; border: 1px solid #444; color: #aaa; border-radius: 4px; padding: 6px 10px; cursor: pointer; } }
.context-file { display: flex; min-width: 0; max-width: min(500px, 48vw); align-items: center; gap: 7px; overflow: hidden; padding: 6px 10px; border: 1px solid #3f5363; border-radius: 5px; background: #202a31; color: #c7e7fb; font: 11px Consolas, monospace; white-space: nowrap; small { flex: 0 0 auto; color: #7895a8; font: 9px 'Segoe UI', sans-serif; } b { min-width: 0; overflow: hidden; font-weight: 400; text-overflow: ellipsis; } }
.ai-layout { flex: 1; display: flex; min-height: 0; }
.ai-settings { width: 285px; padding: 20px; border-right: 1px solid #333; overflow-y: auto; h2 { margin: 0 0 12px; font-size: 13px; color: #ccc; } label { display: block; margin-bottom: 11px; color: #858585; font-size: 11px; } input, select { width: 100%; margin-top: 5px; padding: 8px; border: 1px solid #3c3c3c; border-radius: 4px; background: #1e1e1e; color: #ddd; outline: none; } input:focus, select:focus { border-color: #569cd6; } }
.privacy { padding: 8px; border-radius: 4px; background: #252526; color: #858585; font-size: 10px; line-height: 1.5; }
.levels { display: flex; flex-direction: column; gap: 6px; margin-bottom: 18px; button { padding: 8px 10px; text-align: left; border: 1px solid #3c3c3c; background: #1e1e1e; color: #bbb; border-radius: 5px; cursor: pointer; span { display: block; color: #777; font-size: 10px; margin-top: 2px; } } button.active { border-color: #569cd6; background: #264f78; color: white; span { color: #bbb; } } }
.context-card { display: flex; flex-direction: column; gap: 5px; padding: 10px; border-left: 3px solid #4ec9b0; background: #252526; font-size: 11px; span { color: #858585; } }
.chat { flex: 1; display: flex; flex-direction: column; min-width: 0; }.chat__messages { flex: 1; overflow-y: auto; padding: 24px max(24px, calc((100% - 760px)/2)); }.chat-empty { margin: 15vh auto; max-width: 480px; text-align: center; color: #858585; strong { color: #ddd; font-size: 18px; } p { line-height: 1.7; } }
.message { max-width: 760px; margin: 0 auto 18px; display: grid; grid-template-columns: 34px 1fr; gap: 10px; > span { width: 30px; height: 30px; border-radius: 6px; display: grid; place-items: center; background: #0e639c; font-size: 11px; } &__content { min-width: 0; padding: 10px 12px; border-radius: 7px; background: #252526; font: 13px/1.65 'Segoe UI', sans-serif; word-break: break-word; } &--assistant > span { background: #2e7d32; } }
.message__body { min-width: 0; }
.generated-set { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-top: 6px; padding: 9px 11px; border: 1px solid #3b6e90; border-radius: 6px; background: #203545; div { display: flex; flex-direction: column; gap: 2px; } strong { color: #d9efff; font-size: 12px; } span { color: #8eb2ca; font-size: 9px; } button { padding: 6px 10px; border: 0; border-radius: 4px; background: #0e639c; color: white; font-size: 10px; cursor: pointer; &:disabled { background: #315b4c; color: #89d3b7; cursor: default; } } }
.message__content :deep(p) { margin: 0 0 9px; }.message__content :deep(p:last-child) { margin-bottom: 0; }.message__content :deep(pre) { overflow: auto; margin: 9px 0; padding: 10px; border: 1px solid #3a3a3a; border-radius: 5px; background: #181818; font: 12px/1.5 Consolas, monospace; white-space: pre; }.message__content :deep(code) { padding: 1px 4px; border-radius: 3px; background: #181818; font-family: Consolas, monospace; }.message__content :deep(pre code) { padding: 0; background: transparent; }.message__content :deep(table) { width: 100%; border-collapse: collapse; }.message__content :deep(th), .message__content :deep(td) { padding: 5px 8px; border: 1px solid #555; }.message__content :deep(blockquote) { margin: 8px 0; padding-left: 10px; border-left: 3px solid #569cd6; color: #aaa; }.message__content :deep(.katex-display) { overflow-x: auto; overflow-y: hidden; padding: 4px 0; }
.quick-actions { max-width: 620px; margin: -11vh auto 30px; display: flex; justify-content: center; gap: 7px; button { padding: 7px 10px; border: 1px solid #444; border-radius: 5px; background: #252526; color: #bbb; font-size: 11px; cursor: pointer; } button:hover { border-color: #569cd6; } }
.chat-error { margin: 0 24px 8px; padding: 8px 10px; background: #3a1b1b; color: #f48771; border-radius: 4px; font-size: 11px; }
.composer { display: flex; gap: 8px; padding: 14px max(24px, calc((100% - 760px)/2)); border-top: 1px solid #333; textarea { flex: 1; min-height: 62px; max-height: 160px; resize: vertical; padding: 10px; background: #252526; color: #ddd; border: 1px solid #444; border-radius: 6px; outline: none; } textarea:focus { border-color: #569cd6; } button { width: 76px; border: 0; border-radius: 6px; background: #0e639c; color: white; cursor: pointer; } button:disabled { opacity: .4; cursor: not-allowed; } }
</style>
