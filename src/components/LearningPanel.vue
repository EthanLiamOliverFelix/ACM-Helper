<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { SKILL_BY_ID, SKILL_TREE } from '../data/skillTree'
import { useLearningStore } from '../stores/learningStore'
import { useAiStore } from '../stores/aiStore'
import { useProblemStore } from '../stores/problemStore'
import { useProblemSetStore } from '../stores/problemSetStore'
import { useWorkbenchStore } from '../stores/workbenchStore'
import type { SkillNode, SkillPlanProblem } from '../types'
import PracticeStatistics from './PracticeStatistics.vue'
import AlgorithmOverview from './AlgorithmOverview.vue'

const learning = useLearningStore()
const ai = useAiStore()
const problemStore = useProblemStore()
const problemSets = useProblemSetStore()
const workbench = useWorkbenchStore()
const levels = computed(() => [...new Set(SKILL_TREE.map((skill) => skill.level))].sort((a, b) => a - b))
const generatingSkillId = ref<string | null>(null)
const planError = ref('')
const planImportNotice = ref('')
const selectedPageIndex = ref(0)
const statisticsOpen = ref(false)
const overviewOpen = ref(false)
const updatingSkippedSkillId = ref<string | null>(null)
const selectedSkill = computed(() => learning.selectedSkillId ? SKILL_BY_ID.get(learning.selectedSkillId) ?? null : null)
const selectedPlans = computed(() => learning.selectedSkillId ? learning.plansFor(learning.selectedSkillId) : [])
const selectedPlan = computed(() => selectedPlans.value[selectedPageIndex.value] ?? null)
const selectedPlanProblems = computed(() => selectedPlan.value?.problems.filter((problem) => problem.platform !== 'qoj') ?? [])
const selectedPlanProgress = computed(() => {
  const solved = new Set(learning.profile.solvedProblems)
  return { solved: selectedPlanProblems.value.filter((problem) => solved.has(`${problem.platform}:${problem.id}`)).length, total: selectedPlanProblems.value.length }
})

watch(() => learning.selectedSkillId, () => {
  selectedPageIndex.value = Math.max(0, selectedPlans.value.length - 1)
  planImportNotice.value = ''
})

async function handleSkill(skill: SkillNode) {
  if (learning.statusOf(skill) === 'locked') return
  if (learning.plansFor(skill.id).length || learning.statusOf(skill) === 'mastered') {
    learning.openSkillPlan(skill.id)
    return
  }
  generatingSkillId.value = skill.id
  planError.value = ''
  try {
    const problems = await ai.generateSkillPlan(skill)
    await learning.startSkillPlan(skill, problems)
  } catch (error) {
    planError.value = String(error)
  } finally {
    generatingSkillId.value = null
  }
}

async function generateAnotherPlan() {
  if (!selectedSkill.value || generatingSkillId.value) return
  generatingSkillId.value = selectedSkill.value.id
  planError.value = ''
  try {
    const problems = await ai.generateSkillPlan(selectedSkill.value)
    await learning.startSkillPlan(selectedSkill.value, problems)
    selectedPageIndex.value = Math.max(0, learning.plansFor(selectedSkill.value.id).length - 1)
  } catch (error) {
    planError.value = String(error)
  } finally {
    generatingSkillId.value = null
  }
}

function statusText(skill: SkillNode) {
  const status = learning.statusOf(skill)
  const pages = learning.plansFor(skill.id)
  const progress = learning.planProgress(skill.id, Math.max(0, pages.length - 1))
  if (generatingSkillId.value === skill.id) return 'AI 正在生成题单…'
  if (status === 'locked') return '🔒 未解锁'
  if (status === 'available') return '○ 开始学习'
  if (status === 'skipped') return '⏭ 已跳过 · 题目未完成'
  if (status === 'mastered') return `✓ 已掌握${progress.total ? ` · ${progress.solved}/${progress.total}` : ''}`
  return `◐ 查看题单 · ${progress.solved}/${progress.total}`
}

async function toggleSkipped(skill: SkillNode) {
  if (updatingSkippedSkillId.value) return
  updatingSkippedSkillId.value = skill.id
  planError.value = ''
  try { await learning.toggleSkillSkipped(skill.id) }
  catch (error) { planError.value = String(error) }
  finally { updatingSkippedSkillId.value = null }
}

async function openPlanProblem(problem: SkillPlanProblem) {
  planError.value = ''
  try {
    await problemStore.openRecommendedProblem(problem)
    workbench.openCurrentCode()
  }
  catch (error) { planError.value = String(error) }
}

