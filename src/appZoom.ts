import { isTauri } from '@tauri-apps/api/core'
import { getCurrentWebview } from '@tauri-apps/api/webview'

export const DEFAULT_APP_ZOOM = 1
export const MIN_APP_ZOOM = 0.5
export const MAX_APP_ZOOM = 2
export const APP_ZOOM_STEP = 0.1

export function normalizeAppZoom(value: unknown) {
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric)) return DEFAULT_APP_ZOOM
  const clamped = Math.min(MAX_APP_ZOOM, Math.max(MIN_APP_ZOOM, numeric))
  return Math.round(clamped * 10) / 10
}

export function appZoomShortcutDirection(event: Pick<KeyboardEvent, 'altKey' | 'code' | 'ctrlKey' | 'key' | 'metaKey' | 'shiftKey'>) {
  if (!event.ctrlKey || !event.shiftKey || event.altKey || event.metaKey) return 0
  if (event.code === 'Equal' || event.code === 'NumpadAdd' || event.key === '+') return 1
  if (event.code === 'Minus' || event.code === 'NumpadSubtract' || event.key === '-' || event.key === '_') return -1
  return 0
}

export function offsetAppZoom(current: unknown, direction: number) {
  return normalizeAppZoom(normalizeAppZoom(current) + Math.sign(direction) * APP_ZOOM_STEP)
}

export async function applyAppZoom(value: unknown) {
  const zoom = normalizeAppZoom(value)
  if (isTauri()) {
    await getCurrentWebview().setZoom(zoom)
    return
  }

  // Keep browser development and preview behavior aligned with the desktop app.
  document.documentElement.style.zoom = String(zoom)
}
