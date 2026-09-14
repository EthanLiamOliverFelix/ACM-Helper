<script setup lang="ts">
import { useProblemStore } from '../stores/problemStore'

const store = useProblemStore()
</script>

<template>
  <aside class="sidebar">
    <div class="sidebar__header">
      <h2 class="sidebar__title">ACM Helper</h2>
    </div>

    <div class="sidebar__views">
      <button :class="{ active: store.activeView === 'workspace' }" @click="store.activeView = 'workspace'">⌨ 刷题工作台</button>
      <button :class="{ active: store.activeView === 'learning' }" @click="store.activeView = 'learning'">◆ 技能树与 VP</button>
      <button :class="{ active: store.activeView === 'ai' }" @click="store.activeView = 'ai'">✦ AI 辅助</button>
    </div>

    <!-- 题目列表插槽 -->
    <div class="sidebar__list">
      <slot />
    </div>
  </aside>
</template>

<style scoped lang="scss">
.sidebar {
  width: 250px;
  min-width: 250px;
  height: 100%;
  background: var(--color-bg-app);
  border-right: 1px solid var(--color-border);
  display: flex;
  flex-direction: column;
  overflow: hidden;

  &__header {
    padding: 16px 20px;
    border-bottom: 1px solid var(--color-tone-2d2d2d);
  }

  &__title {
    margin: 0;
    font-size: 18px;
    font-weight: 700;
    color: var(--color-accent);
    letter-spacing: 0.5px;
  }

  &__platforms {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 8px;
  }

  &__views { display: flex; gap: 5px; padding: 8px; button { flex: 1; padding: 7px 3px; border: 1px solid var(--color-bg-subtle); border-radius: 5px; background: transparent; color: var(--color-text-muted); font-size: 11px; cursor: pointer; } button.active { background: var(--color-selection); color: var(--color-text-on-accent); border-color: var(--color-accent); } }

  &__divider {
    height: 1px;
    margin: 4px 12px;
    background: var(--color-border);
  }

  &__list {
    flex: 1;
    overflow-y: auto;
    padding: 4px 0;
  }
}

.platform-btn {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 10px 16px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--color-tone-cccccc);
  font-size: 14px;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;

  &:hover {
    background: var(--color-bg-hover);
    color: var(--color-tone-e0e0e0);
  }

  &--active {
    background: var(--color-bg-selected);
    color: var(--color-text-on-accent);

    .platform-btn__icon {
      background: var(--color-accent);
    }
  }

  &__icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border-radius: 6px;
    background: var(--color-border-input);
    color: var(--color-text-on-accent);
    font-size: 13px;
    font-weight: 700;
    flex-shrink: 0;
  }

  &__label {
    font-size: 14px;
  }
}
</style>
