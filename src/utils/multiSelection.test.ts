import { describe, expect, it, vi } from 'vitest'
import { effectScope, ref } from 'vue'
import { MultiSelection, flattenTree, topLevelEntries } from './multiSelection'
import { useMultiSelection } from '../composables/useMultiSelection'

describe('multi selection and cached counts', () => {
  it('fills partial selections and clears a fully selected page', () => {
    const selection = new MultiSelection()
    selection.setScope(['group', 'a', 'b'])
    selection.click('a', {}, true)
    expect(selection.selectedInScope).toBe(1)
    selection.toggleAll()
    expect([...selection.selected]).toEqual(['a', 'group', 'b'])
    expect(selection.allSelected).toBe(true)
    selection.toggleAll()
    expect(selection.selected.size).toBe(0)
    expect(selection.selectedInScope).toBe(0)
  })

  it('checks all-selected without walking the selection or page', () => {
    const selection = new MultiSelection()
    selection.setScope(['a', 'b'])
    selection.toggleAll()
    vi.spyOn(selection.selected, 'has').mockImplementation(() => { throw new Error('should not scan') })
    selection.scope = new Proxy(selection.scope, { get: (array, property) => {
      if (property !== 'length') throw new Error('should not scan')
      return array.length
    } })
    expect(selection.allSelected).toBe(true)
  })

  it('selects inclusive ranges in either direction while keeping a stable anchor', () => {
    const selection = new MultiSelection()
    selection.setScope(['folder', 'child', 'nested', 'file', 'last'])
    selection.click('child')
    selection.click('last', { shiftKey: true })
    expect([...selection.selected]).toEqual(['child', 'nested', 'file', 'last'])
    selection.click('folder', { shiftKey: true })
    expect([...selection.selected]).toEqual(['folder', 'child'])
    expect(selection.anchor).toBe('child')
    selection.click('file', { ctrlKey: true })
    selection.click('file', { ctrlKey: true })
    expect(selection.selectedInScope).toBe(2)
  })

  it('updates cached counts when pages or filters change without selecting other pages', () => {
    const scope = effectScope()
    scope.run(() => {
      const page = ref(['a', 'b'])
      const available = ref(['a', 'b', 'c', 'd'])
      const selection = useMultiSelection(() => page.value, () => available.value)
      selection.toggleAll()
      page.value = ['c', 'd']
      expect(selection.selectedInScope).toBe(0)
      expect(selection.allSelected).toBe(false)
      expect([...selection.selected]).toEqual(['a', 'b'])
      selection.toggleAll()
      selection.toggleAll()
      expect([...selection.selected]).toEqual(['a', 'b'])
      available.value = ['b', 'c', 'd']
      expect([...selection.selected]).toEqual(['b'])
      page.value = ['b']
      expect(selection.allSelected).toBe(true)
    })
    scope.stop()
  })
})

describe('tree selection order and batch roots', () => {
  const child = { path: 'F:/root/folder/child.md', isDirectory: false, children: [] }
  const folder = { path: 'F:/root/folder', isDirectory: true, children: [child] }
  const sibling = { path: 'F:/root/folder-extra', isDirectory: true, children: [] }
  it('includes expanded children in display order and excludes collapsed children', () => {
    expect(flattenTree([folder, sibling], new Set([folder.path])).map(entry => entry.path)).toEqual([folder.path, child.path, sibling.path])
    expect(flattenTree([folder, sibling], new Set()).map(entry => entry.path)).toEqual([folder.path, sibling.path])
  })
  it('moves a selected parent once without dropping similarly named siblings', () => {
    expect(topLevelEntries([child, sibling, folder])).toEqual([sibling, folder])
    expect(topLevelEntries([child, { ...folder, path: 'f:\\ROOT\\FOLDER' }])).toHaveLength(1)
  })
})
