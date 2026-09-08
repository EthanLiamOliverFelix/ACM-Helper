<script setup lang="ts">
import { computed } from 'vue'
import { useLearningStore } from '../stores/learningStore'
import { usePracticeStore } from '../stores/practiceStore'
import { useProblemStore } from '../stores/problemStore'
import { buildPracticeStatistics } from '../utils/practiceStats'

defineEmits<{ close: [] }>()
const learning = useLearningStore()
const practice = usePracticeStore()
const problems = useProblemStore()
const statistics = computed(() => buildPracticeStatistics(problems.submissions, learning.profile.solvedProblems))
const activityMax = computed(() => Math.max(1, ...statistics.value.activity.map((day) => day.submissions)))
const verdictMax = computed(() => Math.max(1, ...statistics.value.verdicts.map((item) => item.count)))
const languageMax = computed(() => Math.max(1, ...statistics.value.languages.map((item) => item.count)))
</script>

<template>
  <div class="statistics-view">
    <header>
      <div><h2>做题数据统计</h2><p>根据本机数据中心中的完成状态与提交记录实时汇总</p></div>
      <button aria-label="关闭" @click="$emit('close')">×</button>
    </header>

    <main>
      <section class="summary-grid">
        <article><span>已完成题目</span><strong>{{ statistics.solvedProblems }}</strong><small>按平台和题号去重</small></article>
        <article><span>提交次数</span><strong>{{ statistics.submissionCount }}</strong><small>本机保存的提交记录</small></article>
        <article><span>评测通过率</span><strong>{{ statistics.acceptanceRate }}%</strong><small>{{ statistics.acceptedSubmissions }}/{{ statistics.judgedSubmissions }} 次已完成评测</small></article>
        <article><span>活跃天数</span><strong>{{ statistics.activeDays }}</strong><small>当前连续 {{ statistics.currentStreak }} 天 · 最长 {{ statistics.longestStreak }} 天</small></article>
        <article><span>近 7 天 AC</span><strong>{{ statistics.solvedLast7Days }}</strong><small>首次通过的不同题目</small></article>
        <article><span>近 30 天提交</span><strong>{{ statistics.submissionsLast30Days }}</strong><small>包含通过与未通过</small></article>
      </section>

      <section class="statistics-card activity-card">
        <div class="card-heading"><div><h3>近 14 天活跃度</h3><p>柱高表示提交次数，绿色数字表示当天通过的不同题目数</p></div></div>
        <div class="activity-chart">
          <div v-for="day in statistics.activity" :key="day.date" class="activity-day" :title="`${day.date}：${day.submissions} 次提交，${day.acceptedProblems} 道 AC`">
            <span>{{ day.acceptedProblems || '' }}</span>
            <div><i :style="{ height: `${Math.max(day.submissions ? 8 : 2, day.submissions / activityMax * 100)}%` }" :class="{ empty: !day.submissions }" /></div>
            <small>{{ day.label }}</small>
          </div>
        </div>
      </section>

      <div class="detail-grid">
        <section class="statistics-card">
          <div class="card-heading"><div><h3>平台分布</h3><p>完成题目 / 提交次数</p></div></div>
          <div class="platform-list">
            <div v-for="platform in statistics.platforms" :key="platform.id"><strong>{{ platform.label }}</strong><span>{{ platform.solved }} 道</span><small>{{ platform.submissions }} 次提交</small></div>
          </div>
        </section>
        <section class="statistics-card">
          <div class="card-heading"><div><h3>评测结果</h3><p>不统计等待中、编译中和运行中的记录</p></div></div>
          <div v-if="statistics.verdicts.length" class="bar-list">
            <div v-for="item in statistics.verdicts" :key="item.verdict"><span>{{ item.label }}</span><div><i :style="{ width: `${item.count / verdictMax * 100}%` }" /></div><b>{{ item.count }}</b></div>
          </div>
          <p v-else class="empty-state">暂无评测记录</p>
        </section>
        <section class="statistics-card">
          <div class="card-heading"><div><h3>语言使用</h3><p>按提交次数统计</p></div></div>
          <div v-if="statistics.languages.length" class="bar-list language-list">
            <div v-for="item in statistics.languages" :key="item.id"><span>{{ item.label }}</span><div><i :style="{ width: `${item.count / languageMax * 100}%` }" /></div><b>{{ item.count }}</b></div>
          </div>
          <p v-else class="empty-state">暂无提交记录</p>
        </section>
        <section class="statistics-card review-card">
          <div class="card-heading"><div><h3>错题复习</h3><p>来自自动错题本</p></div></div>
          <div><article><strong>{{ practice.wrongProblems.length }}</strong><span>当前错题</span></article><article><strong>{{ practice.todayProblems.length }}</strong><span>今日待复习</span></article><article><strong>{{ practice.archivedCount }}</strong><span>已掌握归档</span></article></div>
        </section>
      </div>

      <p class="statistics-note">“已完成题目”包含手动标记和本机记录到的 AC；其他统计仅基于本软件保存的提交历史，不代表各 OJ 账号的全部历史数据。</p>
    </main>
  </div>
