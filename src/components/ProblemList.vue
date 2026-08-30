<script setup lang="ts">
import { useProblemStore } from '../stores/problemStore'
import { defineAsyncComponent, ref } from 'vue'
import { useProblemSetStore } from '../stores/problemSetStore'
import { useLearningStore } from '../stores/learningStore'

const store = useProblemStore()
const learning = useLearningStore()
const problemSets = useProblemSetStore()
const ResourceExplorer = defineAsyncComponent(() => import('./ResourceExplorer.vue'))
const ProblemSets = defineAsyncComponent(() => import('./ProblemSets.vue'))
const panelMode = ref<'problems' | 'sets' | 'files'>('problems')
const sourceOptions = [
  { key: 'codeforces' as const, label: 'Codeforces' },
  { key: 'luogu' as const, label: '洛谷' },
  { key: 'atcoder' as const, label: 'AtCoder' },
  { key: 'qoj' as const, label: 'QOJ' },
]

const difficultyColor: Record<string, string> = {
  '暂无评定': '#bfbfbf', '入门': '#fe4c61', '普及-': '#f39c11', '普及': '#ffc116',
  '普及+/提高-': '#52c41a', '提高': '#13c2c2', '提高+/省选-': '#3498db',
  '省选/NOI-': '#9d3dcf', 'NOI/NOI+/CTS': '#7187d8',
}

const ratingPresets = [
  { label: '全部', min: null, max: null },
  { label: '≤1200', min: null, max: 1200 },
  { label: '1200-1600', min: 1200, max: 1600 },
  { label: '1600-2000', min: 1600, max: 2000 },
  { label: '2000+', min: 2000, max: null },
]
const luoguDifficulties = [
  { label: '全部', value: null }, { label: '入门', value: 1 }, { label: '普及-', value: 2 },
  { label: '普及', value: 3 }, { label: '普及+/提高-', value: 4 }, { label: '提高', value: 5 },
  { label: '提高+/省选-', value: 6 }, { label: '省选/NOI-', value: 7 }, { label: 'NOI/NOI+/CTS', value: 8 },
]
const luoguSources = [
  { label: '全部题库', value: '' }, { label: '洛谷题库', value: 'P' }, { label: '入门与面试', value: 'B' },
  { label: 'Codeforces', value: 'CF' }, { label: 'SPOJ', value: 'SP' },
  { label: 'AtCoder', value: 'AT' }, { label: 'UVA', value: 'UVA' },
]

function applyRatingPreset(preset: typeof ratingPresets[number]) {
  store.minRating = preset.min
  store.maxRating = preset.max
  store.setPage(1)
}

async function applyLuoguDifficulty(value: number | null) {
  store.luoguDifficulty = value
  await store.applyProblemFilters()
}

async function applyLuoguSource(value: string) {
  store.luoguType = value
  await store.applyProblemFilters()
}

function onSearchInput() {
  if (store.currentPlatform !== 'luogu') store.setPage(1)
}

</script>

