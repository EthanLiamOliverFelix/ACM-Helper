export function normalizeOutputLineLimit(value: unknown, fallback = 300) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(1, Math.min(10_000, Math.trunc(parsed)))
}

export function truncateOutput(value: string, maxLines: number) {
  const limit = normalizeOutputLineLimit(maxLines)
  const lines = value.split(/\r?\n/)
  // A trailing newline creates one empty split item but does not add a visible line.
  const visibleLength = lines[lines.length - 1] === '' ? lines.length - 1 : lines.length
  if (visibleLength <= limit) return value
  return `[Truncated]\n${lines.slice(0, limit).join('\n')}`
}