function importSelectedPlan() {
  if (!selectedSkill.value || !selectedPlan.value) return
  problemSets.importPlan(`${selectedSkill.value.name} · 技能树题单 ${selectedPageIndex.value + 1}`, selectedPlanProblems.value)
  planImportNotice.value = '已导入左侧题单'
  window.setTimeout(() => { planImportNotice.value = '' }, 2200)
}

async function openSkillFromOverview(skill: SkillNode) {
  overviewOpen.value = false
  await handleSkill(skill)
}

onMounted(() => learning.init())
</script>

<template>
  <div class="learning-view">
    <header class="learning-header">
      <div class="learning-header__title"><h1>算法技能树</h1><div class="progress-ring"><strong>{{ learning.progress }}%</strong><span>{{ learning.profile.masteredSkills.length }}/{{ SKILL_TREE.length }}</span></div></div>
      <div class="learning-header__actions">
        <button class="header-entry overview-entry" @click="overviewOpen = true"><span>◫</span><div><strong>算法总览</strong><small>知识覆盖、强项与待巩固项</small></div></button>
        <button class="header-entry statistics-entry" @click="statisticsOpen = true"><span>▥</span><div><strong>做题统计</strong><small>题量、通过率与练习趋势</small></div></button>
      </div>
    </header>

    <section class="vp-card">
      <div class="vp-card__intro"><h2>VP 赛前分析</h2><p>粘贴 Codeforces 或洛谷比赛链接，自动标记尚未掌握的知识。</p></div>
      <div class="vp-form">
        <input v-model="learning.contestUrl" placeholder="CF / 洛谷比赛链接" @keyup.enter="learning.analyzeContest" />
        <button :disabled="learning.isAnalyzing || !learning.contestUrl.trim()" @click="learning.analyzeContest">{{ learning.isAnalyzing ? '分析中…' : '分析比赛' }}</button>
      </div>
      <div v-if="learning.error" class="vp-error">{{ learning.error }}</div>
      <div v-if="learning.contestAnalysis" class="contest-result">
        <h3>{{ learning.contestAnalysis.title }}</h3>
        <div class="contest-tags"><span v-for="tag in learning.contestAnalysis.tags" :key="tag">{{ tag }}</span></div>
        <div class="contest-problems">
          <article v-for="problem in learning.contestAnalysis.problems" :key="problem.id" class="contest-problem">
            <div class="contest-problem__title"><b>{{ problem.id }}</b> {{ problem.title }} <em v-if="problem.rating">{{ problem.rating }}</em></div>
            <div class="contest-problem__tags"><span v-for="tag in problem.tags" :key="tag">{{ tag }}</span></div>
            <div v-if="!problem.tags.length" class="knowledge-pending">题目或知识标签尚未公开，暂不能判断知识缺口</div>
            <div v-else-if="problem.missingSkills.length" class="knowledge-gap">知识缺口：{{ problem.missingSkills.join('、') }}</div>
            <div v-else class="knowledge-ready">当前技能树未发现缺口</div>
          </article>
        </div>
      </div>
    </section>
    <div v-if="planError" class="plan-error">{{ planError }}</div>

    <main class="skill-levels">
      <section v-for="level in levels" :key="level" class="skill-level">
        <div class="skill-level__label">阶段 {{ level + 1 }}</div>
        <div class="skill-level__nodes">
          <article v-for="skill in SKILL_TREE.filter((item) => item.level === level)" :key="skill.id" class="skill-node-wrap">
            <button class="skill-node" :class="[`skill-node--${learning.statusOf(skill)}`, { 'skill-node--stale': learning.skillFreshness(skill.id).level === 'stale' }]" :disabled="learning.statusOf(skill) === 'locked' || generatingSkillId === skill.id" @click="handleSkill(skill)">
              <span class="skill-node__status">{{ statusText(skill) }}</span>
              <span v-if="learning.skillFreshness(skill.id).level === 'stale'" class="skill-node__stale" :title="'最近一次相关练习：' + learning.skillFreshness(skill.id).label">⚠ {{ learning.skillFreshness(skill.id).label }}</span>
              <strong>{{ skill.name }}</strong><small>{{ skill.category }}</small><p>{{ skill.description }}</p>
              <span v-if="learning.unmetPrerequisites(skill).length" class="skill-node__requires">前置：{{ learning.unmetPrerequisites(skill).map((item) => item.name).join('、') }}</span>
              <span v-else class="skill-node__evidence">{{ learning.skillFreshness(skill.id).label }}</span>
            </button>
            <button v-if="!['locked', 'mastered'].includes(learning.statusOf(skill))" class="skill-node-skip" :class="{ active: learning.skipped.has(skill.id) }" :disabled="updatingSkippedSkillId === skill.id" :title="learning.skipped.has(skill.id) ? '恢复该知识点的正常依赖关系' : '保留未完成状态，但允许学习后续知识点'" @click="toggleSkipped(skill)">{{ updatingSkippedSkillId === skill.id ? '保存中…' : learning.skipped.has(skill.id) ? '取消跳过' : '跳过' }}</button>
          </article>
        </div>
      </section>
    </main>

    <div v-if="statisticsOpen" class="statistics-modal"><PracticeStatistics @close="statisticsOpen = false" /></div>
    <div v-if="overviewOpen" class="overview-modal"><AlgorithmOverview @close="overviewOpen = false" @select-skill="openSkillFromOverview" /></div>

    <div v-if="selectedSkill" class="plan-modal" @click.self="learning.closeSkillPlan">
      <section class="plan-card">
        <header>
          <div><small>{{ selectedSkill.category }}</small><h2>{{ selectedSkill.name }} · 学习题单</h2></div>
          <div class="plan-card__actions">
            <button class="plan-generate" :disabled="generatingSkillId === selectedSkill.id" @click="generateAnotherPlan">{{ generatingSkillId === selectedSkill.id ? 'AI 生成中…' : '＋ 新生成题单' }}</button>
            <button v-if="selectedPlan" class="plan-import" @click="importSelectedPlan">{{ planImportNotice || '导入到题单' }}</button>
            <button class="plan-close" aria-label="关闭" @click="learning.closeSkillPlan">×</button>
          </div>
        </header>
        <div v-if="selectedPlans.length" class="plan-pager">
          <button :disabled="selectedPageIndex <= 0" @click="selectedPageIndex--">‹ 上一页</button>
          <span>第 {{ selectedPageIndex + 1 }} / {{ selectedPlans.length }} 页</span>
          <button :disabled="selectedPageIndex >= selectedPlans.length - 1" @click="selectedPageIndex++">下一页 ›</button>
        </div>
        <p v-if="selectedPlan">本页完成 {{ selectedPlanProgress.solved }}/{{ selectedPlanProgress.total }} 道 · {{ new Date(selectedPlan.generatedAt).toLocaleDateString() }} 生成；任意一页全部完成后点亮知识点。<span class="freshness" :class="`freshness--${learning.skillFreshness(selectedSkill.id).level}`">{{ learning.skillFreshness(selectedSkill.id).label }}</span></p>
        <p v-else>这是旧版本保留的历史掌握记录，尚未生成 AI 题单。</p>
        <ol v-if="selectedPlan" class="plan-list">
          <li v-for="problem in selectedPlanProblems" :key="`${problem.platform}:${problem.id}`" :class="{ solved: learning.profile.solvedProblems.includes(`${problem.platform}:${problem.id}`) }">
            <span class="plan-list__check">{{ learning.profile.solvedProblems.includes(`${problem.platform}:${problem.id}`) ? '✓' : '' }}</span>
            <div><strong>{{ problem.id }} · {{ problem.title }}</strong><small>{{ problem.platform === 'luogu' ? '洛谷' : problem.platform === 'atcoder' ? 'AtCoder' : 'Codeforces' }}<template v-if="problem.rating"> · {{ problem.rating }}</template></small><p>{{ problem.reason }}</p></div>
            <button @click="openPlanProblem(problem)">在工作台打开</button>
          </li>
        </ol>
      </section>
    </div>
  </div>