<template>
  <div class="problem-list">
    <div class="problem-list__tabs">
      <button :class="{ active: panelMode === 'problems' }" @click="panelMode = 'problems'">题库</button>
      <button :class="{ active: panelMode === 'sets' }" @click="panelMode = 'sets'">题单</button>
      <button :class="{ active: panelMode === 'files' }" @click="panelMode = 'files'">资源管理器</button>
    </div>
    <ResourceExplorer v-if="panelMode === 'files'" />
    <ProblemSets v-else-if="panelMode === 'sets'" />
    <template v-else>
    <div class="problem-list__sources">
      <span>来源</span>
      <button v-for="source in sourceOptions" :key="source.key" :class="{ active: store.currentPlatform === source.key }" @click="store.setPlatform(source.key)">{{ source.label }}</button>
    </div>
    <div class="problem-import">
      <input v-model="store.importUrl" placeholder="粘贴 CF / AtCoder / QOJ / 洛谷题目链接" @keyup.enter="store.importProblem" />
      <button :disabled="store.isImporting || !store.importUrl.trim()" @click="store.importProblem">{{ store.isImporting ? '抓取中…' : '导入' }}</button>
    </div>
    <div v-if="store.error && store.activeView === 'workspace'" class="problem-import__error">{{ store.error }}</div>
    <!-- 搜索框 -->
    <div class="problem-list__search">
      <input
        v-model="store.searchQuery"
        type="text"
        class="search-input"
        placeholder="搜索题号 / 标题..."
        @input="onSearchInput"
        @keyup.enter="store.applyProblemFilters()"
      />
      <button class="search-button" :disabled="store.isLoadingCatalog" @click="store.applyProblemFilters()">{{ store.isLoadingCatalog ? '查询中…' : '搜索' }}</button>
    </div>

    <div class="problem-list__filter-row">
      <details class="filter-menu">
        <summary>题目难度范围⌄</summary>
        <div class="filter-menu__popup">
          <template v-if="store.currentPlatform === 'luogu'">
            <button v-for="p in luoguDifficulties" :key="p.label" class="rating-chip" :class="{ 'rating-chip--active': store.luoguDifficulty === p.value }" @click.prevent="applyLuoguDifficulty(p.value)">{{ p.label }}</button>
          </template>
          <template v-else>
            <button v-for="p in ratingPresets" :key="p.label" class="rating-chip" :class="{ 'rating-chip--active': store.minRating === p.min && store.maxRating === p.max }" @click.prevent="applyRatingPreset(p)">{{ p.label }}</button>
          </template>
        </div>
      </details>
      <details v-if="store.currentPlatform === 'luogu'" class="filter-menu">
        <summary>题库来源⌄</summary>
        <div class="filter-menu__popup">
          <button v-for="source in luoguSources" :key="source.value" class="rating-chip" :class="{ 'rating-chip--active': store.luoguType === source.value }" @click.prevent="applyLuoguSource(source.value)">{{ source.label }}</button>
        </div>
      </details>
      <details v-if="store.allTags.length" class="filter-menu filter-menu--wide">
        <summary>知识点分类⌄</summary>
        <div class="filter-menu__popup problem-list__tags-scroll">
        <button
          v-for="tag in store.allTags"
          :key="tag"
          class="tag-chip"
          :class="{ 'tag-chip--active': store.selectedTags.has(tag) }"
          @click="store.toggleTag(tag)"
        >
          {{ tag }}
        </button>
        </div>
      </details>
    </div>

    <div class="problem-list__selected">
      <span>已选择</span>
      <button v-if="store.currentPlatform === 'luogu' && store.luoguDifficulty != null" @click="applyLuoguDifficulty(null)">难度 {{ luoguDifficulties.find(p => p.value === store.luoguDifficulty)?.label }} ×</button>
      <button v-else-if="store.minRating != null || store.maxRating != null" @click="applyRatingPreset(ratingPresets[0])">难度 {{ store.minRating ?? 0 }}–{{ store.maxRating ?? '∞' }} ×</button>
      <button v-if="store.currentPlatform === 'luogu' && store.luoguType" @click="applyLuoguSource('')">来源 {{ luoguSources.find(p => p.value === store.luoguType)?.label }} ×</button>
      <button v-for="tag in store.selectedTags" :key="tag" @click="store.toggleTag(tag)">{{ tag }} ×</button>
      <em v-if="store.minRating == null && store.maxRating == null && store.luoguDifficulty == null && !store.luoguType && !store.selectedTags.size">暂无，可在上方进行多维度筛选</em>
    </div>

    <!-- 筛选状态栏 -->
    <div class="problem-list__status">
      <span>共 {{ store.currentPlatform === 'luogu' ? store.luoguTotal : store.filteredProblems.length }} 道</span>
      <div class="problem-list__status-actions">
        <button
          v-if="store.currentPlatform === 'codeforces'"
          class="catalog-refresh-btn"
          :disabled="store.isRefreshingCfCatalog"
          title="忽略本地目录缓存，立即从 Codeforces 拉取最新题目"
          @click="store.refreshCfCatalog()"
        >{{ store.isRefreshingCfCatalog ? '更新中…' : '更新题库' }}</button>
        <button v-if="store.currentPlatform === 'atcoder'" class="catalog-refresh-btn" :disabled="store.isRefreshingAtCoderCatalog" title="从 AtCoder Problems 数据集更新题目目录" @click="store.fetchAtCoderProblems(true)">{{ store.isRefreshingAtCoderCatalog ? '更新中…' : '更新题库' }}</button>
        <button class="tag-visibility-btn" :class="{ active: store.showProblemTags }" :title="store.showProblemTags ? '隐藏题目算法标签，避免知识点剧透' : '显示题目算法标签'" @click="store.toggleProblemTags">
          {{ store.showProblemTags ? '隐藏算法标签' : '显示算法标签' }}
        </button>
        <button
          v-if="store.searchQuery || store.minRating || store.maxRating || store.luoguDifficulty || store.luoguType || store.selectedTags.size"
          class="clear-btn"
          @click="store.resetProblemFilters()"
        >
          清除筛选
        </button>
      </div>
    </div>

    <!-- 题目列表 -->
    <ul class="problem-list__items">
      <li
        v-for="problem in store.pagedProblems"
        :key="`${problem.platform}:${problem.id}`"
        class="problem-item"
        :class="{ 'problem-item--active': store.currentProblem?.id === problem.id && store.currentProblem?.platform === problem.platform }"
        @click="store.selectProblem(problem)"
      >
        <div class="problem-item__id">{{ problem.id }}</div>
        <div class="problem-item__body">
          <span class="problem-item__title"><span v-if="learning.profile.solvedProblems.includes(`${problem.platform}:${problem.id}`)" class="problem-item__solved" title="已完成">✓</span>{{ problem.title }}</span>
          <div class="problem-item__meta">
            <span
              v-if="problem.platform === 'luogu' && problem.difficulty"
              class="problem-item__difficulty"
              :style="{ color: difficultyColor[problem.difficulty] }"
            >
              ● {{ problem.difficulty }}
            </span>
            <span v-if="problem.rating" class="problem-item__rating">
              ★ {{ problem.rating }}
            </span>
          </div>
        </div>
        <div v-if="store.showProblemTags" class="problem-item__tags">
          <span v-for="tag in problem.tags" :key="tag" class="tag">{{ tag }}</span>
        </div>
        <button
          v-if="problem.platform === 'codeforces' || problem.platform === 'luogu' || problem.platform === 'atcoder' || problem.platform === 'qoj'"
          class="problem-item__add"
          :class="{ added: problemSets.contains(problem) }"
          :title="problemSets.contains(problem) ? `已在「${problemSets.activeSet?.name}」中` : `加入「${problemSets.activeSet?.name}」`"
          @click.stop="problemSets.addProblem(problem)"
        >{{ problemSets.contains(problem) ? '✓' : '＋' }}</button>
      </li>
    </ul>

    <!-- 分页 -->
    <div class="problem-list__pagination">
      <button
        class="page-btn"
        :disabled="store.page <= 1"
        @click="store.setPage(store.page - 1)"
      >
        ‹ 上一页
      </button>
      <span class="page-info">{{ store.page }} / {{ store.totalPages }}</span>
      <button
        class="page-btn"
        :disabled="store.page >= store.totalPages"
        @click="store.setPage(store.page + 1)"
      >
        下一页 ›
      </button>
    </div>
    </template>
  </div>
