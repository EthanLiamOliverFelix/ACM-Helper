<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { SKILL_BY_ID, SKILL_TREE } from '../data/skillTree'
import { useLearningStore } from '../stores/learningStore'
import { useAiStore } from '../stores/aiStore'
import { useProblemStore } from '../stores/problemStore'
import { useProblemSetStore } from '../stores/problemSetStore'
import type { SkillNode, SkillPlanProblem } from '../types'
import NoteManager from './NoteManager.vue'

const learning = useLearningStore()
const ai = useAiStore()
const problemStore = useProblemStore()
const problemSets = useProblemSetStore()
const levels = computed(() => [...new Set(SKILL_TREE.map((skill) => skill.level))].sort((a, b) => a - b))
const generatingSkillId = ref<string | null>(null)
const planError = ref('')
const planImportNotice = ref('')
const selectedPageIndex = ref(0)
const notesOpen = ref(false)
const selectedSkill = computed(() => learning.selectedSkillId ? SKILL_BY_ID.get(learning.selectedSkillId) ?? null : null)
const selectedPlans = computed(() => learning.selectedSkillId ? learning.plansFor(learning.selectedSkillId) : [])
const selectedPlan = computed(() => selectedPlans.value[selectedPageIndex.value] ?? null)

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
  if (status === 'mastered') return `✓ 已掌握${progress.total ? ` · ${progress.solved}/${progress.total}` : ''}`
  return `◐ 查看题单 · ${progress.solved}/${progress.total}`
}

async function openPlanProblem(problem: SkillPlanProblem) {
  planError.value = ''
  try { await problemStore.openRecommendedProblem(problem) }
  catch (error) { planError.value = String(error) }
}

function importSelectedPlan() {
  if (!selectedSkill.value || !selectedPlan.value) return
  problemSets.importPlan(`${selectedSkill.value.name} · 技能树题单 ${selectedPageIndex.value + 1}`, selectedPlan.value.problems)
  planImportNotice.value = '已导入左侧题单'
  window.setTimeout(() => { planImportNotice.value = '' }, 2200)
}

onMounted(() => learning.init())
</script>

<template>
  <div class="learning-view">
    <header class="learning-header">
      <div><h1>算法技能树</h1><p>点击可学习的知识点，由 AI 生成约 10 道递进题单；全部完成后自动掌握。</p></div>
      <div class="learning-header__actions"><button class="notebook-entry" @click="notesOpen = true"><span>📝</span><div><strong>算法笔记本</strong><small>查看和整理全部题目笔记</small></div></button><div class="progress-ring"><strong>{{ learning.progress }}%</strong><span>{{ learning.profile.masteredSkills.length }}/{{ SKILL_TREE.length }}</span></div></div>
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
          <button v-for="skill in SKILL_TREE.filter((item) => item.level === level)" :key="skill.id" class="skill-node" :class="[`skill-node--${learning.statusOf(skill)}`, { 'skill-node--stale': learning.skillFreshness(skill.id).level === 'stale' }]" :disabled="learning.statusOf(skill) === 'locked' || generatingSkillId === skill.id" @click="handleSkill(skill)">
            <span class="skill-node__status">{{ statusText(skill) }}</span>
            <span v-if="learning.skillFreshness(skill.id).level === 'stale'" class="skill-node__stale" :title="'最近一次相关练习：' + learning.skillFreshness(skill.id).label">⚠ {{ learning.skillFreshness(skill.id).label }}</span>
            <strong>{{ skill.name }}</strong><small>{{ skill.category }}</small><p>{{ skill.description }}</p>
            <span v-if="learning.unmetPrerequisites(skill).length" class="skill-node__requires">前置：{{ learning.unmetPrerequisites(skill).map((item) => item.name).join('、') }}</span>
            <span v-else class="skill-node__evidence">{{ learning.skillFreshness(skill.id).label }}</span>
          </button>
        </div>
      </section>
    </main>

    <div v-if="notesOpen" class="notes-modal"><NoteManager @close="notesOpen = false" /></div>

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
        <p v-if="selectedPlan">本页完成 {{ learning.planProgress(selectedSkill.id, selectedPageIndex).solved }}/{{ learning.planProgress(selectedSkill.id, selectedPageIndex).total }} 道 · {{ new Date(selectedPlan.generatedAt).toLocaleDateString() }} 生成；任意一页全部完成后点亮知识点。<span class="freshness" :class="`freshness--${learning.skillFreshness(selectedSkill.id).level}`">{{ learning.skillFreshness(selectedSkill.id).label }}</span></p>
        <p v-else>这是旧版本保留的历史掌握记录，尚未生成 AI 题单。</p>
        <ol v-if="selectedPlan" class="plan-list">
          <li v-for="problem in selectedPlan.problems" :key="`${problem.platform}:${problem.id}`" :class="{ solved: learning.profile.solvedProblems.includes(`${problem.platform}:${problem.id}`) }">
            <span class="plan-list__check">{{ learning.profile.solvedProblems.includes(`${problem.platform}:${problem.id}`) ? '✓' : '' }}</span>
            <div><strong>{{ problem.id }} · {{ problem.title }}</strong><small>{{ problem.platform === 'luogu' ? '洛谷' : 'Codeforces' }}<template v-if="problem.rating"> · {{ problem.rating }}</template></small><p>{{ problem.reason }}</p></div>
            <button @click="openPlanProblem(problem)">在工作台打开</button>
          </li>
        </ol>
      </section>
    </div>
  </div>
