<script setup lang="ts">
import { useProblemStore } from '../stores/problemStore'
import { computed, ref, watch } from 'vue'
import { useLearningStore } from '../stores/learningStore'
import { useAiStore } from '../stores/aiStore'
import { useNoteStore } from '../stores/noteStore'
import MarkdownNoteEditor from './MarkdownNoteEditor.vue'
import DOMPurify from 'dompurify'
import { renderLuoguMarkdown } from '../utils/luoguMarkdown'
import { normalizeAiMarkdown } from '../utils/aiMarkdown'
import { atCoderVarMarkupToTex } from '../utils/atcoderMath'
import { splitCodeforcesMathText } from '../utils/codeforcesMath'
import { openUrl } from '@tauri-apps/plugin-opener'
import { ojTranslationKey } from '../utils/ojTranslation'
import 'katex/dist/katex.min.css'

const store = useProblemStore()
const learning = useLearningStore()
const ai = useAiStore()
const notes = useNoteStore()
const problemKey = computed(() => store.currentProblem ? `${store.currentProblem.platform}:${store.currentProblem.id}` : '')
const translationKey = computed(() => store.currentProblem ? ojTranslationKey(store.currentProblem.platform, store.currentProblem.id) : '')
const translationSupported = computed(() => {
  const problem = store.currentProblem
  if (!problem || !['codeforces', 'luogu', 'atcoder'].includes(problem.platform)) return false
  if (ai.translations[translationKey.value]) return true
  const source = `${problem.title} ${problem.description ?? ''} ${problem.input ?? ''} ${problem.output ?? ''}`
    .replace(/<[^>]+>/g, ' ')
  const latin = (source.match(/[A-Za-z]/g) ?? []).length
  const cjk = (source.match(/[\u3400-\u9fff]/g) ?? []).length
  return latin >= 24 && latin > cjk * 2
})
const translationError = computed(() => ai.error)
const refreshError = ref('')
const linkError = ref('')
const refreshNotice = ref('')
const copiedSample = ref('')
const noteOpen = ref(false)
const noteMode = ref<'read' | 'edit'>('edit')
const noteLoading = ref(false)
const noteError = ref('')
const statementOpen = ref(false)
const statementMode = ref<'read' | 'edit'>('edit')
const statementDraft = ref('')
const statementSaving = ref(false)
const statementError = ref('')
const statementDirty = computed(() => statementDraft.value !== store.localStatement)
const difficultyColors: Record<string, string> = {
  '暂无评定': 'var(--color-tone-bfbfbf)', '入门': 'var(--color-tone-fe4c61)', '普及-': 'var(--color-tone-f39c11)', '普及': 'var(--color-tone-ffc116)',
  '普及+/提高-': 'var(--color-tone-52c41a)', '提高': 'var(--color-tone-13c2c2)', '提高+/省选-': 'var(--color-tone-3498db)',
  '省选/NOI-': 'var(--color-tone-9d3dcf)', 'NOI/NOI+/CTS': 'var(--color-tone-7187d8)',
}

