// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useSettingsStore } from './settingsStore'

const mocks = vi.hoisted(() => ({ saved: {} as Record<string, unknown>, save: vi.fn() }))
vi.mock('../dataCenter', () => ({
  getDataCenterValue: () => mocks.saved,
  saveDataCenterValue: mocks.save,
}))

describe('Luogu O2 preference', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    mocks.saved = {}
    mocks.save.mockReset()
  })

  it('enables O2 for a new installation', () => {
    expect(useSettingsStore().luoguEnableO2).toBe(true)
  })

  it('upgrades the old disabled default and records the migration when saving', async () => {
    mocks.saved = { luoguEnableO2: false }
    const settings = useSettingsStore()
    expect(settings.luoguEnableO2).toBe(true)
    await settings.save()
    expect(mocks.save).toHaveBeenCalledWith('settings', expect.objectContaining({
      luoguEnableO2: true, luoguO2PreferenceVersion: 1,
    }))
  })

  it('honors an explicit opt-out saved after the upgrade', () => {
    mocks.saved = { luoguEnableO2: false, luoguO2PreferenceVersion: 1 }
    expect(useSettingsStore().luoguEnableO2).toBe(false)
  })
})
