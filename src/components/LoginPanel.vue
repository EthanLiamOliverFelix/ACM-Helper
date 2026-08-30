<script setup lang="ts">
import { useProblemStore } from '../stores/problemStore'

const store = useProblemStore()

/** 通过内嵌浏览器登录 */
async function handleBrowserLogin() {
  await store.loginViaBrowser()
}

/** 跳过登录，直接浏览题目 */
async function handleSkip() {
  store.isLoggedIn = true
  await store.fetchProblems()
}

</script>

<template>
  <div class="login-view">
    <div class="login-card">
      <!-- 品牌 -->
      <div class="login-card__brand">
        <div class="login-card__logo">CF</div>
        <h1 class="login-card__title">Codeforces 登录</h1>
        <p class="login-card__subtitle">登录以获取题目列表和提交评测</p>
      </div>

      <div class="login-form">
        <!-- 错误提示 -->
        <div v-if="store.error" class="login-form__error">
          {{ store.error }}
        </div>

        <!-- 官方页面登录 -->
        <button
          type="button"
          class="login-form__browser-btn"
          @click="handleBrowserLogin"
        >
          🌐 在 Codeforces 官方页面登录
        </button>

        <button
          type="button"
          class="login-form__skip"
          @click="handleSkip"
        >
          跳过登录，直接浏览题目 →
        </button>
      </div>

      <!-- 提示 -->
      <p class="login-card__hint">
        应用不会读取密码或导出 Cookie；官方 WebView 会持久保存登录会话
      </p>
    </div>
  </div>
</template>

<style scoped lang="scss">
.login-view {
  width: 100vw;
  height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #1e1e1e;
}

.login-card {
  width: 400px;
  max-width: 90vw;
  background: #252526;
  border: 1px solid #3c3c3c;
  border-radius: 12px;
  padding: 40px 36px;

  &__brand {
    text-align: center;
    margin-bottom: 32px;
  }

  &__logo {
    width: 56px;
    height: 56px;
    margin: 0 auto 16px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: #0e639c;
    border-radius: 12px;
    font-size: 24px;
    font-weight: 800;
    color: #fff;
  }

  &__title {
    margin: 0 0 6px;
    font-size: 22px;
    font-weight: 700;
    color: #e0e0e0;
  }

  &__subtitle {
    margin: 0;
    font-size: 13px;
    color: #858585;
  }

  &__hint {
    margin: 20px 0 0;
    font-size: 11px;
    color: #6a6a6a;
    text-align: center;
  }
}

.login-form {
  display: flex;
  flex-direction: column;
  gap: 18px;

  &__error {
    background: #3a1b1b;
    border: 1px solid #f44747;
    border-radius: 6px;
    padding: 10px 14px;
    color: #f44747;
    font-size: 13px;
  }

  &__btn {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    width: 100%;
    margin-top: 4px;
    padding: 12px 0;
    border: none;
    border-radius: 8px;
    background: #0e639c;
    color: #fff;
    font-size: 15px;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.15s, opacity 0.15s;

    &:hover:not(:disabled) {
      background: #1177bb;
    }

    &:active:not(:disabled) {
      background: #0d5689;
    }

    &:disabled {
      background: #3c3c3c;
      color: #858585;
      cursor: not-allowed;
    }

    &--loading {
      background: #0e639c;
    }
  }

  &__skip {
    width: 100%;
    padding: 8px 0;
    border: none;
    border-radius: 8px;
    background: transparent;
    color: #858585;
    font-size: 13px;
    cursor: pointer;
    transition: color 0.15s;

    &:hover {
      color: #d4d4d4;
    }
  }

  &__divider {
    display: flex;
    align-items: center;
    gap: 12px;
    margin: 4px 0;

    &::before,
    &::after {
      content: '';
      flex: 1;
      height: 1px;
      background: #3c3c3c;
    }

    &-text {
      font-size: 12px;
      color: #6a6a6a;
    }
  }

  &__browser-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    width: 100%;
    padding: 10px 0;
    border: 1px solid #0e639c;
    border-radius: 8px;
    background: transparent;
    color: #569cd6;
    font-size: 14px;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.15s, border-color 0.15s;

    &:hover {
      background: rgba(14, 99, 156, 0.15);
      border-color: #1177bb;
    }
  }
}

.form-field {
  display: flex;
  flex-direction: column;
  gap: 6px;

  &__label {
    font-size: 13px;
    color: #cccccc;
    font-weight: 500;
  }

  &__input {
    width: 100%;
    padding: 10px 14px;
    border: 1px solid #3c3c3c;
    border-radius: 6px;
    background: #1e1e1e;
    color: #d4d4d4;
    font-size: 14px;
    outline: none;
    transition: border-color 0.15s;

    &::placeholder {
      color: #6a6a6a;
    }

    &:focus {
      border-color: #569cd6;
    }

    &:disabled {
      opacity: 0.5;
    }
  }

  &__password {
    position: relative;
  }

  &__toggle {
    position: absolute;
    right: 8px;
    top: 50%;
    transform: translateY(-50%);
    background: none;
    border: none;
    font-size: 16px;
    cursor: pointer;
    padding: 4px;
    opacity: 0.6;

    &:hover {
      opacity: 1;
    }
  }
}

/* 简易旋转动画 */
.spinner {
  display: inline-block;
  width: 16px;
  height: 16px;
  border: 2px solid rgba(255, 255, 255, 0.3);
  border-top-color: #fff;
  border-radius: 50%;
  animation: spin 0.6s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
