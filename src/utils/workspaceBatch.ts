import { topLevelEntries } from './multiSelection'

export function workspaceActionEntries<T extends { path: string; isDirectory: boolean }>(entries: T[], selected: Set<string>, target: T | null): T[] {
  if (target && !selected.has(target.path)) return [target]
  return topLevelEntries(entries.filter(entry => selected.has(entry.path)))
}

export async function runWorkspaceBatch<T>(entries: readonly T[], action: (entry: T) => Promise<void>) {
  const completed: T[] = []
  const failed: { entry: T; error: unknown }[] = []
  for (const entry of entries) {
    try { await action(entry); completed.push(entry) }
    catch (error) { failed.push({ entry, error }) }
  }
  return { completed, failed }
}