</template>

<style scoped lang="scss">
.problem-list {
  display: flex;
  flex-direction: column;
  height: 100%;

  &__search {
    display: flex;
    gap: 5px;
    padding: 8px 12px;
    flex-shrink: 0;
  }

  &__tabs { display: flex; padding: 5px 9px; gap: 3px; border-bottom: 1px solid #333; button { flex: 1; padding: 6px; border: 0; border-radius: 4px; background: transparent; color: #888; cursor: pointer; font-size: 11px; } button.active { background: #37373d; color: white; } }

  &__ratings {
    display: flex;
    gap: 4px;
    padding: 0 12px 6px;
    flex-shrink: 0;
    flex-wrap: wrap;
  }

  &__sources { display: flex; align-items: center; gap: 3px; padding: 7px 10px 2px; span { margin-right: 3px; color: #777; font-size: 10px; } button { padding: 4px 7px; border: 0; border-radius: 4px; background: transparent; color: #aaa; font-size: 10px; cursor: pointer; } button.active { background: #1684c7; color: white; } }
  &__filter-row { display: flex; gap: 5px; padding: 3px 10px 5px; }
  &__selected { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; padding: 4px 10px 7px; color: #777; font-size: 10px; span { margin-right: 2px; } em { color: #666; font-style: normal; } button { padding: 2px 5px; border: 1px solid #3b5b72; border-radius: 3px; background: #203545; color: #9cdcfe; font-size: 9px; cursor: pointer; } }

  &__tags-filter {
    padding: 0 12px 6px;
    flex-shrink: 0;
  }

  &__tags-scroll {
    display: flex;
    flex-wrap: wrap;
    gap: 3px;
    max-height: 80px;
    overflow-y: auto;
  }

  &__status {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 6px 20px;
    font-size: 12px;
    color: #858585;
    flex-shrink: 0;
  }

  &__status-actions { display: flex; align-items: center; gap: 5px; }

  &__items {
    list-style: none;
    margin: 0;
    padding: 0;
    flex: 1;
    overflow-y: auto;
  }

  &__pagination {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 12px;
    padding: 8px 12px;
    border-top: 1px solid #3c3c3c;
    flex-shrink: 0;
  }
}

.problem-item { content-visibility: auto; contain-intrinsic-size: 76px; }
.problem-item__solved { display: inline-flex; align-items: center; justify-content: center; width: 13px; height: 13px; margin-right: 6px; border: 1px solid #36b36a; border-radius: 2px; color: #4ec982; font-size: 9px; font-weight: 700; vertical-align: 1px; }
.filter-menu { position: relative; flex: 1; min-width: 0; summary { padding: 6px 7px; border: 1px solid #444; border-radius: 4px; color: #bbb; background: #252526; font-size: 10px; cursor: pointer; list-style: none; } &__popup { position: absolute; z-index: 50; top: calc(100% + 3px); left: 0; display: flex; flex-wrap: wrap; gap: 4px; width: 210px; max-height: 240px; overflow: auto; padding: 8px; border: 1px solid #555; border-radius: 5px; background: #252526; box-shadow: 0 8px 22px #0008; } &--wide .filter-menu__popup { left: auto; right: 0; width: 300px; } }
.problem-import { display: flex; gap: 5px; padding: 8px 12px 2px; input { min-width: 0; flex: 1; padding: 6px 7px; border: 1px solid #3c3c3c; border-radius: 4px; background: #252526; color: #ddd; font-size: 10px; outline: none; } input:focus { border-color: #569cd6; } button { padding: 0 9px; border: 0; border-radius: 4px; background: #0e639c; color: white; font-size: 10px; cursor: pointer; } button:disabled { opacity: .4; } &__error { padding: 4px 12px; color: #f48771; font-size: 10px; line-height: 1.4; } }

// ── 搜索输入 ──
.search-input {
  min-width: 0;
  flex: 1;
  padding: 7px 10px;
  border: 1px solid #3c3c3c;
  border-radius: 6px;
  background: #2d2d30;
  color: #d4d4d4;
  font-size: 13px;
  outline: none;
  transition: border-color 0.15s;

  &::placeholder { color: #6a6a6a; }
  &:focus { border-color: #569cd6; }
}
.search-button { flex: 0 0 auto; padding: 0 10px; border: 0; border-radius: 5px; background: #0e639c; color: white; cursor: pointer; font-size: 11px; &:disabled { opacity: .5; } }

// ── 难度快捷按钮 ──
.rating-chip {
  padding: 2px 8px;
  border: 1px solid #3c3c3c;
  border-radius: 10px;
  background: transparent;
  color: #9a9a9a;
  font-size: 11px;
  cursor: pointer;
  transition: all 0.12s;

  &:hover { border-color: #569cd6; color: #d4d4d4; }
  &--active { background: #264f78; border-color: #569cd6; color: #fff; }
}

// ── 标签选择 ──
.tag-chip {
  padding: 2px 7px;
  border: 1px solid #3c3c3c;
  border-radius: 4px;
  background: transparent;
  color: #9a9a9a;
  font-size: 10px;
  cursor: pointer;
  transition: all 0.12s;
  white-space: nowrap;

  &:hover { border-color: #9cdcfe; color: #d4d4d4; }
  &--active { background: #1b3a2e; border-color: #4ec9b0; color: #4ec9b0; }
}

// ── 清除按钮 ──
.clear-btn {
  background: none;
  border: none;
  color: #f44747;
  font-size: 11px;
  cursor: pointer;
  padding: 2px 6px;
  border-radius: 3px;
  &:hover { background: #3a1b1b; }
}
.tag-visibility-btn { padding: 3px 7px; border: 1px solid #444; border-radius: 4px; background: #292929; color: #aaa; font-size: 10px; cursor: pointer; &:hover, &.active { border-color: #4d718f; color: #9cdcfe; background: #203545; } }
.catalog-refresh-btn { padding: 3px 7px; border: 1px solid #456b5b; border-radius: 4px; background: #20332b; color: #8fd5b2; font-size: 10px; cursor: pointer; &:disabled { opacity: .5; cursor: wait; } }

// ── 题目列表项 ──
.problem-item {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 10px 20px;
  cursor: pointer;
  border-left: 3px solid transparent;
  transition: background 0.12s, border-color 0.12s;

  &:hover { background: #2a2d2e; }
  &--active { background: #37373d; border-left-color: #569cd6; }

  &__id {
    font-size: 11px;
    color: #858585;
    font-family: 'Consolas', 'Courier New', monospace;
  }

  &__body {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }

  &__title {
    font-size: 14px;
    color: #d4d4d4;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  &__meta { flex-shrink: 0; }
  &__difficulty { font-size: 11px; font-weight: 600; }
  &__rating { font-size: 11px; color: #dcdcaa; font-weight: 600; }

  &__tags {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }
}
.problem-item__add { position: absolute; top: 8px; right: 7px; width: 23px; height: 23px; padding: 0; border: 1px solid #444; border-radius: 4px; background: #292929; color: #9cdcfe; cursor: pointer; opacity: 0; transition: opacity .12s; &.added { color: #4ec9b0; opacity: .65; } }
.problem-item:hover .problem-item__add { opacity: 1; }

.tag {
  display: inline-block;
  padding: 1px 6px;
  border-radius: 3px;
  background: #3c3c3c;
  color: #9cdcfe;
  font-size: 10px;
  font-family: 'Consolas', 'Courier New', monospace;
}

// ── 翻页按钮 ──
.page-btn {
  padding: 4px 12px;
  border: 1px solid #3c3c3c;
  border-radius: 4px;
  background: transparent;
  color: #cccccc;
  font-size: 12px;
  cursor: pointer;
  transition: all 0.12s;

  &:hover:not(:disabled) { border-color: #569cd6; color: #fff; }
  &:disabled { opacity: 0.3; cursor: not-allowed; }
}

.page-info {
  font-size: 12px;
  color: #858585;
  font-family: 'Consolas', 'Courier New', monospace;
}
</style>