</template>

<style scoped lang="scss">
.learning-view { height: 100%; overflow-y: auto; background: var(--color-bg-deep); color: var(--color-text-primary); padding: 28px 34px 60px; }
.learning-header { max-width: 1200px; margin: auto; h1 { margin: 0; font-size: 26px; white-space: nowrap; } }
.learning-header__title { display: flex; align-items: center; justify-content: space-between; gap: 18px; }
.learning-header__actions { display: flex; align-items: center; gap: 10px; margin-top: 14px; }.header-entry { display: flex; align-items: center; gap: 9px; min-width: 185px; padding: 10px 13px; border: 1px solid var(--color-accent-border); border-radius: 8px; background: var(--color-accent-surface); color: var(--color-tone-d7efff); text-align: left; cursor: pointer; > span { font-size: 21px; } > div { display: flex; flex-direction: column; } strong { font-size: 13px; } small { margin-top: 2px; color: var(--color-tone-82a9c2); font-size: 9px; } &:hover { border-color: var(--color-tone-6ba5d1); background: var(--color-tone-26445a); } }.statistics-entry { border-color: var(--color-tone-4d725f); background: var(--color-tone-20362a); color: var(--color-tone-d9f4e4); > div small { color: var(--color-tone-83aa92); } &:hover { border-color: var(--color-tone-69a982); background: var(--color-tone-274635); } }
.progress-ring { width: 72px; height: 72px; flex: 0 0 72px; border: 6px solid var(--color-selection); border-radius: 50%; display: flex; flex-direction: column; align-items: center; justify-content: center; strong { color: var(--color-success); font-size: 17px; } span { color: var(--color-text-muted); font-size: 10px; } }
.vp-card { max-width: 1200px; margin: 24px auto 30px; padding: 20px; border: 1px solid var(--color-border); border-radius: 10px; background: var(--color-bg-panel); h2 { margin: 0 0 4px; font-size: 17px; } p { color: var(--color-text-muted); font-size: 13px; } }
.vp-form { display: flex; gap: 8px; margin-top: 14px; input { flex: 1; padding: 10px 12px; background: var(--color-bg-deep); border: 1px solid var(--color-border); border-radius: 5px; color: var(--color-text-strong); outline: none; } input:focus { border-color: var(--color-accent); } button { padding: 0 18px; border: 0; border-radius: 5px; background: var(--color-accent-strong); color: var(--color-text-on-accent); cursor: pointer; } button:disabled { opacity: .45; } }
.vp-error { margin-top: 10px; color: var(--color-danger); font-size: 12px; }
.contest-result { margin-top: 18px; h3 { margin: 0 0 8px; } }
.contest-tags, .contest-problem__tags { display: flex; flex-wrap: wrap; gap: 5px; span { padding: 2px 6px; background: var(--color-bg-subtle); color: var(--color-accent-text); border-radius: 3px; font-size: 10px; } }
.contest-problems { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 8px; margin-top: 12px; }
.contest-problem { padding: 11px; background: var(--color-bg-app); border-radius: 6px; border: 1px solid var(--color-bg-subtle); &__title { font-size: 13px; margin-bottom: 7px; b { color: var(--color-accent); } em { float: right; color: var(--color-warning); font-style: normal; } } }
.knowledge-gap, .knowledge-ready, .knowledge-pending { margin-top: 8px; font-size: 11px; }.knowledge-gap { color: var(--color-danger); }.knowledge-ready { color: var(--color-success); }.knowledge-pending { color: var(--color-warning); }
.skill-levels { max-width: 1200px; margin: auto; }
.skill-level { display: grid; grid-template-columns: 80px 1fr; gap: 18px; padding: 12px 0 24px; border-top: 1px solid var(--color-bg-subtle); &__label { padding-top: 12px; color: var(--color-text-muted); font-size: 12px; } &__nodes { display: grid; grid-template-columns: repeat(auto-fill, minmax(205px, 1fr)); gap: 10px; } }
.skill-node-wrap { position: relative; min-width: 0; min-height: 145px; }
.skill-node { position: relative; width: 100%; height: 100%; min-height: 145px; padding: 14px 14px 40px; text-align: left; color: var(--color-tone-ccc); background: var(--color-bg-panel); border: 1px solid var(--color-border); border-radius: 8px; cursor: pointer; transition: .15s; strong { display: block; margin: 7px 0 2px; font-size: 15px; } small { color: var(--color-text-muted); } p { margin: 8px 0; color: var(--color-text-soft); font-size: 12px; line-height: 1.4; } &__status, &__requires, &__evidence { font-size: 10px; } &__requires { color: var(--color-text-muted); } &__evidence { color: var(--color-success); } &__stale { position: absolute; top: 10px; right: 10px; max-width: 105px; color: var(--color-tone-f0b45a); font-size: 9px; text-align: right; } &:hover:not(:disabled) { transform: translateY(-2px); border-color: var(--color-accent); } &--locked { padding-bottom: 14px; opacity: .42; cursor: not-allowed; } &--available { border-color: var(--color-border-strong); } &--learning { border-color: var(--color-warning); background: var(--color-tone-302e20); } &--skipped { border-style: dashed; border-color: var(--color-warning-strong); background: var(--color-tone-37311f); } &--mastered { padding-bottom: 14px; border-color: var(--color-success); background: var(--color-tone-1b3029); } &--stale { border-color: var(--color-tone-9c7136); box-shadow: inset 0 0 0 1px var(--color-tone-68471f); } }
.skill-node-skip { position: absolute; right: 9px; bottom: 9px; z-index: 2; padding: 4px 8px; border: 1px solid var(--color-border-strong); border-radius: 4px; background: var(--color-bg-control); color: var(--color-text-secondary); font-size: 9px; cursor: pointer; &:hover { border-color: var(--color-warning-strong); color: var(--color-warning); } &.active { border-color: var(--color-warning-strong); background: var(--color-tone-44351e); color: var(--color-warning); } &:disabled { opacity: .5; cursor: wait; } }
.plan-error { max-width: 1200px; margin: -18px auto 24px; padding: 10px 12px; border: 1px solid var(--color-tone-a84848); border-radius: 6px; background: var(--color-tone-3b2020); color: var(--color-tone-f5a3a3); font-size: 12px; }
.plan-modal { position: fixed; inset: 36px 0 0; z-index: 1500; display: flex; align-items: center; justify-content: center; padding: 25px; background: var(--color-overlay); }
.statistics-modal { position: fixed; inset: 36px 0 0; z-index: 1550; background: var(--color-bg-deep); }
.overview-modal { position: fixed; inset: 36px 0 0; z-index: 1550; background: var(--color-bg-deep); }
.overview-entry { border-color: var(--color-tone-3b6e90); background: var(--color-accent-surface-hover); color: var(--color-tone-d7efff); > div small { color: var(--color-tone-82a9c2); } }
.plan-card { width: min(820px, 92vw); max-height: 86vh; overflow: auto; padding: 20px; border: 1px solid var(--color-tone-4b4b4b); border-radius: 10px; background: var(--color-bg-panel); box-shadow: 0 18px 60px var(--color-tone-0009); > header { display: flex; justify-content: space-between; align-items: flex-start; h2 { margin: 3px 0 0; } small { color: var(--color-text-muted); } } > p { color: var(--color-tone-9e9e9e); font-size: 12px; } }
.plan-card__actions { display: flex; align-items: center; gap: 8px; }.plan-import, .plan-generate { padding: 7px 10px; border: 1px solid var(--color-tone-3b6e90); border-radius: 4px; background: var(--color-accent-surface-hover); color: var(--color-accent-text); cursor: pointer; &:disabled { opacity: .5; cursor: wait; } }.plan-generate { border-color: var(--color-tone-4c7d4d); background: var(--color-tone-203b27); color: var(--color-tone-9fdaa7); }.plan-close { border: 0; background: transparent; color: var(--color-text-soft); font-size: 24px; cursor: pointer; }
.plan-pager { display: flex; align-items: center; justify-content: center; gap: 12px; margin: 14px 0 4px; button { padding: 5px 9px; border: 1px solid var(--color-border-control); border-radius: 4px; background: var(--color-bg-subtle); color: var(--color-tone-ccc); cursor: pointer; &:disabled { opacity: .35; cursor: default; } } span { min-width: 86px; color: var(--color-text-secondary); font-size: 11px; text-align: center; } }
.freshness { display: inline-block; margin-left: 8px; padding: 2px 6px; border-radius: 3px; background: var(--color-bg-subtle); color: var(--color-text-soft); &--fresh { color: var(--color-success); } &--aging { color: var(--color-warning); } &--stale { color: var(--color-tone-f0b45a); background: var(--color-tone-44351e); } }
.plan-list { display: flex; flex-direction: column; gap: 7px; padding: 0; list-style: none; li { display: grid; grid-template-columns: 22px 1fr auto; gap: 9px; align-items: center; padding: 10px; border: 1px solid var(--color-border); border-radius: 6px; background: var(--color-bg-app); &.solved { border-color: var(--color-tone-31734c); background: var(--color-tone-19271e); } > div strong { display: block; color: var(--color-text-strong); font-size: 13px; } > div small { color: var(--color-text-muted); font-size: 10px; } > div p { margin: 4px 0 0; color: var(--color-text-soft); font-size: 11px; } > button { padding: 7px 10px; border: 1px solid var(--color-tone-3b6e90); border-radius: 4px; background: var(--color-accent-surface-hover); color: var(--color-accent-text); cursor: pointer; } } &__check { display: inline-flex; align-items: center; justify-content: center; width: 17px; height: 17px; border: 1px solid var(--color-tone-3b9a60); border-radius: 3px; color: var(--color-tone-54d187); font-size: 11px; } }
</style>