function safeRichText(value = '', format: 'html' | 'markdown' | 'text' = 'text', baseUrl?: string) {
  let html: string
  if (format === 'markdown') html = renderLuoguMarkdown(normalizeAiMarkdown(value))
  else if (format === 'html') {
    // OJ 页面会同时保留 TeX 源码与 MathJax 的预览节点。统一转为 KaTeX，
    // 但行内公式必须拆掉 Markdown 渲染器额外生成的 <p>，否则浏览器会
    // 自动结束原段落，造成变量各占一行的严重错位。
    const sourceDoc = new DOMParser().parseFromString(`<div id="acm-rich-root">${value}</div>`, 'text/html')
    const sourceRoot = sourceDoc.getElementById('acm-rich-root')!
    sourceRoot.querySelectorAll('.MathJax_Preview,.MathJax_SVG').forEach((node) => node.remove())
    const replaceWithKatex = (node: Element, tex: string, display = false) => {
      if (!tex) return
      const wrapper = sourceDoc.createElement(display ? 'div' : 'span')
      wrapper.innerHTML = renderLuoguMarkdown(display ? `$$${tex}$$` : `$${tex}$`)
      const paragraph = !display && wrapper.childElementCount === 1 && wrapper.firstElementChild?.tagName === 'P'
        ? wrapper.firstElementChild
        : null
      node.replaceWith(...Array.from((paragraph ?? wrapper).childNodes))
    }
    // Codeforces/Polygon embeds inline TeX directly in HTML text as $$$...$$$.
    // Markdown normalization does not run for HTML statements, so replace only
    // matching text-node segments and preserve the surrounding DOM structure.
    const polygonTextNodes: Text[] = []
    const collectPolygonText = (node: Node) => {
      if (node.nodeType === Node.TEXT_NODE && node.textContent?.includes('$$$')) {
        polygonTextNodes.push(node as Text)
        return
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return
      const tag = (node as Element).tagName.toLowerCase()
      if (['code', 'pre', 'script', 'style'].includes(tag)) return
      Array.from(node.childNodes).forEach(collectPolygonText)
    }
    collectPolygonText(sourceRoot)
    for (const textNode of polygonTextNodes) {
      const segments = splitCodeforcesMathText(textNode.data)
      if (!segments.some((segment) => segment.kind === 'math')) continue
      const fragment = sourceDoc.createDocumentFragment()
      for (const segment of segments) {
        if (segment.kind === 'text') fragment.append(sourceDoc.createTextNode(segment.value))
        else {
          const placeholder = sourceDoc.createElement('span')
          fragment.append(placeholder)
          replaceWithKatex(placeholder, segment.value)
        }
      }
      textNode.replaceWith(fragment)
    }
    // AtCoder leaves formulas in <var> tags and relies on its own page script to
    // turn them into MathJax. That script is intentionally not executed here, so
    // render the TeX ourselves. This also repairs previously cached statements.
    sourceRoot.querySelectorAll('var').forEach((variable) => {
      replaceWithKatex(variable, atCoderVarMarkupToTex(variable.innerHTML))
    })
    sourceRoot.querySelectorAll<HTMLScriptElement>('script[type^="math/tex"]').forEach((script) => {
      const display = script.type.toLowerCase().includes('mode=display')
      replaceWithKatex(script, script.textContent ?? '', display)
    })
    html = sourceRoot.innerHTML
  }
  else html = value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br/>')
  const clean = DOMPurify.sanitize(html, { USE_PROFILES: { html: true }, ADD_ATTR: ['target'] })
  // Markdown 经 marked 转换后同样可能保留 `/problem/...`、`/upload/...`
  // 等相对地址；HTML 与 Markdown 都必须以原题地址为基准补全。
  if (!baseUrl) return clean
  const doc = new DOMParser().parseFromString(`<div id="root">${clean}</div>`, 'text/html')
  const root = doc.getElementById('root')!
  root.querySelectorAll<HTMLElement>('[src], [href]').forEach((element) => {
    for (const attr of ['src', 'href']) {
      const raw = element.getAttribute(attr)
      if (!raw || raw.startsWith('#') || raw.startsWith('data:')) continue
      try { element.setAttribute(attr, new URL(raw, baseUrl).href) } catch { /* 保留原值 */ }
    }
  })
  return root.innerHTML
}

const renderedHtml = computed(() => {
  const p = store.currentProblem
  if (!p) return '<p style="color:var(--color-text-muted)">请从左侧列表选择一道题目</p>'
  if (store.isLoadingDetail) return '<div class="desc-placeholder">正在抓取题面和样例…</div>'
  const esc = (value = '') => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  if (!p.description) return `<div class="desc-placeholder">题面抓取失败或暂不可用<br/><a href="${esc(p.url)}" target="_blank">在原 OJ 打开 →</a></div>`
  const translated = ai.translations[ojTranslationKey(p.platform, p.id)]
  if (translated) return safeRichText(translated, 'markdown', p.url)
  const format = p.contentFormat ?? 'text'
  const section = (title: string, value?: string) => value ? `<h2 class="desc-h2">${title}</h2><div>${safeRichText(value, format, p.url)}</div>` : ''
  return `<div>${safeRichText(p.description, format, p.url)}</div>${section('输入', p.input)}${section('输出', p.output)}${section('说明', p.note)}`
})

async function translate() {
  try { await ai.translateCurrentProblem() } catch (e) { ai.error = String(e) }
}

async function retranslate() {
  try { await ai.translateCurrentProblem(true) } catch (e) { ai.error = String(e) }
}

watch(problemKey, async () => {
  const problem = store.currentProblem
  if (!problem || !['codeforces', 'luogu', 'atcoder'].includes(problem.platform)) return
  try { await ai.loadCachedTranslation(problem.id, problem.platform) } catch (e) { ai.error = String(e) }
}, { immediate: true })

async function refreshStatement() {
  refreshError.value = ''
  refreshNotice.value = ''
  try {
    await store.refreshCurrentProblem()
    refreshNotice.value = '题面已重新抓取'
    window.setTimeout(() => { refreshNotice.value = '' }, 2500)
  } catch (e) {
    refreshError.value = typeof e === 'string' ? e : (e as Error)?.message ?? '重新抓取失败'
  }
}

async function openStatementLink(event: MouseEvent) {
  const target = event.target
  if (!(target instanceof Element)) return
  const anchor = target.closest('a[href]') as HTMLAnchorElement | null
  if (!anchor) return

  const href = anchor.getAttribute('href')?.trim() ?? ''
  // 题面目录、脚注等页内锚点仍由当前页面处理。
  if (!href || href.startsWith('#')) return

  event.preventDefault()
  event.stopPropagation()
  linkError.value = ''
  try {
    const url = new URL(href, store.currentProblem?.url)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error(`不支持打开 ${url.protocol} 链接`)
    }
    await openUrl(url.href)
  } catch (cause) {
    linkError.value = cause instanceof Error ? cause.message : String(cause)
  }
}

