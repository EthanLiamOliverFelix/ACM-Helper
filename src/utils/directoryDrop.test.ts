import { describe, expect, it } from 'vitest'
import { batchDirectoryDropTarget, directoryDropTarget } from './directoryDrop'

describe('directory drag destinations', () => {
  const file = { path: 'F:\\notes\\算法\\题解.md', isDirectory: false }
  const folder = { path: 'F:\\notes\\算法', isDirectory: true }
  it('previews the receiving directory even when hovering another file', () => {
    expect(directoryDropTarget(file, { path: 'F:\\notes\\数学\\笔记.md', isDirectory: false }, 'F:\\notes')).toBe('F:\\notes\\数学')
    expect(directoryDropTarget(file, null, 'F:\\notes')).toBe('F:\\notes')
  })
  it('rejects self, descendants and unchanged destinations, including mixed separators and casing', () => {
    expect(directoryDropTarget(folder, folder, 'F:\\notes')).toBeUndefined()
    expect(directoryDropTarget(folder, { path: 'f:/NOTES/算法/子组', isDirectory: true }, 'F:\\notes')).toBeUndefined()
    expect(directoryDropTarget(file, folder, 'F:\\notes')).toBeUndefined()
    expect(directoryDropTarget(folder, null, 'F:\\notes')).toBeUndefined()
  })
  it('does not mistake a similarly named sibling for a descendant', () => {
    expect(directoryDropTarget(folder, { path: 'F:\\notes\\算法进阶', isDirectory: true }, 'F:\\notes')).toBe('F:\\notes\\算法进阶')
  })
  it('accepts mixed batches with unchanged items, but rejects any cycle for the whole batch', () => {
    const target = { path: 'F:\\notes\\数学', isDirectory: true }
    const unchanged = { path: 'F:\\notes\\数学\\现有.md', isDirectory: false }
    expect(batchDirectoryDropTarget([file, unchanged], target, 'F:\\notes')).toBe(target.path)
    expect(batchDirectoryDropTarget([unchanged], target, 'F:\\notes')).toBeUndefined()
    expect(batchDirectoryDropTarget([file, target], target, 'F:\\notes')).toBeUndefined()
  })
})
