<script setup lang="ts">
import { computed, ref } from 'vue'
import { SKILL_TREE } from '../data/skillTree'
import { useLearningStore } from '../stores/learningStore'
import type { SkillNode } from '../types'

const emit = defineEmits<{
  close: []
  selectSkill: [skill: SkillNode]
}>()

const learning = useLearningStore()
const solved = computed(() => new Set(learning.profile.solvedProblems))
const selectedCategoryName = ref<string | null>(null)

function practiceCount(skill: SkillNode) {
  const problems = new Set(learning.profile.skillEvidence[skill.id] ?? [])
  for (const plan of learning.plansFor(skill.id)) {
    for (const problem of plan.problems) {
      const key = `${problem.platform}:${problem.id}`
      if (solved.value.has(key)) problems.add(key)
    }
  }
  return problems.size
}

const categories = computed(() => {
  const grouped = new Map<string, SkillNode[]>()
  for (const skill of SKILL_TREE) grouped.set(skill.category, [...(grouped.get(skill.category) ?? []), skill])
  return [...grouped.entries()].map(([name, skills]) => {
    const mastered = skills.filter((skill) => learning.statusOf(skill) === 'mastered').length
    const practiced = skills.filter((skill) => practiceCount(skill) > 0).length
    const active = skills.filter((skill) => ['learning', 'skipped'].includes(learning.statusOf(skill))).length
    return { name, skills, total: skills.length, mastered, practiced, active, coverage: Math.round(practiced / skills.length * 100) }
  }).sort((a, b) => b.practiced - a.practiced || b.mastered - a.mastered || a.name.localeCompare(b.name, 'zh-CN'))
})

const selectedCategory = computed(() => categories.value.find((category) => category.name === selectedCategoryName.value) ?? null)

const practicedSkillCount = computed(() => SKILL_TREE.filter((skill) => practiceCount(skill) > 0).length)
const activeSkillCount = computed(() => SKILL_TREE.filter((skill) => ['learning', 'skipped'].includes(learning.statusOf(skill))).length)

const strengths = computed(() => SKILL_TREE
  .filter((skill) => practiceCount(skill) > 0 && learning.skillFreshness(skill.id).score >= 60)
  .sort((a, b) => learning.skillFreshness(b.id).score - learning.skillFreshness(a.id).score || practiceCount(b) - practiceCount(a))
  .slice(0, 6))

const weaknesses = computed(() => SKILL_TREE
  .filter((skill) => {
    const status = learning.statusOf(skill)
    const freshness = learning.skillFreshness(skill.id)
    return freshness.level === 'stale' || status === 'learning' || status === 'available'
  })
  .sort((a, b) => {
    const priority = (skill: SkillNode) => {
      const freshness = learning.skillFreshness(skill.id)
      if (freshness.level === 'stale') return 0
      if (learning.statusOf(skill) === 'learning') return 1
      return 2
    }
    return priority(a) - priority(b) || a.level - b.level || a.name.localeCompare(b.name, 'zh-CN')
  })
  .slice(0, 6))

function weaknessReason(skill: SkillNode) {
  const freshness = learning.skillFreshness(skill.id)
  if (freshness.level === 'stale') return freshness.label
  if (learning.statusOf(skill) === 'learning') {
    const progress = learning.planProgress(skill.id)
    return progress.total ? `题单完成 ${progress.solved}/${progress.total}` : '正在学习，尚无完成证据'
  }
  return practiceCount(skill) ? freshness.label : '已解锁，尚无练习证据'
}

function statusLabel(skill: SkillNode) {
  const status = learning.statusOf(skill)
  if (status === 'mastered') return '已掌握'
  if (status === 'learning') return '推进中'
  if (status === 'skipped') return '已跳过'
  if (status === 'available') return '可开始'
  return '未解锁'
}

