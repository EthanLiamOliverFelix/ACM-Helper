import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { getDataCenterValue, saveDataCenterValue } from '../dataCenter'
import { parseContestLink, type ContestPlatform } from '../utils/contestFavorite'

export interface ContestFavorite {
  id: string
  platform: ContestPlatform
  contestId: string
  title: string
  url: string
  addedAt: number
}

function loadFavorites() {
  const value = getDataCenterValue<ContestFavorite[]>('contest-favorites', [])
  return Array.isArray(value) ? value.filter((item) => item?.url && item?.platform && item?.contestId) : []
}

export const useContestFavoriteStore = defineStore('contestFavorites', () => {
  const favorites = ref<ContestFavorite[]>(loadFavorites())
  const count = computed(() => favorites.value.length)

  function save() {
    void saveDataCenterValue('contest-favorites', favorites.value)
  }

  function addFromUrl(input: string, preferredTitle?: string) {
    const parsed = parseContestLink(input)
    const existing = favorites.value.find((item) => item.platform === parsed.platform && item.contestId === parsed.contestId)
    if (existing) {
      if (preferredTitle?.trim() && existing.title !== preferredTitle.trim()) {
        existing.title = preferredTitle.trim()
        save()
      }
      return { favorite: existing, added: false }
    }
    const favorite: ContestFavorite = {
      id: `${parsed.platform}:${parsed.contestId}`,
      platform: parsed.platform,
      contestId: parsed.contestId,
      title: preferredTitle?.trim() || parsed.title,
      url: parsed.url,
      addedAt: Date.now(),
    }
    favorites.value.unshift(favorite)
    save()
    return { favorite, added: true }
  }

  function remove(id: string) {
    favorites.value = favorites.value.filter((item) => item.id !== id)
    save()
  }

  function contains(platform: ContestPlatform, contestId: string) {
    const normalized = contestId.replace(/^(?:contest|gym):/i, '')
    return favorites.value.some((item) => item.platform === platform && item.contestId.replace(/^(?:contest|gym):/i, '') === normalized)
  }

  return { favorites, count, addFromUrl, remove, contains }
})
