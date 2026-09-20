import { describe, expect, it } from 'vitest'
import { appZoomShortcutDirection, normalizeAppZoom, offsetAppZoom } from './appZoom'

function keyboardEvent(overrides: Partial<KeyboardEvent> = {}) {
  return {
    altKey: false,
    code: '',
    ctrlKey: true,
    key: '',
    metaKey: false,
    shiftKey: true,
    ...overrides,
  } as KeyboardEvent
}

describe('application zoom', () => {
  it('normalizes persisted values and enforces the supported range', () => {
    expect(normalizeAppZoom(undefined)).toBe(1)
    expect(normalizeAppZoom('1.36')).toBe(1.4)
    expect(normalizeAppZoom(0.1)).toBe(0.5)
    expect(normalizeAppZoom(4)).toBe(2)
  })

  it('recognizes Ctrl+Shift plus and minus across keyboard layouts', () => {
    expect(appZoomShortcutDirection(keyboardEvent({ code: 'Equal', key: '+' }))).toBe(1)
    expect(appZoomShortcutDirection(keyboardEvent({ code: 'Minus', key: '_' }))).toBe(-1)
    expect(appZoomShortcutDirection(keyboardEvent({ code: 'NumpadSubtract', key: '-' }))).toBe(-1)
    expect(appZoomShortcutDirection(keyboardEvent({ ctrlKey: false, code: 'Equal', key: '+' }))).toBe(0)
  })

  it('changes zoom in ten-percent steps without crossing its limits', () => {
    expect(offsetAppZoom(1, 1)).toBe(1.1)
    expect(offsetAppZoom(1, -1)).toBe(0.9)
    expect(offsetAppZoom(2, 1)).toBe(2)
    expect(offsetAppZoom(0.5, -1)).toBe(0.5)
  })
})
