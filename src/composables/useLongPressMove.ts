import { onBeforeUnmount, ref } from 'vue'
import { createDragGhost } from './dragGhost'

interface MovableEntry { path: string }

export function useLongPressMove<T extends MovableEntry>(options: {
  targetAttribute: string
  rootSelector: string
  resolveTarget: (source: T, hoveredPath: string | null) => string | undefined
  onMove: (source: T, targetPath: string | null) => void | Promise<void>
  getSources?: (source: T) => T[]
  resolveTargets?: (sources: T[], hoveredPath: string | null) => string | undefined
  onMoveMany?: (sources: T[], targetPath: string) => void | Promise<void>
}) {
  const movingPath = ref('')
  const targetPath = ref('')
  const movingPaths = ref(new Set<string>())
  const movingCount = ref(0)
  let sources: T[] = []
  let source: T | null = null
  let pointerId = -1
  let start = { x: 0, y: 0 }
  let timer: number | null = null
  let suppressClick = false
  let root: HTMLElement | null = null
  let ghost: ReturnType<typeof createDragGhost> | null = null

  function clearTimer() {
    if (timer != null) window.clearTimeout(timer)
    timer = null
  }

  function detach() {
    window.removeEventListener('pointermove', pointerMove, true)
    window.removeEventListener('pointerup', pointerEnd, true)
    window.removeEventListener('pointercancel', pointerEnd, true)
    window.removeEventListener('blur', cancel)
    window.removeEventListener('keydown', escape)
  }

  function cleanup() {
    clearTimer()
    detach()
    ghost?.remove()
    ghost = null
    root = null
    source = null
    pointerId = -1
    movingPath.value = ''
    movingPaths.value = new Set()
    movingCount.value = 0
    sources = []
    targetPath.value = ''
    document.body.classList.remove('is-longpress-moving')
  }

  function cancel() {
    cleanup()
    window.setTimeout(() => { suppressClick = false }, 80)
  }

  function escape(event: KeyboardEvent) { if (event.key === 'Escape') cancel() }

  function activate(element: HTMLElement, x: number, y: number) {
    clearTimer()
    if (!source || movingPath.value) return
    movingPath.value = source.path
    prepareSources()
    suppressClick = true
    ghost = createDragGhost(element, start.x, start.y, movingCount.value)
    ghost.move(x, y)
    document.body.classList.add('is-longpress-moving')
  }

  function prepareSources() {
    sources = source ? options.getSources?.(source) ?? [source] : []
    movingPaths.value = new Set(sources.map(entry => entry.path))
    movingCount.value = sources.length
  }

  function commit(entries: T[], destination: string) {
    const task = options.onMoveMany ? options.onMoveMany(entries, destination) : Promise.all(entries.map(entry => options.onMove(entry, destination)))
    Promise.resolve(task).catch(() => undefined)
  }

  function initialize(entry: T, element: HTMLElement) {
    cleanup()
    source = entry
    root = element.closest(options.rootSelector)
    window.addEventListener('blur', cancel)
    window.addEventListener('keydown', escape)
  }

  function begin(entry: T, event: PointerEvent) {
    if (event.button !== 0) return
    const element = event.currentTarget as HTMLElement
    initialize(entry, element)
    pointerId = event.pointerId
    start = { x: event.clientX, y: event.clientY }
    window.addEventListener('pointermove', pointerMove, true)
    window.addEventListener('pointerup', pointerEnd, true)
    window.addEventListener('pointercancel', pointerEnd, true)
    timer = window.setTimeout(() => activate(element, start.x, start.y), 360)
  }

  function updateTarget(event: MouseEvent) {
    targetPath.value = ''
    if (!source) return
    const underPointer = document.elementFromPoint(event.clientX, event.clientY)
    if (!underPointer || !root?.contains(underPointer)) return
    const element = underPointer.closest<HTMLElement>(`[${options.targetAttribute}]`)
    if (!element && !underPointer.closest('[data-directory-drop-area]')) return
    const hoveredPath = element?.getAttribute(options.targetAttribute) || null
    targetPath.value = (options.resolveTargets ? options.resolveTargets(sources, hoveredPath) : options.resolveTarget(source, hoveredPath)) ?? ''
  }

  function pointerMove(event: PointerEvent) {
    if (event.pointerId !== pointerId) return
    if (!movingPath.value && Math.hypot(event.clientX - start.x, event.clientY - start.y) > 8) {
      const rows = root?.querySelectorAll<HTMLElement>(`[${options.targetAttribute}]`)
      const row = [...(rows ?? [])].find(item => item.getAttribute(options.targetAttribute) === source?.path)
      if (row) activate(row, event.clientX, event.clientY)
    }
    if (!movingPath.value) return
    event.preventDefault()
    ghost?.move(event.clientX, event.clientY)
    updateTarget(event)
  }

  function pointerEnd(event: PointerEvent) {
    if (event.pointerId !== pointerId) return
    const active = Boolean(movingPath.value && source)
    const movingSources = [...sources]
    if (event.type === 'pointerup') updateTarget(event)
    const shouldMove = active && event.type === 'pointerup' && !!targetPath.value
    const destination = targetPath.value
    if (active) {
      event.preventDefault()
      event.stopPropagation()
      suppressClick = true
    }
    cleanup()
    if (shouldMove) commit(movingSources, destination)
    if (active) window.setTimeout(() => { suppressClick = false }, 80)
  }

  function shouldSuppressClick() { return suppressClick }

  function startNative(entry: T, event: DragEvent) {
    if (pointerId >= 0 && source?.path === entry.path) {
      event.preventDefault()
      activate(event.currentTarget as HTMLElement, event.clientX, event.clientY)
      return
    }
    initialize(entry, event.currentTarget as HTMLElement)
    movingPath.value = entry.path
    prepareSources()
    suppressClick = true
    event.dataTransfer?.setData('text/plain', entry.path)
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
  }

  function nativeOver(event: DragEvent) {
    if (!movingPath.value) return
    updateTarget(event)
    if (event.dataTransfer) event.dataTransfer.dropEffect = targetPath.value ? 'move' : 'none'
  }

  function nativeDrop(event: DragEvent) {
    if (!movingPath.value) return
    updateTarget(event)
    const movingSources = [...sources]
    const destination = targetPath.value
    cancel()
    if (movingSources.length && destination) commit(movingSources, destination)
  }

  function nativeLeave(event: DragEvent) {
    if (!(event.relatedTarget instanceof Node) || !root?.contains(event.relatedTarget)) targetPath.value = ''
  }

  function suppressEvent(event: MouseEvent) {
    if (suppressClick) { event.preventDefault(); event.stopPropagation() }
  }

  onBeforeUnmount(cleanup)
  return { movingPath, movingPaths, movingCount, targetPath, begin, startNative, nativeOver, nativeDrop, nativeLeave, suppressEvent, shouldSuppressClick, cancel }
}