async function copySample(value: string, key: string) {
  await navigator.clipboard.writeText(value)
  copiedSample.value = key
  window.setTimeout(() => { if (copiedSample.value === key) copiedSample.value = '' }, 1500)
}

function addSampleAsTest(input: string, output: string) {
  store.addTestCase(input, output)
  refreshNotice.value = '已添加到本地测试点'
  window.setTimeout(() => { refreshNotice.value = '' }, 2500)
}

async function openProblemNote() {
  if (!store.currentProblem || noteLoading.value) return
  noteLoading.value = true
  noteError.value = ''
  try {
    await notes.openProblemNote(store.currentProblem)
    noteMode.value = 'edit'
    noteOpen.value = true
  } catch (cause) { noteError.value = String(cause) }
  finally { noteLoading.value = false }
}

async function closeProblemNote() {
  await notes.saveActive().catch((cause) => { noteError.value = String(cause) })
  noteOpen.value = false
}

function openLocalStatement() {
  statementDraft.value = store.localStatement
  statementMode.value = 'edit'
  statementError.value = ''
  statementOpen.value = true
}

async function saveLocalStatement() {
  if (statementSaving.value || !statementDirty.value) return
  statementSaving.value = true
  statementError.value = ''
  try { await store.saveLocalStatement(statementDraft.value) }
  catch (cause) { statementError.value = cause instanceof Error ? cause.message : String(cause); throw cause }
  finally { statementSaving.value = false }
}

async function closeLocalStatement() {
  if (statementDirty.value) {
    try { await saveLocalStatement() } catch { return }
  }
  statementOpen.value = false
}
</script>

