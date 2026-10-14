<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useProblemStore } from '../stores/problemStore'
import { useProblemSetStore } from '../stores/problemSetStore'
import { useLearningStore } from '../stores/learningStore'
import type { QojArchiveEntry, QojArchiveProblem } from '../types'

const emit = defineEmits<{ back: [] }>()
const store = useProblemStore()
const sets = useProblemSetStore()
const learning = useLearningStore()
const importing = ref('')
const notice = ref('')
async function importContest(entry: QojArchiveEntry) {
  if (importing.value) return
  importing.value = entry.id
  error.value = ''; notice.value = ''
  try {
    const page = entry.problems.length ? null : await store.readQojContest(entry.url)
    const contest = page?.entries.find(item => item.kind === 'contest') ?? entry
    const result = sets.importContest({ platform: 'qoj', contestId: entry.id, title: contest.title, url: entry.url },
      contest.problems.map(p => ({ id: p.id, title: p.title, url: p.url, platform: 'qoj', tags: [] })))
    notice.value = result.added ? `已加入题单：${result.set.name}（${result.set.problems.length} 道题目）` : '这场比赛已在题单中'
  } catch (reason) { error.value = String(reason) }
  finally { importing.value = '' }
}
const query = ref('')
const error = ref('')
const opening = ref('')
const title = computed(() => store.qojSelectedContest?.title ?? store.qojArchivePage?.title ?? 'QOJ 比赛归档')
const matches = (name: string) => !query.value.trim() || name.toLowerCase().includes(query.value.trim().toLowerCase())
const sections = computed(() => (store.qojArchivePage?.entries ?? []).map(entry => entry.kind === 'group'
  ? { id: entry.id, title: entry.title, entries: (entry.children ?? []).filter(item => matches(item.title)) }
  : { id: entry.id, title: '', entries: matches(entry.title) ? [entry] : [] }).filter(section => section.entries.length))
const contestProblems = computed(() => store.qojSelectedContest?.problems.filter(p => matches(`${p.label} ${p.title}`)) ?? [])
async function load(force = false) {
  error.value = ''
  try {
    if (store.qojSelectedContest) {
      await store.openQojArchiveEntry(store.qojSelectedContest, force)
    } else await store.fetchQojArchive(store.qojArchivePage?.url ?? 'https://qoj.ac/category', force)
  } catch (reason) { error.value = String(reason) }
}
async function openEntry(entry: QojArchiveEntry) {
  error.value = ''
  try { await store.openQojArchiveEntry(entry); query.value = '' }
  catch (reason) { error.value = String(reason) }
}
async function openProblem(problem: QojArchiveProblem) {
  opening.value = problem.id
  error.value = ''
  try { await store.openQojArchiveProblem(problem) }
  catch (reason) { error.value = String(reason) }
  finally { opening.value = '' }
}
function back() {
  if (store.qojSelectedContest || store.qojArchiveHistory.length) store.backQojArchive()
  else emit('back')
  query.value = ''
  error.value = ''
}
onMounted(() => { if (!store.qojArchivePage) void load() })
</script>

<template>
  <section class="qoj-archive">
    <header><button class="back" @click="back">‹ 返回</button><div><strong>QOJ 比赛归档</strong><span>{{ title }}</span></div><button v-if="store.qojSelectedContest" :disabled="!!importing || sets.containsContest('qoj', store.qojSelectedContest.id)" title="一键导入题单" aria-label="一键导入题单" @click="importContest(store.qojSelectedContest)"><i :class="['codicon', importing ? 'codicon-loading codicon-modifier-spin' : sets.containsContest('qoj', store.qojSelectedContest.id) ? 'codicon-check' : 'codicon-add']" /> {{ sets.containsContest('qoj', store.qojSelectedContest.id) ? '已导入' : '导入题单' }}</button><button :disabled="store.isLoadingQojArchive" title="更新当前归档" @click="load(true)"><i class="codicon codicon-refresh" /></button></header>
    <div v-if="notice" class="notice" role="status">{{ notice }}</div>
    <div v-if="error" class="error">{{ error }}<button :disabled="store.isLoadingQojArchive" @click="load(true)">重试</button></div>
    <div v-if="store.isLoadingQojArchive" class="loading"><i class="codicon codicon-loading codicon-modifier-spin" />正在读取 QOJ 归档…</div>
    <div v-else class="archive-content">
      <template v-if="store.qojSelectedContest">
        <button v-for="problem in contestProblems" :key="problem.id" class="problem-row" :disabled="!!opening" @click="openProblem(problem)">
          <span class="problem-label">{{ problem.label }}</span><span class="problem-name"><span v-if="learning.profile.solvedProblems.includes(`qoj:${problem.id}`)" class="problem-solved" title="已完成" aria-label="已完成">✓</span>{{ problem.title }}<small v-if="opening === problem.id">正在打开…</small></span>
          <span v-if="problem.acceptedTeams != null && problem.submittedTeams != null" class="team-ratio" title="通过队伍 / 所有提交队伍">{{ problem.acceptedTeams }}/{{ problem.submittedTeams }}</span>
        </button>
        <p v-if="!contestProblems.length" class="empty">没有找到对应题目</p>
      </template>
      <template v-else>
        <section v-for="section in sections" :key="section.id" class="archive-section">
          <h3 v-if="section.title">{{ section.title }}</h3>
          <div v-for="entry in section.entries" :key="entry.id" class="archive-row">
            <button class="entry-open" @click="openEntry(entry)"><i :class="['codicon', entry.kind === 'category' ? 'codicon-folder' : 'codicon-list-unordered']" /><span><strong>{{ entry.title }}</strong><small v-if="entry.kind === 'category' && entry.contestCount != null">{{ entry.contestCount }} 场比赛</small><small v-else-if="entry.problemCount != null">{{ entry.problemCount }} 道题目</small></span></button>
            <button v-if="entry.kind === 'contest'" class="entry-add" :disabled="!!importing || sets.containsContest('qoj', entry.id)" title="一键导入题单" :aria-label="`将 ${entry.title} 加入题单`" @click="importContest(entry)"><i :class="['codicon', importing === entry.id ? 'codicon-loading codicon-modifier-spin' : sets.containsContest('qoj', entry.id) ? 'codicon-check' : 'codicon-add']" /></button>
            <button v-else title="打开分类" @click="openEntry(entry)"><i class="codicon codicon-chevron-right" /></button>
          </div>
        </section>
        <p v-if="!sections.length" class="empty">没有找到对应归档</p>
      </template>
    </div>
    <footer><i class="codicon codicon-search" /><input v-model="query" :placeholder="store.qojSelectedContest ? '搜索本场比赛题目' : '搜索当前归档'" /></footer>
  </section>
