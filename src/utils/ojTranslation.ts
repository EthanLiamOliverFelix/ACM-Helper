import type { Platform } from '../types'

/** Keep in-memory translation keys aligned with the normalized on-disk file name. */
export function ojTranslationKey(platform: Platform, problemId: string) {
  return `${platform}:${problemId.trim().toUpperCase()}`
}
