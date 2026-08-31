/** Build the official URL for both global and contest-scoped QOJ problem ids. */
export function qojProblemUrl(id: string) {
  const normalized = id.trim().toUpperCase()
  const contestProblem = normalized.match(/^C(\d+)([A-Z][A-Z0-9_]*)$/)
  return contestProblem
    ? `https://qoj.ac/contest/${contestProblem[1]}/problem/${contestProblem[2]}`
    : `https://qoj.ac/problem/${encodeURIComponent(id.trim())}`
}
