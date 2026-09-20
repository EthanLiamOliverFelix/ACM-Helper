import { onBeforeUnmount } from 'vue'

type ResizeAxis = 'x' | 'y'

interface PointerResizeOptions {
  axis: ResizeAxis
  onMove: (event: PointerEvent) => void
  onEnd?: () => void
}

/**
 * Keeps a resize gesture on the separator that started it. Pointer capture
 * avoids losing the drag over Monaco, previews, or nested panes, while the
 * animation-frame throttle prevents a resize from flooding Vue with updates.
 */
export function usePointerResize() {
  let target: HTMLElement | null = null
  let pointerId: number | null = null
  let options: PointerResizeOptions | null = null
  let pendingEvent: PointerEvent | null = null
  let frame = 0

  function flush() {
    frame = 0
    if (pendingEvent && options) options.onMove(pendingEvent)
    pendingEvent = null
  }

  function move(event: PointerEvent) {
    if (event.pointerId !== pointerId) return
    pendingEvent = event
    if (!frame) frame = requestAnimationFrame(flush)
  }

  function finish(event?: PointerEvent) {
    if (event && event.pointerId !== pointerId) return
    if (frame) {
      cancelAnimationFrame(frame)
      flush()
    }
    const completed = options
    const completedTarget = target
    const completedPointerId = pointerId
    completedTarget?.removeEventListener('pointermove', move)
    completedTarget?.removeEventListener('pointerup', finish)
    completedTarget?.removeEventListener('pointercancel', finish)
    completedTarget?.removeEventListener('lostpointercapture', finish)
    if (completedTarget && completedPointerId != null && completedTarget.hasPointerCapture(completedPointerId)) completedTarget.releasePointerCapture(completedPointerId)
    document.body.classList.remove('is-resizing-x', 'is-resizing-y')
    target = null
    pointerId = null
    options = null
    pendingEvent = null
    completed?.onEnd?.()
  }

  function startPointerResize(event: PointerEvent, nextOptions: PointerResizeOptions) {
    if (event.button !== 0) return
    finish()
    target = event.currentTarget as HTMLElement
    pointerId = event.pointerId
    options = nextOptions
    target.setPointerCapture(pointerId)
    target.addEventListener('pointermove', move)
    target.addEventListener('pointerup', finish)
    target.addEventListener('pointercancel', finish)
    target.addEventListener('lostpointercapture', finish)
    document.body.classList.add(nextOptions.axis === 'x' ? 'is-resizing-x' : 'is-resizing-y')
    event.preventDefault()
  }

  onBeforeUnmount(() => finish())
  return { startPointerResize }
}
