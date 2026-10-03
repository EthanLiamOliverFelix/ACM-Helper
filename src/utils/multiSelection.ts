export interface SelectionModifiers { shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean }

export class MultiSelection {
  selected = new Set<string>()
  scope: string[] = []
  scopeSet = new Set<string>()
  selectedInScope = 0
  anchor: string | null = null

  get allSelected() { return this.scope.length > 0 && this.selectedInScope === this.scope.length }

  setScope(ids: string[]) {
    this.scope = ids
    this.scopeSet = new Set(ids)
    this.selectedInScope = ids.reduce((count, id) => count + Number(this.selected.has(id)), 0)
  }

  set(id: string, checked: boolean) {
    if (this.selected.has(id) === checked) return
    if (checked) this.selected.add(id); else this.selected.delete(id)
    if (this.scopeSet.has(id)) this.selectedInScope += checked ? 1 : -1
  }

  clear() { this.selected.clear(); this.selectedInScope = 0; this.anchor = null }
  replace(ids: string[]) { this.clear(); ids.forEach(id => this.set(id, true)); this.anchor = ids[0] ?? null }
  prune(available: Set<string>) {
    for (const id of this.selected) if (!available.has(id)) this.set(id, false)
    if (this.anchor && !available.has(this.anchor)) this.anchor = null
  }

  click(id: string, modifiers: SelectionModifiers = {}, toggle = false) {
    const additive = modifiers.ctrlKey || modifiers.metaKey
    if (modifiers.shiftKey && this.anchor && this.scopeSet.has(this.anchor) && this.scopeSet.has(id)) {
      const anchor = this.anchor
      const a = this.scope.indexOf(anchor), b = this.scope.indexOf(id)
      if (!additive) this.clear()
      this.scope.slice(Math.min(a, b), Math.max(a, b) + 1).forEach(item => this.set(item, true))
      this.anchor = anchor
    } else {
      if (additive || toggle) this.set(id, !this.selected.has(id))
      else this.replace([id])
      this.anchor = id
    }
  }

  toggleAll() {
    // The decision uses the maintained count; only the actual updates scan rows.
    const checked = !this.allSelected
    this.scope.forEach(id => this.set(id, checked))
    this.anchor = checked ? this.scope[0] ?? null : null
  }
}

export interface TreeEntry { path: string; isDirectory: boolean; children: TreeEntry[] }
export function flattenTree<T extends TreeEntry>(entries: T[], expanded?: Set<string>): T[] {
  return entries.flatMap(entry => [entry, ...(entry.isDirectory && (!expanded || expanded.has(entry.path)) ? flattenTree(entry.children as T[], expanded) : [])])
}

export function topLevelEntries<T extends { path: string; isDirectory: boolean }>(entries: T[]): T[] {
  const normalize = (path: string) => path.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
  const folders = new Set(entries.filter(entry => entry.isDirectory).map(entry => normalize(entry.path)))
  return entries.filter(entry => {
    let parent = normalize(entry.path)
    while (parent.includes('/')) {
      parent = parent.slice(0, parent.lastIndexOf('/'))
      if (folders.has(parent)) return false
    }
    return true
  })
}
