/** Let the browser paint the immediate navigation feedback before secondary work. */
export function afterPaint(task: () => void): () => void {
  if (typeof requestAnimationFrame !== 'function') { task(); return () => {} }
  let cancelled = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const frame = requestAnimationFrame(() => {
    timer = setTimeout(() => { if (!cancelled) task() }, 0)
  })
  return () => { cancelled = true; cancelAnimationFrame(frame); if (timer !== undefined) clearTimeout(timer) }
}

export function waitForPaint(): Promise<void> {
  return new Promise(resolve => { afterPaint(resolve) })
}