<template>
  <div class="problem-desc">
    <div v-if="store.currentProblem" class="problem-desc__header">
      <span class="problem-desc__id">{{ store.currentProblem.id }}</span>
      <span class="problem-desc__title">{{ store.currentProblem.title }}</span>
      <span
        v-if="store.currentProblem.platform === 'luogu' && store.currentProblem.difficulty"
        class="problem-desc__difficulty"
        :class="`difficulty--${store.currentProblem.difficulty!.toLowerCase()}`"
        :style="{ color: difficultyColors[store.currentProblem.difficulty] }"
      >
        {{ store.currentProblem.difficulty }}
      </span>
      <span
        v-if="store.currentProblem.rating"
        class="problem-desc__rating"
      >
        ★ {{ store.currentProblem.rating }}
      </span>
      <span v-if="store.currentProblem.timeLimitMs" class="problem-desc__limit">{{ store.currentProblem.timeLimitMs }} ms</span>
      <span v-if="store.currentProblem.memoryLimitMb" class="problem-desc__limit">{{ store.currentProblem.memoryLimitMb }} MB</span>
      <button class="note-btn" :disabled="noteLoading" title="打开这道题的本地 Markdown 笔记" @click="openProblemNote">{{ noteLoading ? '打开中…' : '📝 题目笔记' }}</button>
      <button
        v-if="store.currentProblem.platform === 'local' && store.draftPath"
        class="statement-edit-btn"
        title="用 Markdown 记录这份本地代码对应的题面"
        @click="openLocalStatement"
      >📄 编辑题面</button>
      <button
        v-if="store.currentProblem.platform !== 'local'"
        class="refresh-btn"
        :disabled="store.isLoadingDetail"
        title="忽略已有题面，重新从原 OJ 抓取；不会影响本地代码"
        @click="refreshStatement"
      >{{ store.isLoadingDetail ? '抓取中…' : '重新抓取' }}</button>
      <button
        v-if="translationSupported && !ai.translations[translationKey]"
        class="translate-btn"
        :disabled="ai.isTranslating || !ai.translationConfigured"
        :title="ai.translationConfigured ? '使用已配置的翻译模型翻译完整题面' : '请先在顶部设置中配置翻译模型'"
        @click="translate"
      >{{ ai.isTranslating ? '翻译中…' : 'AI 翻译' }}</button>
      <button
        v-if="translationSupported && ai.translations[translationKey]"
        class="retranslate-btn"
        :disabled="ai.isTranslating || !ai.translationConfigured"
        :title="ai.translationConfigured ? '重新调用翻译模型并覆盖本地译文' : '请先在顶部设置中配置翻译模型'"
        @click="retranslate"
      >{{ ai.isTranslating ? '重新翻译中…' : '重新翻译' }}</button>
      <span v-if="learning.profile.solvedProblems.includes(problemKey)" class="solved-btn solved-btn--active">✓ 已完成</span>
    </div>
    <div v-else class="problem-desc__header problem-desc__header--empty">
      <span class="problem-desc__title">未选择题目</span>
    </div>
    <div class="problem-desc__content">
      <MarkdownNoteEditor
        v-if="store.currentProblem?.platform === 'local' && store.localStatement.trim() && store.draftPath"
        class="local-statement-view"
        :model-value="store.localStatement"
        :note-path="store.draftPath"
        mode="read"
        readonly
        @click="openStatementLink"
      />
      <div v-else v-html="renderedHtml" @click="openStatementLink" />
      <section v-if="store.currentProblem?.samples?.length" class="statement-samples">
        <article v-for="(sample, index) in store.currentProblem.samples" :key="index" class="statement-sample">
          <div class="statement-sample__heading">
            <h2>样例 {{ index + 1 }}</h2>
            <button title="把这一组输入和预期输出加入右侧本地测试" @click="addSampleAsTest(sample.input, sample.output)">＋ 添加为测试点</button>
          </div>
          <div class="statement-io">
            <div class="statement-io__heading"><span>输入</span><button @click="copySample(sample.input, `${index}:input`)">{{ copiedSample === `${index}:input` ? '已复制' : '复制' }}</button></div>
            <pre>{{ sample.input }}</pre>
          </div>
          <div class="statement-io">
            <div class="statement-io__heading"><span>输出</span><button @click="copySample(sample.output, `${index}:output`)">{{ copiedSample === `${index}:output` ? '已复制' : '复制' }}</button></div>
            <pre>{{ sample.output }}</pre>
          </div>
        </article>
      </section>
    </div>
    <div v-if="refreshNotice" class="problem-desc__notice">{{ refreshNotice }}</div>
    <div v-if="refreshError" class="problem-desc__error">重新抓取失败：{{ refreshError }}（已保留原题面）</div>
    <div v-if="translationError" class="problem-desc__error">{{ translationError }}</div>
    <div v-if="linkError" class="problem-desc__error">链接打开失败：{{ linkError }}</div>
    <div v-if="noteError && !noteOpen" class="problem-desc__error">笔记打开失败：{{ noteError }}</div>

    <div v-if="noteOpen && notes.activeNote" class="problem-note-modal" @click.self="closeProblemNote">
      <section>
        <header>
          <div><strong>{{ store.currentProblem?.id }} · 题目笔记</strong><span :title="notes.activeNote.path">{{ notes.activeNote.path }}</span></div>
          <nav><button :class="{ active: noteMode === 'read' }" @click="notes.saveActive(); noteMode = 'read'">只读</button><button :class="{ active: noteMode === 'edit' }" @click="noteMode = 'edit'">编辑</button><button v-if="noteMode === 'edit'" class="save" :disabled="notes.saving || !notes.dirty" @click="notes.saveActive">{{ notes.saving ? '保存中…' : notes.dirty ? '保存' : '已保存' }}</button><button class="close" aria-label="关闭" @click="closeProblemNote">×</button></nav>
        </header>
        <div v-if="notes.error" class="problem-note-modal__error">{{ notes.error }}</div>
        <MarkdownNoteEditor :model-value="notes.activeNote.content" :mode="noteMode" :note-path="notes.activeNote.path" @update:model-value="notes.updateContent" @save="notes.saveActive" />
      </section>
    </div>

    <div v-if="statementOpen" class="problem-note-modal" @click.self="closeLocalStatement">
      <section>
        <header>
          <div><strong>{{ store.currentProblem?.title }} · 本地题面</strong><span :title="store.draftPath">{{ store.draftPath }}</span></div>
          <nav><button :class="{ active: statementMode === 'read' }" @click="saveLocalStatement().then(() => { statementMode = 'read' }).catch(() => undefined)">预览</button><button :class="{ active: statementMode === 'edit' }" @click="statementMode = 'edit'">编辑</button><button v-if="statementMode === 'edit'" class="save" :disabled="statementSaving || !statementDirty" @click="saveLocalStatement">{{ statementSaving ? '保存中…' : statementDirty ? '保存' : '已保存' }}</button><button class="close" aria-label="关闭" @click="closeLocalStatement">×</button></nav>
        </header>
        <div v-if="statementError" class="problem-note-modal__error">题面保存失败：{{ statementError }}</div>
        <MarkdownNoteEditor v-model="statementDraft" :mode="statementMode" :note-path="store.draftPath" placeholder="粘贴或输入题面，支持 Markdown、LaTeX 公式、图片、表格和代码块…" @save="saveLocalStatement" />
      </section>
    </div>
  </div>
