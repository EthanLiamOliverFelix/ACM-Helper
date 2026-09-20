import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import './styles/global.css'
import { getDataCenterValue, initializeDataCenter } from './dataCenter'
import { applyResolvedTheme, normalizeThemeMode, resolveThemeMode } from './theme'
import { applyAppZoom, normalizeAppZoom } from './appZoom'

async function bootstrap() {
  await initializeDataCenter()
  const savedSettings = getDataCenterValue<{ theme?: unknown; zoomLevel?: unknown }>('settings', {})
  const savedTheme = savedSettings.theme
  const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? true
  applyResolvedTheme(resolveThemeMode(normalizeThemeMode(savedTheme), prefersDark))
  await applyAppZoom(normalizeAppZoom(savedSettings.zoomLevel)).catch(error => console.error('恢复界面缩放失败', error))
  const app = createApp(App)

  app.use(createPinia())

  app.mount('#app')
}

void bootstrap()
