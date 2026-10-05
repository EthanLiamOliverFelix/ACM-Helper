import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { afterPaint } from './afterPaint'

describe('secondary navigation work', () => {
  let frame: FrameRequestCallback
  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => { frame = callback; return 1 }))
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
  })
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

  it('lets the visual frame complete before starting secondary work', () => {
    const work = vi.fn()
    afterPaint(work)
    expect(work).not.toHaveBeenCalled()
    frame(0)
    expect(work).not.toHaveBeenCalled()
    vi.runAllTimers()
    expect(work).toHaveBeenCalledOnce()
  })

  it('cancels stale work after a rapid navigation, including an already queued task', () => {
    const stale = vi.fn()
    const cancel = afterPaint(stale)
    frame(0)
    cancel()
    const latest = vi.fn()
    afterPaint(latest)
    frame(1)
    vi.runAllTimers()
    expect(stale).not.toHaveBeenCalled()
    expect(latest).toHaveBeenCalledOnce()
  })
})
