import { describe, expect, it } from 'vitest'
import { normalizeThemeMode, resolveThemeMode } from './theme'

describe('theme preferences', () => {
  it('normalizes old or invalid settings to system mode', () => {
    expect(normalizeThemeMode(undefined)).toBe('system')
    expect(normalizeThemeMode('sepia')).toBe('system')
    expect(normalizeThemeMode('light')).toBe('light')
  })

  it('resolves system and explicit themes', () => {
    expect(resolveThemeMode('system', true)).toBe('dark')
    expect(resolveThemeMode('system', false)).toBe('light')
    expect(resolveThemeMode('dark', false)).toBe('dark')
    expect(resolveThemeMode('light', true)).toBe('light')
  })
})
