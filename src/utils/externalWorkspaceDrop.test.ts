import { describe, expect, it, vi } from 'vitest'
import { externalWorkspaceDropPath } from './externalWorkspaceDrop'

function surface(path?: string, blank = false, inside = true) {
  const row = path === undefined ? null : { dataset: { workspacePath: path } }
  const element = {
    closest: (selector: string) => selector === '[data-workspace-path]' ? row : blank ? {} : null,
  } as unknown as Element
  const root = { contains: (hit: Element) => inside && hit === element } as unknown as HTMLElement
  const hitTest = vi.fn(() => element)
  return { root, hitTest }
}

describe('external workspace drop hit testing', () => {
  it.each([1, 1.25, 1.5, 2])('resolves the folder row at display scale %s', scale => {
    const { root, hitTest } = surface('F:/workspace/folder')
    expect(externalWorkspaceDropPath(root, { x: 120 * scale, y: 80 * scale }, scale, hitTest)).toBe('F:/workspace/folder')
    expect(hitTest).toHaveBeenCalledExactlyOnceWith(120, 80)
  })

  it('accepts tree blank space and an empty workspace as root destinations', () => {
    const { root, hitTest } = surface(undefined, true)
    expect(externalWorkspaceDropPath(root, { x: 1, y: 1 }, 1, hitTest)).toBe('')
  })

  it('rejects other panels, toolbar controls, and overlays', () => {
    for (const fixture of [surface('F:/other', false, false), surface(), surface(undefined, true, false)]) {
      expect(externalWorkspaceDropPath(fixture.root, { x: 1, y: 1 }, 1, fixture.hitTest)).toBeNull()
    }
    expect(externalWorkspaceDropPath(null, { x: 1, y: 1 }, 1, () => null)).toBeNull()
  })
})