</template>

<style scoped lang="scss">
.entry-open { display: flex; align-items: center; gap: 10px; flex: 1; min-width: 0; text-align: left; padding: 0; > i { color: var(--color-accent-text); font-size: 18px; } > span { flex: 1; min-width: 0; } }
.entry-add { padding: 8px; color: var(--color-accent-text); }
.notice { padding: 8px 12px; font-size: 12px; color: var(--color-success, var(--color-accent-text)); }
.qoj-archive { height: 100%; min-height: 0; flex: 1; display: flex; flex-direction: column; color: var(--color-text-primary); }
header { display: flex; align-items: center; gap: 8px; padding: 12px 10px; border-bottom: 1px solid var(--color-border-soft); div { flex: 1; min-width: 0; strong, span { display: block; } strong { font-size: 14px; } span { margin-top: 4px; font-size: 11px; color: var(--color-text-soft); overflow: hidden; text-overflow: ellipsis; } } }
button { border: 0; color: inherit; background: transparent; cursor: pointer; &:disabled { opacity: .5; cursor: default; } }
header button { padding: 6px; color: var(--color-accent-text); }
.archive-content { flex: 1; min-height: 0; overflow-y: auto; padding: 10px; }
.archive-section { margin-bottom: 16px; h3 { font-size: 17px; margin: 8px 0; padding-bottom: 8px; border-bottom: 1px solid var(--color-border-soft); } }
.archive-row { display: flex; align-items: center; gap: 10px; padding: 12px 10px; width: 100%; border: 1px solid var(--color-border-soft); border-radius: 5px; margin-bottom: 6px; text-align: left; background: var(--color-bg-control-alt); &:hover { background: var(--color-accent-surface); border-color: var(--color-accent-border); } > i:first-child { color: var(--color-accent-text); font-size: 18px; } > span { flex: 1; min-width: 0; } strong { font-weight: 500; font-size: 13px; overflow-wrap: anywhere; } small { display: block; color: var(--color-text-soft); font-size: 11px; margin-top: 5px; } }
.problem-row { display: flex; align-items: center; gap: 10px; padding: 12px 8px; width: 100%; border-bottom: 1px solid var(--color-border-soft); text-align: left; &:hover { background: var(--color-accent-surface); } }
.problem-solved { display: inline-block; margin-right: 6px; color: var(--color-success-bright); font-weight: 700; }
.problem-label { color: var(--color-accent-text); font-weight: 700; min-width: 20px; }.problem-name { flex: 1; min-width: 0; overflow-wrap: anywhere; font-size: 13px; small { display: block; color: var(--color-text-soft); } }.team-ratio { background: var(--color-bg-control-alt); padding: 4px 7px; border-radius: 4px; font-size: 12px; white-space: nowrap; color: var(--color-accent-text); }
.loading, .empty { padding: 25px 12px; color: var(--color-text-soft); font-size: 12px; }.loading { display: flex; gap: 8px; }.error { padding: 10px; color: var(--color-danger); font-size: 12px; overflow-wrap: anywhere; }
footer { display: flex; gap: 8px; align-items: center; border-top: 1px solid var(--color-border-soft); padding: 10px; input { width: 100%; background: var(--color-bg-control-alt); border: 1px solid var(--color-border-control); border-radius: 4px; color: inherit; padding: 7px; outline: none; &:focus { border-color: var(--color-accent-border); } } }
</style>
