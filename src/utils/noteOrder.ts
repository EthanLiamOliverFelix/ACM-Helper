import type { NoteEntry } from '../types'
export type NoteOrder = Record<string, string[]>
export const notePathKey = (path: string) => path.replace(/\\/g, '/').toLowerCase()
export const noteParent = (path: string) => notePathKey(path).slice(0, notePathKey(path).lastIndexOf('/'))

export function orderNotes(entries: NoteEntry[], order: NoteOrder, parent: string): NoteEntry[] {
  const key = notePathKey(parent)
  const ranks = new Map((order[key] ?? []).map((path, index) => [notePathKey(path), index]))
  const sorted = [...entries].sort((a, b) => (ranks.get(notePathKey(a.path)) ?? Infinity) - (ranks.get(notePathKey(b.path)) ?? Infinity))
  order[key] = sorted.map(entry => notePathKey(entry.path))
  return sorted.map(entry => ({ ...entry, children: entry.isDirectory ? orderNotes(entry.children, order, entry.path) : entry.children }))
}

export function reorderNotes(order: NoteOrder, sources: string[], target: string): boolean {
  const parent = noteParent(target)
  const sourceKeys = sources.map(notePathKey)
  const targetKey = notePathKey(target)
  const siblings = order[parent]
  if (!siblings || sourceKeys.includes(targetKey) || sources.some(path => noteParent(path) !== parent)) return false
  const moving = siblings.filter(path => sourceKeys.includes(path))
  if (!moving.length || !siblings.includes(targetKey)) return false
  const rest = siblings.filter(path => !sourceKeys.includes(path))
  rest.splice(rest.indexOf(targetKey), 0, ...moving)
  order[parent] = rest
  return true
}
