import { describe, expect, it } from 'vitest'
import { orderNotes, reorderNotes, type NoteOrder } from './noteOrder'
import type { NoteEntry } from '../types'
const entry = (path: string, children: NoteEntry[] = []): NoteEntry => ({ path, name: path.split('/').pop()!, isDirectory: !path.endsWith('.md'), children, updatedAt: 0 })
describe('persistent notebook order', () => {
  it('preserves manual order and appends new notebooks and notes to their parent', () => {
    const order: NoteOrder = { 'f:/notes': ['f:/notes/b', 'f:/notes/a'], 'f:/notes/a': ['f:/notes/a/z.md'] }
    const tree = orderNotes([entry('F:/notes/a', [entry('F:/notes/a/new.md'), entry('F:/notes/a/z.md')]), entry('F:/notes/new'), entry('F:/notes/b')], order, 'F:/notes')
    expect(tree.map(item => item.name)).toEqual(['b', 'a', 'new'])
    expect(tree[1]!.children.map(item => item.name)).toEqual(['z.md', 'new.md'])
    expect(orderNotes([...tree].reverse(), order, 'F:/notes').map(item => item.name)).toEqual(['b', 'a', 'new'])
  })
  it('reorders siblings without allowing cross-directory reorder or self drops', () => {
    const order: NoteOrder = { 'f:/notes': ['f:/notes/a', 'f:/notes/b', 'f:/notes/c'] }
    expect(reorderNotes(order, ['F:/notes/c'], 'F:/notes/a')).toBe(true)
    expect(order['f:/notes']).toEqual(['f:/notes/c', 'f:/notes/a', 'f:/notes/b'])
    expect(reorderNotes(order, ['F:/notes/a'], 'F:/notes/a')).toBe(false)
    expect(reorderNotes(order, ['F:/notes/sub/a'], 'F:/notes/b')).toBe(false)
  })
  it('retains a selected batch in its current relative order', () => {
    const order: NoteOrder = { 'f:/notes': ['f:/notes/a', 'f:/notes/b', 'f:/notes/c', 'f:/notes/d'] }
    reorderNotes(order, ['F:/notes/d', 'F:/notes/c'], 'F:/notes/a')
    expect(order['f:/notes']).toEqual(['f:/notes/c', 'f:/notes/d', 'f:/notes/a', 'f:/notes/b'])
  })
})
