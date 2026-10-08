import { describe, expect, it, vi } from 'vitest'
import { runWorkspaceBatch, workspaceActionEntries } from './workspaceBatch'

describe('workspace batch operations', () => {
  const folder = { path: 'F:/root/folder', isDirectory: true }
  const child = { path: 'F:/root/folder/a.cpp', isDirectory: false }
  const sibling = { path: 'F:/root/b.cpp', isDirectory: false }
  const unrelated = { path: 'F:/root/c.cpp', isDirectory: false }
  const entries = [folder, child, sibling, unrelated]
  it('uses the whole selection for a context action on a selected entry', () => {
    expect(workspaceActionEntries(entries, new Set([child.path, sibling.path]), sibling)).toEqual([child, sibling])
  })
  it('does not delete unrelated selections when right-clicking an unselected entry', () => {
    expect(workspaceActionEntries(entries, new Set([child.path, sibling.path]), unrelated)).toEqual([unrelated])
  })
  it('operates on a selected folder once, without repeating its children', () => {
    expect(workspaceActionEntries(entries, new Set([folder.path, child.path, sibling.path]), null)).toEqual([folder, sibling])
  })
  it('retains a snapshot and continues when a delete or paste fails', async () => {
    const snapshot = [folder, sibling, unrelated]
    const action = vi.fn(async entry => {
      if (entry === sibling) throw new Error('access denied')
    })
    const result = await runWorkspaceBatch(snapshot, action)
    expect(action.mock.calls.map(call => call[0])).toEqual(snapshot)
    expect(result.completed).toEqual([folder, unrelated])
    expect(result.failed[0]?.entry).toBe(sibling)
    expect(snapshot).toEqual([folder, sibling, unrelated])
  })
})
