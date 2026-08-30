import { onBeforeUnmount, ref } from 'vue'

interface MovableEntry { path: string }

export function useLongPressMove<T extends MovableEntry>(options: {
  targetAttribute: string
  onMove: (source: T, targetPath: string | null) => void | Promise<void>
}) {
  const movingPath = ref('')
  const targetPath = ref('')
  let source: T | null = null
  let pointerId = -1
  let start = { x: 0, y: 0 }
  let timer: number | null = null
  let suppressClick = false

  function clearTimer() {
    if (timer != null) window.clearTimeout(timer)
    timer = null
  }

  function detach() {
    window.removeEventListener('pointermove', pointerMove, true)
    window.removeEventListener('pointerup', pointerEnd, true)
    window.removeEventListener('pointercancel', pointerEnd, true)
  }

  function cleanup() {
    clearTimer()
    detach()
    source = null
    pointerId = -1
    movingPath.value = ''
    targetPath.value = ''
    document.body.classList.remove('is-longpress-moving')
  }

  function begin(entry: T, event: PointerEvent) {
    if (event.button !== 0) return
    cleanup()
    source = entry
    pointerId = event.pointerId
    start = { x: event.clientX, y: event.clientY }
    window.addEventListener('pointermove', pointerMove, true)
    window.addEventListener('pointerup', pointerEnd, true)
    window.addEventListener('pointercancel', pointerEnd, true)
    timer = window.setTimeout(() => {
      if (!source) return
      movingPath.value = source.path
      targetPath.value = source.path
      document.body.classList.add('is-longpress-moving')
    }, 430)
  }

  function pointerMove(event: PointerEvent) {
    if (event.pointerId !== pointerId) return
    if (!movingPath.value) {
      if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > 8) clearTimer()
      return
    }
    event.preventDefault()
    const element = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>(`[${options.targetAttribute}]`)
    targetPath.value = element?.getAttribute(options.targetAttribute) ?? ''
  }

  function pointerEnd(event: PointerEvent) {
    if (event.pointerId !== pointerId) return
    const active = Boolean(movingPath.value && source)
    const movingSource = source
    const shouldMove = active && targetPath.value !== source?.path
    const destination = targetPath.value || null
    if (active) {
      event.preventDefault()
      event.stopPropagation()
      suppressClick = true
    }
    cleanup()
    if (shouldMove && movingSource) Promise.resolve(options.onMove(movingSource, destination)).catch(() => undefined)
    if (active) window.setTimeout(() => { suppressClick = false }, 80)
  }

  function shouldSuppressClick() { return suppressClick }

  onBeforeUnmount(cleanup)
  return { movingPath, targetPath, begin, shouldSuppressClick, cancel: cleanup }
}