function statusHint(skill: SkillNode) {
  const status = learning.statusOf(skill)
  const progress = learning.planProgress(skill.id)
  if (progress.total) return `题单 ${progress.solved}/${progress.total}`
  if (status === 'locked') {
    const prerequisites = learning.unmetPrerequisites(skill).map((item) => item.name)
    return prerequisites.length ? `需先完成：${prerequisites.join('、')}` : '尚未满足前置条件'
  }
  const count = practiceCount(skill)
  return count ? `${count} 道练习证据` : '尚无练习证据'
}

function openSkill(skill: SkillNode) {
  if (learning.statusOf(skill) !== 'locked') emit('selectSkill', skill)
}
</script>

<template>
  <section class="overview">
    <header class="overview__header">
      <div><small>ALGORITHM MAP</small><h2>算法总览</h2><p>不是标签盘点，而是由实际练习证据生成的学习诊断。</p></div>
      <button class="overview__close" aria-label="关闭算法总览" @click="emit('close')">×</button>
    </header>

    <div class="overview__metrics">
      <article><strong>{{ learning.profile.masteredSkills.length }}</strong><span>已掌握知识点</span><small>占全部 {{ SKILL_TREE.length }} 项的 {{ learning.progress }}%</small></article>
      <article><strong>{{ practicedSkillCount }}</strong><span>有练习证据</span><small>做过相关题目，而非仅手动标记</small></article>
      <article><strong>{{ activeSkillCount }}</strong><span>正在推进</span><small>学习中或为后续暂时跳过</small></article>
      <article><strong>{{ solved.size }}</strong><span>已记录解题</span><small>用于计算知识覆盖与新鲜度</small></article>
    </div>

    <div class="overview__grid">
      <article class="overview-card structure-card">
        <header>
          <div>
            <button v-if="selectedCategory" class="structure-back" @click="selectedCategoryName = null">‹ 返回知识结构</button>
            <h3>{{ selectedCategory ? selectedCategory.name : '知识结构' }}</h3>
            <p v-if="selectedCategory">{{ selectedCategory.mastered }} 个已掌握，{{ selectedCategory.active }} 个正在推进；点击子知识点可继续学习。</p>
            <p v-else>按知识领域查看真实练习覆盖；点击任一领域查看细分知识点。</p>
          </div>
          <span>{{ selectedCategory ? `${selectedCategory.practiced}/${selectedCategory.total} 有练习证据` : '练习覆盖' }}</span>
        </header>
        <div v-if="!selectedCategory" class="category-list">
          <button v-for="category in categories" :key="category.name" class="category-row" @click="selectedCategoryName = category.name">
            <div class="category-row__label"><strong>{{ category.name }}</strong><span>{{ category.mastered }} 掌握 · {{ category.active }} 推进中 · 共 {{ category.total }}</span></div>
            <div class="category-row__bar"><i :style="{ width: `${category.coverage}%` }"></i></div>
            <b>{{ category.coverage }}% <i>›</i></b>
          </button>
        </div>
        <div v-else class="category-detail">
          <button
            v-for="skill in selectedCategory.skills"
            :key="skill.id"
            class="detail-skill"
            :class="`detail-skill--${learning.statusOf(skill)}`"
            :disabled="learning.statusOf(skill) === 'locked'"
            @click="openSkill(skill)"
          >
            <span class="detail-skill__state">{{ statusLabel(skill) }}</span>
            <span class="detail-skill__body">
              <strong>{{ skill.name }}</strong>
              <small>{{ skill.description }}</small>
              <em>{{ statusHint(skill) }} · {{ learning.skillFreshness(skill.id).label }}</em>
            </span>
            <span class="detail-skill__action">{{ learning.statusOf(skill) === 'locked' ? '等待前置' : learning.plansFor(skill.id).length ? '查看题单 ›' : '开始学习 ›' }}</span>
          </button>
        </div>
      </article>

      <div class="overview__side">
        <article class="overview-card insight-card insight-card--strong">
          <header><div><h3>稳定强项</h3><p>必须有解题证据，且当前熟练度达到 60。</p></div><span>◆</span></header>
          <div v-if="strengths.length" class="skill-list">
            <button v-for="skill in strengths" :key="skill.id" @click="emit('selectSkill', skill)">
              <span><strong>{{ skill.name }}</strong><small>{{ practiceCount(skill) }} 道证据 · {{ learning.skillFreshness(skill.id).label }}</small></span><b>{{ learning.skillFreshness(skill.id).score }}</b>
            </button>
          </div>
          <div v-else class="empty-insight">还没有足够证据形成强项。完成技能题单后，这里会自动出现。</div>
        </article>

        <article class="overview-card insight-card insight-card--weak">
          <header><div><h3>优先巩固</h3><p>综合已解锁状态、学习进度和练习衰减排序。</p></div><span>!</span></header>
          <div v-if="weaknesses.length" class="skill-list">
            <button v-for="skill in weaknesses" :key="skill.id" @click="emit('selectSkill', skill)">
              <span><strong>{{ skill.name }}</strong><small>{{ weaknessReason(skill) }}</small></span><em>去练习 ›</em>
            </button>
          </div>
          <div v-else class="empty-insight">当前没有明显短板，继续挑战更高阶段即可。</div>
        </article>
      </div>
    </div>
  </section>
