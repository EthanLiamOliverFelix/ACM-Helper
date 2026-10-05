/** Native drop positions use physical pixels, while DOM hit testing uses CSS pixels. */
export function externalWorkspaceDropPath(
  root: HTMLElement | null,
  position: { x: number; y: number },
  scale: number,
  hitTest = (x: number, y: number) => document.elementFromPoint(x, y),
): string | null {
  const element = hitTest(position.x / (scale || 1), position.y / (scale || 1))
  if (!element || !root?.contains(element)) return null
  const row = element.closest<HTMLElement>('[data-workspace-path]')
  if (row) return row.dataset.workspacePath ?? ''
  return element.closest('[data-directory-drop-area], .explorer__empty') ? '' : null
}