</template>

<style scoped lang="scss">
.learning-view { height: 100%; overflow-y: auto; background: #181818; color: #d4d4d4; padding: 28px 34px 60px; }
.learning-header { display: flex; justify-content: space-between; align-items: center; max-width: 1200px; margin: auto; h1 { margin: 0 0 6px; font-size: 26px; } p { color: #858585; } }
.learning-header__actions { display: flex; align-items: center; gap: 16px; }.notebook-entry { display: flex; align-items: center; gap: 9px; min-width: 215px; padding: 10px 13px; border: 1px solid #4d718f; border-radius: 8px; background: #203545; color: #d7efff; text-align: left; cursor: pointer; > span { font-size: 21px; } > div { display: flex; flex-direction: column; } strong { font-size: 13px; } small { margin-top: 2px; color: #82a9c2; font-size: 9px; } &:hover { border-color: #6ba5d1; background: #26445a; } }
.progress-ring { width: 86px; height: 86px; border: 7px solid #264f78; border-radius: 50%; display: flex; flex-direction: column; align-items: center; justify-content: center; strong { color: #4ec9b0; font-size: 19px; } span { color: #858585; font-size: 11px; } }
.vp-card { max-width: 1200px; margin: 24px auto 30px; padding: 20px; border: 1px solid #3c3c3c; border-radius: 10px; background: #252526; h2 { margin: 0 0 4px; font-size: 17px; } p { color: #858585; font-size: 13px; } }
.vp-form { display: flex; gap: 8px; margin-top: 14px; input { flex: 1; padding: 10px 12px; background: #181818; border: 1px solid #3c3c3c; border-radius: 5px; color: #ddd; outline: none; } input:focus { border-color: #569cd6; } button { padding: 0 18px; border: 0; border-radius: 5px; background: #0e639c; color: white; cursor: pointer; } button:disabled { opacity: .45; } }
.vp-error { margin-top: 10px; color: #f48771; font-size: 12px; }
.contest-result { margin-top: 18px; h3 { margin: 0 0 8px; } }
.contest-tags, .contest-problem__tags { display: flex; flex-wrap: wrap; gap: 5px; span { padding: 2px 6px; background: #333; color: #9cdcfe; border-radius: 3px; font-size: 10px; } }
.contest-problems { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 8px; margin-top: 12px; }
.contest-problem { padding: 11px; background: #1e1e1e; border-radius: 6px; border: 1px solid #333; &__title { font-size: 13px; margin-bottom: 7px; b { color: #569cd6; } em { float: right; color: #dcdcaa; font-style: normal; } } }
.knowledge-gap, .knowledge-ready, .knowledge-pending { margin-top: 8px; font-size: 11px; }.knowledge-gap { color: #f48771; }.knowledge-ready { color: #4ec9b0; }.knowledge-pending { color: #dcdcaa; }
.skill-levels { max-width: 1200px; margin: auto; }
.skill-level { display: grid; grid-template-columns: 80px 1fr; gap: 18px; padding: 12px 0 24px; border-top: 1px solid #333; &__label { padding-top: 12px; color: #858585; font-size: 12px; } &__nodes { display: grid; grid-template-columns: repeat(auto-fill, minmax(205px, 1fr)); gap: 10px; } }
.skill-node { position: relative; min-height: 145px; padding: 14px; text-align: left; color: #ccc; background: #252526; border: 1px solid #3c3c3c; border-radius: 8px; cursor: pointer; transition: .15s; strong { display: block; margin: 7px 0 2px; font-size: 15px; } small { color: #858585; } p { margin: 8px 0; color: #aaa; font-size: 12px; line-height: 1.4; } &__status, &__requires, &__evidence { font-size: 10px; } &__requires { color: #858585; } &__evidence { color: #4ec9b0; } &__stale { position: absolute; top: 10px; right: 10px; max-width: 105px; color: #f0b45a; font-size: 9px; text-align: right; } &:hover:not(:disabled) { transform: translateY(-2px); border-color: #569cd6; } &--locked { opacity: .42; cursor: not-allowed; } &--available { border-color: #555; } &--learning { border-color: #dcdcaa; background: #302e20; } &--mastered { border-color: #4ec9b0; background: #1b3029; } &--stale { border-color: #9c7136; box-shadow: inset 0 0 0 1px #68471f; } }
.plan-error { max-width: 1200px; margin: -18px auto 24px; padding: 10px 12px; border: 1px solid #a84848; border-radius: 6px; background: #3b2020; color: #f5a3a3; font-size: 12px; }
.plan-modal { position: fixed; inset: 36px 0 0; z-index: 1500; display: flex; align-items: center; justify-content: center; padding: 25px; background: #000a; }
.notes-modal { position: fixed; inset: 36px 0 0; z-index: 1550; background: #181818; }
.plan-card { width: min(820px, 92vw); max-height: 86vh; overflow: auto; padding: 20px; border: 1px solid #4b4b4b; border-radius: 10px; background: #252526; box-shadow: 0 18px 60px #0009; > header { display: flex; justify-content: space-between; align-items: flex-start; h2 { margin: 3px 0 0; } small { color: #858585; } } > p { color: #9e9e9e; font-size: 12px; } }
.plan-card__actions { display: flex; align-items: center; gap: 8px; }.plan-import, .plan-generate { padding: 7px 10px; border: 1px solid #3b6e90; border-radius: 4px; background: #20394a; color: #9cdcfe; cursor: pointer; &:disabled { opacity: .5; cursor: wait; } }.plan-generate { border-color: #4c7d4d; background: #203b27; color: #9fdaa7; }.plan-close { border: 0; background: transparent; color: #aaa; font-size: 24px; cursor: pointer; }
.plan-pager { display: flex; align-items: center; justify-content: center; gap: 12px; margin: 14px 0 4px; button { padding: 5px 9px; border: 1px solid #444; border-radius: 4px; background: #333; color: #ccc; cursor: pointer; &:disabled { opacity: .35; cursor: default; } } span { min-width: 86px; color: #bbb; font-size: 11px; text-align: center; } }
.freshness { display: inline-block; margin-left: 8px; padding: 2px 6px; border-radius: 3px; background: #333; color: #aaa; &--fresh { color: #4ec9b0; } &--aging { color: #dcdcaa; } &--stale { color: #f0b45a; background: #44351e; } }
.plan-list { display: flex; flex-direction: column; gap: 7px; padding: 0; list-style: none; li { display: grid; grid-template-columns: 22px 1fr auto; gap: 9px; align-items: center; padding: 10px; border: 1px solid #3c3c3c; border-radius: 6px; background: #1e1e1e; &.solved { border-color: #31734c; background: #19271e; } > div strong { display: block; color: #ddd; font-size: 13px; } > div small { color: #858585; font-size: 10px; } > div p { margin: 4px 0 0; color: #aaa; font-size: 11px; } > button { padding: 7px 10px; border: 1px solid #3b6e90; border-radius: 4px; background: #20394a; color: #9cdcfe; cursor: pointer; } } &__check { display: inline-flex; align-items: center; justify-content: center; width: 17px; height: 17px; border: 1px solid #3b9a60; border-radius: 3px; color: #54d187; font-size: 11px; } }
</style>
