import { effectScope } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useWorkbenchTabDrag, workbenchTabDrag } from './useWorkbenchTabDrag'

const ghosts = vi.hoisted(() => ({ move: vi.fn(), remove: vi.fn() }))
vi.mock('./dragGhost', () => ({ createDragGhost: () => ghosts }))
let dispose: (() => void) | undefined

afterEach(() => { dispose?.(); vi.unstubAllGlobals(); vi.useRealTimers(); vi.clearAllMocks() })

function setup() {
  vi.useFakeTimers()
  const browser = new EventTarget()
  vi.stubGlobal('window', browser)
  const group = { dataset: { editorGroup: 'right' }, getBoundingClientRect: () => ({ left: 0, top: 0, width: 400, height: 300 }), querySelectorAll: () => [1, 2, 3] }
  const strip = { scrollLeft: 0, getBoundingClientRect: () => ({ left: 0, right: 400 }) }
  const tab = { dataset: { editorTab: 'target', tabIndex: '1' }, getBoundingClientRect: () => ({ left: 100, width: 100 }) }
  let hovered = { closest: (selector: string) => selector === '[data-editor-group]' ? group : selector === '.editor-tabs' ? strip : tab }
  vi.stubGlobal('document', { elementFromPoint: () => hovered })
  const owner = Object.assign(new EventTarget(), { setPointerCapture: vi.fn(), hasPointerCapture: () => true, releasePointerCapture: vi.fn() })
  const onDrop = vi.fn()
  const scope = effectScope()
  const gesture = scope.run(() => useWorkbenchTabDrag(onDrop))!
  dispose = () => scope.stop()
  function begin() {
    gesture.begin({ button: 0, isPrimary: true, pointerId: 1, clientX: 20, clientY: 20, currentTarget: owner, target: { closest: () => null }, preventDefault: vi.fn() } as unknown as PointerEvent, 'left', 'source')
  }
  function pointer(type: string, x: number, y = 20) {
    const event = new Event(type, { cancelable: true })
    Object.assign(event, { pointerId: 1, clientX: x, clientY: y })
    browser.dispatchEvent(event)
  }
  return { gesture, begin, pointer, browser, owner, onDrop, content: () => { hovered = { closest: selector => selector === '[data-editor-group]' ? group : null as any } } }
}

describe('pointer-driven workbench tab drag', () => {
  it('keeps a normal click from rearranging tabs', () => {
    const task = setup()
    task.begin(); task.pointer('pointermove', 23); task.pointer('pointerup', 23)
    expect(task.onDrop).not.toHaveBeenCalled()
    expect(task.gesture.shouldSuppressClick()).toBe(false)
    expect(workbenchTabDrag.value).toBeNull()
  })
  it('sorts across groups without HTML drag events and suppresses the release click', () => {
    const task = setup()
    task.begin(); task.pointer('pointermove', 180)
    expect(workbenchTabDrag.value?.target).toMatchObject({ groupId: 'right', edge: 'center', index: 2, side: 'after' })
    task.pointer('pointerup', 180)
    expect(task.onDrop).toHaveBeenCalledWith({ groupId: 'left', tabId: 'source' }, expect.objectContaining({ groupId: 'right', index: 2 }))
    expect(task.gesture.shouldSuppressClick()).toBe(true)
    expect(task.owner.releasePointerCapture).toHaveBeenCalledWith(1)
    expect(ghosts.remove).toHaveBeenCalled()
  })
  it('retains edge drops for splitting editor groups', () => {
    const task = setup()
    task.content(); task.begin(); task.pointer('pointermove', 390, 150); task.pointer('pointerup', 390, 150)
    expect(task.onDrop).toHaveBeenCalledWith({ groupId: 'left', tabId: 'source' }, { groupId: 'right', edge: 'right' })
  })
  it.each(['pointercancel', 'blur', 'Escape'])('cancels on %s without moving the tab', type => {
    const task = setup()
    task.begin(); task.pointer('pointermove', 180)
    if (type === 'Escape') { const event = new Event('keydown'); Object.assign(event, { key: 'Escape' }); task.browser.dispatchEvent(event) }
    else task.pointer(type, 180)
    expect(task.onDrop).not.toHaveBeenCalled()
    expect(workbenchTabDrag.value).toBeNull()
    expect(ghosts.remove).toHaveBeenCalled()
  })
})
