import { describe, expect, it } from 'vitest'
import { isToggleSidebarShortcut } from './workbenchShortcuts'

function keyboardEvent(overrides: Partial<KeyboardEvent> = {}) {
  return {
    altKey: false,
    ctrlKey: true,
    key: 'b',
    metaKey: false,
    repeat: false,
    shiftKey: false,
    ...overrides,
  } as KeyboardEvent
}

describe('workbench shortcuts', () => {
  it('recognizes Ctrl+B regardless of letter casing', () => {
    expect(isToggleSidebarShortcut(keyboardEvent())).toBe(true)
    expect(isToggleSidebarShortcut(keyboardEvent({ key: 'B' }))).toBe(true)
  })

  it('does not toggle for modified, repeated, or unrelated key presses', () => {
    expect(isToggleSidebarShortcut(keyboardEvent({ ctrlKey: false }))).toBe(false)
    expect(isToggleSidebarShortcut(keyboardEvent({ shiftKey: true }))).toBe(false)
    expect(isToggleSidebarShortcut(keyboardEvent({ altKey: true }))).toBe(false)
    expect(isToggleSidebarShortcut(keyboardEvent({ repeat: true }))).toBe(false)
    expect(isToggleSidebarShortcut(keyboardEvent({ key: 'i' }))).toBe(false)
  })
})
