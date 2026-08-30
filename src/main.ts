import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import './styles/global.css'
import { initializeDataCenter } from './dataCenter'

async function bootstrap() {
  await initializeDataCenter()
  const app = createApp(App)

  app.use(createPinia())

  app.mount('#app')
}

void bootstrap()
