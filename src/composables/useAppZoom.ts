import { onBeforeUnmount, onMounted } from 'vue'
import { appZoomShortcutDirection, applyAppZoom, offsetAppZoom } from '../appZoom'
import { useSettingsStore } from '../stores/settingsStore'

export function useAppZoom() {
  const settings = useSettingsStore()
  let saveTimer: number | undefined

  function handleKeydown(event: KeyboardEvent) {
    const direction = appZoomShortcutDirection(event)
    if (!direction) return

    event.preventDefault()
    event.stopPropagation()
    settings.zoomLevel = offsetAppZoom(settings.zoomLevel, direction)
    void applyAppZoom(settings.zoomLevel).catch(error => console.error('调整界面缩放失败', error))

    window.clearTimeout(saveTimer)
    saveTimer = window.setTimeout(() => { void settings.save() }, 250)
  }

  onMounted(() => window.addEventListener('keydown', handleKeydown, true))
  onBeforeUnmount(() => {
    window.removeEventListener('keydown', handleKeydown, true)
    window.clearTimeout(saveTimer)
  })
}