</template>

<style scoped lang="scss">
.local-statement-view { height: auto; }
.problem-desc {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--color-bg-app);
  overflow: hidden;

  &__header {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 14px 20px;
    border-bottom: 1px solid var(--color-border);
    flex-shrink: 0;

    &--empty {
      opacity: 0.5;
    }
  }

  &__id {
    font-family: 'Consolas', 'Courier New', monospace;
    font-size: 12px;
    color: var(--color-text-muted);
    background: var(--color-bg-control);
    padding: 2px 8px;
    border-radius: 4px;
  }

  &__title {
    font-size: 16px;
    font-weight: 600;
    color: var(--color-text-primary);
    flex: 1;
  }

  &__difficulty {
    font-size: 12px;
    font-weight: 600;
    padding: 2px 10px;
    border-radius: 4px;

  }

  &__rating {
    font-size: 12px;
    font-weight: 600;
    padding: 2px 10px;
    border-radius: 4px;
    background: var(--color-tone-3a351b);
    color: var(--color-warning);
  }

  &__limit { font-size: 11px; color: var(--color-text-muted); white-space: nowrap; }

  &__content {
    flex: 1;
    overflow-y: auto;
    padding: 20px;
    font-size: 14px;
    line-height: 1.75;
    color: var(--color-text-primary);

    :deep(.desc-h2) {
      font-size: 18px;
      font-weight: 600;
      color: var(--color-accent);
      margin: 16px 0 8px;
      padding-bottom: 6px;
      border-bottom: 1px solid var(--color-border);
    }

    :deep(.desc-h3) {
      font-size: 15px;
      font-weight: 600;
      color: var(--color-warning);
      margin: 12px 0 6px;
    }

    :deep(.desc-code) {
      background: var(--color-bg-control);
      padding: 1px 6px;
      border-radius: 3px;
      font-family: 'Consolas', 'Courier New', monospace;
      font-size: 13px;
      color: var(--color-code);
    }

    :deep(.desc-table) {
      border-collapse: collapse;
      margin: 8px 0;
      width: 100%;

      td {
        border: 1px solid var(--color-border);
        padding: 6px 12px;
        font-family: 'Consolas', 'Courier New', monospace;
        font-size: 13px;
      }
    }

    :deep(.desc-latex) {
      color: var(--color-tone-c586c0);
      font-family: 'Consolas', 'Courier New', monospace;
      font-style: italic;
    }

    :deep(strong) {
      color: var(--color-tone-e0e0e0);
    }

    :deep(.desc-placeholder) {
      text-align: center;
      padding: 40px 0;
      color: var(--color-text-muted);
      line-height: 2;

      a {
        color: var(--color-accent);
        font-size: 14px;
      }
    }

    :deep(.sample-pre) {
      margin: 8px 0 14px;
      padding: 12px;
      overflow-x: auto;
      background: var(--color-bg-panel);
      border: 1px solid var(--color-border);
      border-radius: 6px;
      color: var(--color-text-primary);
      font: 13px/1.5 'Cascadia Code', Consolas, monospace;
      white-space: pre;
    }

    :deep(p) { margin: 0 0 12px; }
    :deep(ul), :deep(ol) { margin: 8px 0 12px 24px; }
    :deep(img) { max-width: 100%; height: auto; }
    :deep(table) { border-collapse: collapse; max-width: 100%; }
    :deep(th), :deep(td) { border: 1px solid var(--color-border-input); padding: 6px 9px; }
    :deep(.tex-span), :deep(.tex-font-style-it), :deep(.katex) { display: inline; }
    :deep(.tex-span) { white-space: nowrap; }
    :deep(.tex-font-style-it) { font-family: KaTeX_Math, serif; font-style: italic; }
    :deep(.katex-display) { display: block; overflow-x: auto; overflow-y: hidden; }
    :deep(.markdown-color-red) { color: var(--color-tone-ff7b72); }
    :deep(.markdown-color-orange) { color: var(--color-tone-ffa657); }
    :deep(.markdown-color-yellow) { color: var(--color-tone-e3d45b); }
    :deep(.markdown-color-green) { color: var(--color-tone-7ee787); }
    :deep(.markdown-color-blue) { color: var(--color-tone-79c0ff); }
    :deep(.markdown-color-purple) { color: var(--color-tone-d2a8ff); }
  }
}
.translate-btn, .retranslate-btn { padding: 4px 9px; border: 1px solid var(--color-tone-7c5bb5); border-radius: 4px; background: var(--color-tone-34264b); color: var(--color-tone-d8c3ff); cursor: pointer; &:disabled { opacity: .38; cursor: not-allowed; } }
.retranslate-btn { border-color: var(--color-tone-66527f); background: var(--color-tone-2b2435); color: var(--color-tone-bda8d7); }
.refresh-btn { padding: 4px 9px; border: 1px solid var(--color-accent-border); border-radius: 4px; background: var(--color-tone-233544); color: var(--color-accent-text); cursor: pointer; white-space: nowrap; &:disabled { opacity: .45; cursor: wait; } }
.note-btn { padding: 4px 9px; border: 1px solid var(--color-tone-4c7d4d); border-radius: 4px; background: var(--color-tone-203b27); color: var(--color-tone-a9dbb1); cursor: pointer; white-space: nowrap; &:disabled { opacity: .45; cursor: wait; } }
.statement-edit-btn { padding: 4px 9px; border: 1px solid var(--color-tone-7b6841); border-radius: 4px; background: var(--color-tone-3a3020); color: var(--color-tone-e5c77d); cursor: pointer; white-space: nowrap; }
.statement-samples { margin-top: 18px; }
.statement-sample { margin-top: 16px; }
.statement-sample__heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding-bottom: 6px; border-bottom: 1px solid var(--color-border); h2 { margin: 0; color: var(--color-accent); font-size: 18px; } button { padding: 4px 8px; border: 1px solid var(--color-accent-border); border-radius: 4px; background: var(--color-tone-233544); color: var(--color-accent-text); font-size: 11px; cursor: pointer; } }
.statement-io { margin-top: 10px; border: 1px solid var(--color-border); border-radius: 6px; overflow: hidden; background: var(--color-bg-deep); }
.statement-io__heading { display: flex; align-items: center; justify-content: space-between; padding: 5px 9px; border-bottom: 1px solid var(--color-border); background: var(--color-bg-control-alt); color: var(--color-warning); font-size: 12px; font-weight: 600; button { padding: 2px 7px; border: 0; background: transparent; color: var(--color-tone-75a9cf); font-size: 10px; cursor: pointer; } }
.statement-io pre { max-height: 260px; overflow: auto; margin: 0; padding: 12px; color: var(--color-text-primary); font: 13px/1.5 'Cascadia Code', Consolas, monospace; white-space: pre; }
:deep(.luogu-callout), :deep(.luogu-directive-fallback) { margin: 12px 0; padding: 10px 12px; border: 1px solid var(--color-border-input); border-left-width: 4px; border-radius: 5px; background: var(--color-bg-panel); }
:deep(.luogu-callout summary) { cursor: pointer; font-weight: 600; }
:deep(.luogu-callout-info) { border-left-color: var(--color-accent); }
:deep(.luogu-callout-success) { border-left-color: var(--color-success); }
:deep(.luogu-callout-warning) { border-left-color: var(--color-warning); }
:deep(.luogu-callout-error), :deep(.luogu-directive-fallback-anti-ai) { border-left-color: var(--color-danger-strong); }
:deep(.luogu-directive-fallback-label) { margin-bottom: 5px; color: var(--color-warning); font-weight: 600; }
:deep(.luogu-directive-fallback-inline) { padding: 1px 4px; border-radius: 3px; background: var(--color-tone-3a3030); }
:deep(.luogu-align-center) { text-align: center; }
:deep(.luogu-align-right) { text-align: right; }
:deep(.luogu-epigraph footer) { margin-top: 6px; text-align: right; color: var(--color-tone-999); }
:deep(.luogu-cute-table) { border-collapse: collapse; }
:deep(.luogu-cute-table th), :deep(.luogu-cute-table td) { padding: 6px 9px; border: 1px solid var(--color-border-strong); }
.problem-desc__error { padding: 6px 20px; border-top: 1px solid var(--color-danger-border); color: var(--color-danger); background: var(--color-tone-2b1d1d); font-size: 11px; }
.problem-desc__notice { padding: 6px 20px; border-top: 1px solid var(--color-tone-315b4c); color: var(--color-success); background: var(--color-tone-192b25); font-size: 11px; }
.solved-btn { padding: 4px 8px; border: 1px solid var(--color-border-strong); border-radius: 4px; background: transparent; color: var(--color-text-soft); font-size: 11px; cursor: pointer; &--active { border-color: var(--color-success); color: var(--color-success); background: var(--color-tone-1b3029); } }
.problem-note-modal { position: fixed; inset: 36px 0 0; z-index: 1600; display: grid; place-items: center; padding: 24px; background: var(--color-overlay); > section { width: min(980px, 94vw); height: min(760px, 88vh); display: flex; flex-direction: column; overflow: hidden; border: 1px solid var(--color-tone-505050); border-radius: 9px; background: var(--color-bg-app); box-shadow: 0 18px 60px var(--color-overlay-strong); > header { display: flex; align-items: center; gap: 12px; padding: 10px 13px; border-bottom: 1px solid var(--color-border); background: var(--color-bg-panel); > div { min-width: 0; flex: 1; display: flex; flex-direction: column; } strong { font-size: 14px; } span { overflow: hidden; color: var(--color-text-faint); font: 8px Consolas, monospace; text-overflow: ellipsis; white-space: nowrap; } nav { display: flex; align-items: center; gap: 4px; } button { padding: 5px 9px; border: 1px solid var(--color-border-control); border-radius: 4px; background: var(--color-bg-control-alt); color: var(--color-text-soft); font-size: 10px; cursor: pointer; &.active { border-color: var(--color-accent-border); background: var(--color-accent-surface-hover); color: var(--color-accent-text); } &.save { border-color: var(--color-tone-39704f); background: var(--color-tone-20372a); color: var(--color-tone-8ad0a1); } &.close { padding: 0 7px; border: 0; background: transparent; font-size: 22px; } &:disabled { opacity: .5; } } } } &__error { padding: 6px 10px; color: var(--color-danger); background: var(--color-danger-surface); font-size: 10px; } }
</style>
