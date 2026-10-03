import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useLongPressMove } from './useLongPressMove'

const preview = vi.hoisted(() => ({ move: vi.fn(), remove: vi.fn() }))
vi.mock('./dragGhost', () => ({ createDragGhost: vi.fn(() => preview) }))
vi.mock('vue', async importOriginal => ({ ...await importOriginal<typeof import('vue')>(), onBeforeUnmount: vi.fn() }))

function pointer(type: string, x = 30, pointerId = 1) {
  return Object.assign(new Event(type, { cancelable: true }), { pointerId, button: 0, clientX: x, clientY: 10 })
}

describe('directory drag gesture lifecycle', () => {
  const source = { path: 'F:/qa/source/file.md' }
  let hovered: object | null
  let row: EventTarget & { closest: () => object; getAttribute: () => string }
  let windowTarget: EventTarget
  let onMove: ReturnType<typeof vi.fn<(entry: typeof source, destination: string | null) => void>>
  let move: ReturnType<typeof useLongPressMove<typeof source>>

  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    windowTarget = new EventTarget()
    const target = { getAttribute: () => 'F:/qa/destination', closest: () => target }
    const root = { contains: (element: object) => element === target || element === row, querySelectorAll: () => [row] }
    row = Object.assign(new EventTarget(), { closest: () => root, getAttribute: () => source.path })
    hovered = target
    vi.stubGlobal('window', Object.assign(windowTarget, { setTimeout, clearTimeout }))
    vi.stubGlobal('document', { elementFromPoint: () => hovered, body: { classList: { add: vi.fn(), remove: vi.fn() } } })
    onMove = vi.fn()
    move = useLongPressMove({ targetAttribute: 'data-path', rootSelector: '.tree', resolveTarget: (_source, path) => path ?? undefined, onMove })
    row.addEventListener('pointerdown', event => move.begin(source, event as PointerEvent))
  })

  afterEach(() => {
    move.cancel()
    vi.runAllTimers()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  function begin() {
    row.dispatchEvent(pointer('pointerdown', 10))
    windowTarget.dispatchEvent(pointer('pointermove'))
  }

  it('starts immediately on movement, then commits exactly once on release', () => {
    begin()
    expect(move.movingPath.value).toBe(source.path)
    expect(move.targetPath.value).toBe('F:/qa/destination')
    expect(preview.move).toHaveBeenCalled()
    expect(onMove).not.toHaveBeenCalled()
    windowTarget.dispatchEvent(pointer('pointerup'))
    windowTarget.dispatchEvent(pointer('pointerup'))
    expect(onMove).toHaveBeenCalledExactlyOnceWith(source, 'F:/qa/destination')
    expect(preview.remove).toHaveBeenCalledOnce()
    expect(move.shouldSuppressClick()).toBe(true)
    vi.advanceTimersByTime(80)
    expect(move.shouldSuppressClick()).toBe(false)
  })

  it.each(['pointercancel', 'blur', 'escape', 'outside'])('does not move a file on %s', reason => {
    begin()
    if (reason === 'escape') windowTarget.dispatchEvent(Object.assign(new Event('keydown'), { key: 'Escape' }))
    else if (reason === 'outside') { hovered = null; windowTarget.dispatchEvent(pointer('pointerup')) }
    else windowTarget.dispatchEvent(pointer(reason))
    expect(onMove).not.toHaveBeenCalled()
    expect(move.movingPath.value).toBe('')
    expect(move.targetPath.value).toBe('')
    expect(preview.remove).toHaveBeenCalledOnce()
  })

  it('prevents a native drag from canceling the active pointer preview', () => {
    begin()
    row.addEventListener('dragstart', event => move.startNative(source, event as DragEvent))
    const event = Object.assign(new Event('dragstart', { cancelable: true }), { clientX: 30, clientY: 10 })
    row.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
    expect(preview.remove).not.toHaveBeenCalled()
    windowTarget.dispatchEvent(pointer('pointerup'))
    expect(onMove).toHaveBeenCalledOnce()
  })

  it('uses a fixed batch snapshot and commits all selected roots together', () => {
    const sources = [source, { path: 'F:/qa/source/second.md' }]
    const onMoveMany = vi.fn()
    const batch = useLongPressMove({ targetAttribute: 'data-path', rootSelector: '.tree', getSources: () => [...sources], resolveTarget: () => 'F:/qa/destination', resolveTargets: entries => entries.length === 2 ? 'F:/qa/destination' : undefined, onMove, onMoveMany })
    const batchRow = Object.assign(new EventTarget(), { closest: () => ({ contains: () => true }) })
    batchRow.addEventListener('pointerdown', event => batch.begin(source, event as PointerEvent))
    batchRow.dispatchEvent(pointer('pointerdown', 10))
    vi.advanceTimersByTime(360)
    expect(batch.movingCount.value).toBe(2)
    expect(batch.movingPaths.value.size).toBe(2)
    sources.pop()
    windowTarget.dispatchEvent(pointer('pointerup'))
    expect(onMoveMany).toHaveBeenCalledExactlyOnceWith([source, { path: 'F:/qa/source/second.md' }], 'F:/qa/destination')
    expect(onMove).not.toHaveBeenCalled()
    batch.cancel()
  })
})