</template>

<style scoped lang="scss">
.statistics-view { height: 100%; overflow-y: auto; background: #181818; color: #d4d4d4; > header { position: sticky; top: 0; z-index: 2; display: flex; align-items: center; justify-content: space-between; padding: 18px 26px; border-bottom: 1px solid #363636; background: #202020ee; backdrop-filter: blur(8px); h2 { margin: 0; font-size: 20px; } p { margin: 5px 0 0; color: #858585; font-size: 11px; } button { border: 0; background: transparent; color: #aaa; font-size: 27px; cursor: pointer; } } > main { width: min(1120px, calc(100% - 44px)); margin: 0 auto; padding: 24px 0 42px; } }
.summary-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; article { padding: 16px; border: 1px solid #3b4750; border-radius: 8px; background: linear-gradient(145deg, #252b30, #222); span, small { display: block; color: #8fa0ab; font-size: 10px; } strong { display: block; margin: 7px 0 5px; color: #75bfff; font-size: 25px; } small { color: #707b82; } } }
.statistics-card { padding: 17px; border: 1px solid #3a3a3a; border-radius: 9px; background: #242424; }.activity-card { margin-top: 12px; }.card-heading { display: flex; justify-content: space-between; h3 { margin: 0; font-size: 14px; } p { margin: 4px 0 0; color: #7f7f7f; font-size: 10px; } }
.activity-chart { display: grid; grid-template-columns: repeat(14, 1fr); gap: 7px; height: 155px; margin-top: 16px; }.activity-day { display: grid; grid-template-rows: 16px 1fr 17px; min-width: 0; text-align: center; > span { color: #69d498; font-size: 9px; } > div { position: relative; display: flex; align-items: flex-end; justify-content: center; min-height: 75px; border-bottom: 1px solid #414141; i { display: block; width: min(24px, 72%); min-height: 2px; border-radius: 3px 3px 0 0; background: linear-gradient(#569cd6, #27658f); &.empty { background: #3a3a3a; } } } small { overflow: hidden; padding-top: 5px; color: #777; font-size: 8px; white-space: nowrap; } }
.detail-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 12px; }.platform-list { display: grid; gap: 7px; margin-top: 14px; > div { display: grid; grid-template-columns: 1fr auto auto; gap: 15px; align-items: center; padding: 9px 10px; border-radius: 5px; background: #1d1d1d; strong { font-size: 11px; } span { color: #69d498; font-size: 11px; } small { min-width: 70px; color: #777; font-size: 9px; text-align: right; } } }
.bar-list { display: grid; gap: 8px; margin-top: 14px; > div { display: grid; grid-template-columns: 58px 1fr 26px; gap: 8px; align-items: center; span, b { font-size: 9px; } b { color: #aaa; text-align: right; } > div { height: 7px; overflow: hidden; border-radius: 4px; background: #333; i { display: block; height: 100%; border-radius: inherit; background: #c15d5d; } } } }.language-list > div > div i { background: #9b7bc1; }
.review-card > div:last-child { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-top: 14px; article { padding: 13px 8px; border-radius: 6px; background: #1d1d1d; text-align: center; strong, span { display: block; } strong { color: #e0bd63; font-size: 20px; } span { margin-top: 4px; color: #858585; font-size: 9px; } } }.empty-state { padding: 20px 0; color: #666; font-size: 10px; text-align: center; }.statistics-note { margin: 14px 2px 0; color: #707070; font-size: 9px; line-height: 1.5; }
@media (max-width: 760px) { .summary-grid { grid-template-columns: repeat(2, 1fr); }.detail-grid { grid-template-columns: 1fr; }.activity-chart { gap: 3px; }.statistics-view > main { width: calc(100% - 24px); } }
</style>
