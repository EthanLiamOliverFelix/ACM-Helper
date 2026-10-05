import { onScopeDispose, shallowRef } from 'vue'
import { createDragGhost } from './dragGhost'

export type TabDropTarget = { groupId: string; edge: 'center' | 'left' | 'right' | 'top' | 'bottom'; index?: number; tabId?: string; side?: 'before' | 'after' }
type TabSource = { groupId: string; tabId: string }
export const workbenchTabDrag = shallowRef<{ source: TabSource; target?: TabDropTarget } | null>(null)
let cancelActive: (() => void) | undefined

// Native WebView file drops disable HTML5 dragging on Windows. Pointer capture
// keeps internal tab sorting and pane splitting independent of that setting.
export function useWorkbenchTabDrag(onDrop: (source: TabSource, target: TabDropTarget) => void) {
  let owner: HTMLElement | undefined
  let source: TabSource | undefined
  let pointerId: number | undefined
  let startX = 0
  let startY = 0
  let ghost: ReturnType<typeof createDragGhost> | undefined
  let suppressClick = false
  let clickTimer: ReturnType<typeof setTimeout> | undefined

  function targetAt(x: number, y: number): TabDropTarget | undefined {
    const element = document.elementFromPoint(x, y)
    const group = element?.closest<HTMLElement>('[data-editor-group]')
    const groupId = group?.dataset.editorGroup
    if (!group || !groupId) return
    const strip = element?.closest<HTMLElement>('.editor-tabs')
    if (strip) {
      const bounds = strip.getBoundingClientRect()
      if (x < bounds.left + 28) strip.scrollLeft -= 16
      else if (x > bounds.right - 28) strip.scrollLeft += 16
      const tab = element?.closest<HTMLElement>('[data-editor-tab]')
      if (tab) {
        const rect = tab.getBoundingClientRect()
        const side = x < rect.left + rect.width / 2 ? 'before' : 'after'
        return { groupId, edge: 'center', tabId: tab.dataset.editorTab, side, index: Number(tab.dataset.tabIndex) + (side === 'after' ? 1 : 0) }
      }
      return { groupId, edge: 'center', index: group.querySelectorAll('[data-editor-tab]').length }
    }
    const bounds = group.getBoundingClientRect()
    const dx = (x - bounds.left) / bounds.width
    const dy = (y - bounds.top) / bounds.height
    const edge = dx < .24 ? 'left' : dx > .76 ? 'right' : dy < .24 ? 'top' : dy > .76 ? 'bottom' : 'center'
    return { groupId, edge }
  }

  function cleanup() {
    const previousOwner = owner
    const previousPointer = pointerId
    window.removeEventListener('pointermove', move, true)
    window.removeEventListener('pointerup', end, true)
    window.removeEventListener('pointercancel', cancel, true)
    window.removeEventListener('keydown', keydown, true)
    window.removeEventListener('blur', cancel)
    previousOwner?.removeEventListener('lostpointercapture', cancel)
    owner = undefined
    source = undefined
    pointerId = undefined
    if (previousOwner && previousPointer != null && previousOwner.hasPointerCapture(previousPointer)) previousOwner.releasePointerCapture(previousPointer)
    ghost?.remove()
    ghost = undefined
    workbenchTabDrag.value = null
    if (cancelActive === cancel) cancelActive = undefined
  }
  function suppressNextClick() {
    suppressClick = true
    if (clickTimer) clearTimeout(clickTimer)
    clickTimer = setTimeout(() => { suppressClick = false }, 80)
  }
  function move(event: PointerEvent) {
    if (event.pointerId !== pointerId || !owner || !source) return
    if (!ghost && Math.hypot(event.clientX - startX, event.clientY - startY) < 6) return
    if (!ghost) ghost = createDragGhost(owner, startX, startY)
    event.preventDefault()
    ghost.move(event.clientX, event.clientY)
    workbenchTabDrag.value = { source, target: targetAt(event.clientX, event.clientY) }
  }
  function end(event: PointerEvent) {
    if (event.pointerId !== pointerId) return
    const moving = !!ghost
    const original = source
    const target = moving ? targetAt(event.clientX, event.clientY) : undefined
    if (moving) { event.preventDefault(); event.stopPropagation(); suppressNextClick() }
    cleanup()
    if (moving && original && target) onDrop(original, target)
  }
  function cancel(event?: Event) {
    if (event && 'pointerId' in event && (event as PointerEvent).pointerId !== pointerId) return
    if (ghost) suppressNextClick()
    cleanup()
  }
  function keydown(event: KeyboardEvent) { if (event.key === 'Escape') { event.preventDefault(); cancel() } }
  function begin(event: PointerEvent, groupId: string, tabId: string) {
    if (event.button !== 0 || !event.isPrimary || (event.target as Element).closest('[data-tab-close]')) return
    cancelActive?.()
    suppressClick = false
    if (clickTimer) clearTimeout(clickTimer)
    owner = event.currentTarget as HTMLElement
    source = { groupId, tabId }
    pointerId = event.pointerId
    startX = event.clientX
    startY = event.clientY
    owner.setPointerCapture(event.pointerId)
    owner.addEventListener('lostpointercapture', cancel)
    window.addEventListener('pointermove', move, true)
    window.addEventListener('pointerup', end, true)
    window.addEventListener('pointercancel', cancel, true)
    window.addEventListener('keydown', keydown, true)
    window.addEventListener('blur', cancel)
    cancelActive = cancel
    event.preventDefault()
  }
  onScopeDispose(() => { if (owner) cleanup(); if (clickTimer) clearTimeout(clickTimer) })
  return { begin, shouldSuppressClick: () => suppressClick, drag: workbenchTabDrag }
}
