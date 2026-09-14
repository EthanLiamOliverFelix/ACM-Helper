import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import './styles/global.css'
import { getDataCenterValue, initializeDataCenter } from './dataCenter'
import { applyResolvedTheme, normalizeThemeMode, resolveThemeMode } from './theme'

async function bootstrap() {
  await initializeDataCenter()
  const savedTheme = getDataCenterValue<{ theme?: unknown }>('settings', {}).theme
  const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? true
  applyResolvedTheme(resolveThemeMode(normalizeThemeMode(savedTheme), prefersDark))
  const app = createApp(App)

  app.use(createPinia())

  app.mount('#app')
}

void bootstrap()
