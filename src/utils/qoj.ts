/** Build the official URL for both global and contest-scoped QOJ problem ids. */
export function qojProblemUrl(id: string) {
  const normalized = id.trim().toUpperCase()
  const contestProblem = normalized.match(/^C(\d+)([A-Z][A-Z0-9_]*)$/)
  return contestProblem
    ? `https://qoj.ac/contest/${contestProblem[1]}/problem/${contestProblem[2]}`
    : `https://qoj.ac/problem/${encodeURIComponent(id.trim())}`
}


/** Only embed QOJ's own PDF downloads in the statement panel. */
export function qojStatementPdfUrl(note?: string): string | null {
  const match = note?.match(/^PDF statement:\s*(https:\/\/\S+)/)
  if (!match) return null
  try {
    const url = new URL(match[1]!)
    return url.hostname === 'qoj.ac' && !url.port && !url.username && !url.password ? url.href : null
  } catch { return null }
}
export function isQojPlaceholderTitle(title: string, id: string) {
  return ['QOJ', 'QOJ.ac', `QOJ ${id}`, id].includes(title.trim())
}
