/** Pointer gestures need the same floating row preview as native HTML dragging. */
export function createDragGhost(element: HTMLElement, x: number, y: number, count = 1) {
  const rect = element.getBoundingClientRect()
  const ghost = element.cloneNode(true) as HTMLElement
  // Preserve ancestor-dependent tree styles outside the tree.
  const originals = [element, ...element.querySelectorAll<HTMLElement>('*')]
  const copies = [ghost, ...ghost.querySelectorAll<HTMLElement>('*')]
  originals.forEach((original, index) => {
    const computed = getComputedStyle(original)
    for (const property of computed) copies[index].style.setProperty(property, computed.getPropertyValue(property))
    copies[index].style.pointerEvents = 'none'
    copies[index].removeAttribute('autofocus')
    copies[index].tabIndex = -1
  })
  ghost.removeAttribute('id')
  ghost.querySelectorAll('[id]').forEach(child => child.removeAttribute('id'))
  ghost.setAttribute('aria-hidden', 'true')
  ghost.removeAttribute('draggable')
  ghost.classList.remove('dragging', 'moving', 'target', 'drop-into', 'drop-before', 'drop-after')
  const offsetX = Math.min(Math.max(x - rect.left, 0), rect.width)
  const offsetY = Math.min(Math.max(y - rect.top, 0), rect.height)
  Object.assign(ghost.style, {
    position: 'fixed', zIndex: '10000', pointerEvents: 'none', margin: '0',
    width: `${rect.width}px`, height: `${rect.height}px`, boxSizing: 'border-box',
    opacity: '.8', background: 'var(--color-bg-panel)', border: '1px solid var(--color-accent)',
    borderRadius: '5px', boxShadow: '0 6px 20px var(--color-overlay)', transition: 'none',
  })
  if (count > 1) {
    const badge = document.createElement('span')
    badge.textContent = `${count} 项`
    Object.assign(badge.style, { position: 'absolute', right: '-6px', top: '-10px', padding: '3px 7px', borderRadius: '10px', background: 'var(--color-accent)', color: 'var(--color-text-on-accent)', font: '12px var(--font-ui)', pointerEvents: 'none' })
    ghost.appendChild(badge)
  }
  function move(clientX: number, clientY: number) {
    ghost.style.left = `${clientX - offsetX + 6}px`
    ghost.style.top = `${clientY - offsetY + 6}px`
  }
  move(x, y)
  document.body.appendChild(ghost)
  return { move, remove: () => ghost.remove() }
}