</template>

<style scoped lang="scss">
.overview { height: 100%; overflow-y: auto; padding: 30px 34px 60px; background: var(--color-bg-deep); color: var(--color-text-primary); }
.overview__header { max-width: 1200px; margin: auto; display: flex; align-items: flex-start; justify-content: space-between; gap: 24px; small { color: var(--color-accent-text); font-size: 9px; letter-spacing: .18em; } h2 { margin: 4px 0 3px; font-size: 25px; } p { margin: 0; color: var(--color-text-muted); font-size: 12px; } }
.overview__close { border: 0; background: transparent; color: var(--color-text-soft); font-size: 28px; cursor: pointer; }
.overview__metrics { max-width: 1200px; margin: 22px auto 14px; display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; article { min-width: 0; padding: 16px; border: 1px solid var(--color-border); border-radius: 9px; background: var(--color-bg-panel); } strong, span, small { display: block; } strong { color: var(--color-text-strong); font-size: 25px; } span { margin-top: 3px; font-size: 12px; } small { margin-top: 5px; color: var(--color-text-muted); font-size: 9px; line-height: 1.4; } }
.overview__grid { max-width: 1200px; margin: auto; display: grid; grid-template-columns: minmax(420px, 1.25fr) minmax(340px, .85fr); gap: 12px; }
.overview-card { min-width: 0; border: 1px solid var(--color-border); border-radius: 9px; background: var(--color-bg-panel); overflow: hidden; > header { display: flex; justify-content: space-between; gap: 16px; padding: 16px 18px; border-bottom: 1px solid var(--color-bg-subtle); h3 { margin: 0; font-size: 15px; } p { margin: 4px 0 0; color: var(--color-text-muted); font-size: 10px; line-height: 1.4; } > span { color: var(--color-text-muted); font-size: 10px; white-space: nowrap; } } }
.category-list { max-height: 520px; overflow-y: auto; padding: 8px 10px 16px; }
.category-row { width: 100%; display: grid; grid-template-columns: minmax(125px, 1fr) minmax(90px, 1.1fr) 48px; align-items: center; gap: 10px; padding: 9px 8px; border: 0; border-radius: 6px; background: transparent; color: var(--color-text-primary); text-align: left; cursor: pointer; transition: background .15s, transform .15s; &:hover { background: var(--color-bg-subtle); transform: translateX(2px); } &:focus-visible { outline: 1px solid var(--color-accent); outline-offset: -1px; } &__label { min-width: 0; strong, span { display: block; } strong { font-size: 11px; } span { margin-top: 2px; overflow: hidden; color: var(--color-text-muted); font-size: 8px; text-overflow: ellipsis; white-space: nowrap; } } &__bar { height: 6px; overflow: hidden; border-radius: 9px; background: var(--color-bg-subtle); i { display: block; height: 100%; border-radius: inherit; background: linear-gradient(90deg, var(--color-accent-strong), var(--color-success)); } } > b { color: var(--color-text-secondary); font-size: 10px; text-align: right; white-space: nowrap; i { margin-left: 2px; color: var(--color-accent-text); font-size: 14px; font-style: normal; } } }
.structure-back { margin: 0 0 7px; padding: 0; border: 0; background: transparent; color: var(--color-accent-text); font-size: 9px; cursor: pointer; &:hover { color: var(--color-text-strong); } }
.category-detail { max-height: 520px; overflow-y: auto; padding: 8px 10px 16px; }
.detail-skill { width: 100%; display: grid; grid-template-columns: 48px minmax(0, 1fr) auto; align-items: center; gap: 10px; padding: 10px 8px; border: 0; border-bottom: 1px solid var(--color-bg-subtle); background: transparent; color: var(--color-text-primary); text-align: left; cursor: pointer; &:hover:not(:disabled) { border-radius: 6px; background: var(--color-bg-subtle); } &:disabled { opacity: .48; cursor: not-allowed; } &__state { padding: 3px 5px; border: 1px solid var(--color-border-strong); border-radius: 10px; color: var(--color-text-secondary); font-size: 8px; text-align: center; white-space: nowrap; } &__body { min-width: 0; strong, small, em { display: block; } strong { font-size: 11px; } small { margin-top: 3px; color: var(--color-text-soft); font-size: 9px; } em { margin-top: 4px; overflow: hidden; color: var(--color-text-muted); font-size: 8px; font-style: normal; text-overflow: ellipsis; white-space: nowrap; } } &__action { color: var(--color-accent-text); font-size: 9px; white-space: nowrap; } &--mastered .detail-skill__state { border-color: var(--color-success); color: var(--color-success); } &--learning .detail-skill__state, &--skipped .detail-skill__state { border-color: var(--color-warning-strong); color: var(--color-warning); } &--available .detail-skill__state { border-color: var(--color-accent); color: var(--color-accent-text); } }
.overview__side { display: flex; min-width: 0; flex-direction: column; gap: 12px; }
.insight-card { flex: 1; &--strong > header > span { color: var(--color-success); font-size: 18px; } &--weak > header > span { display: flex; align-items: center; justify-content: center; width: 21px; height: 21px; border: 1px solid var(--color-warning-strong); border-radius: 50%; color: var(--color-warning); font-size: 12px; } }
.skill-list { padding: 7px; button { width: 100%; display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 9px 10px; border: 0; border-radius: 5px; background: transparent; color: var(--color-text-primary); text-align: left; cursor: pointer; &:hover { background: var(--color-bg-subtle); } span { min-width: 0; } strong, small { display: block; } strong { font-size: 11px; } small { margin-top: 3px; overflow: hidden; color: var(--color-text-muted); font-size: 8px; text-overflow: ellipsis; white-space: nowrap; } b { color: var(--color-success); font-size: 15px; } em { color: var(--color-warning); font-size: 9px; font-style: normal; white-space: nowrap; } } }
.empty-insight { padding: 24px 18px; color: var(--color-text-muted); font-size: 11px; line-height: 1.6; }
@media (max-width: 900px) { .overview__metrics { grid-template-columns: repeat(2, 1fr); } .overview__grid { grid-template-columns: 1fr; } }
@media (max-width: 560px) { .overview { padding: 22px 18px 48px; } .overview__metrics { grid-template-columns: 1fr 1fr; } .category-row { grid-template-columns: minmax(110px, 1fr) 70px 46px; } .detail-skill { grid-template-columns: 45px minmax(0, 1fr); &__action { display: none; } } }
</style>
