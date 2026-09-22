import type { Problem } from '../types'

function splitCodeforcesProblemId(id: string) {
  const match = id.trim().match(/^(\d+)([A-Za-z].*)$/)
  return match
    ? { contest: Number(match[1]), index: match[2].toUpperCase() }
    : null
}

/** Sort CF ids by numeric contest id descending, then problem index ascending. */
export function compareCodeforcesProblems(left: Problem, right: Problem) {
  const leftId = splitCodeforcesProblemId(left.id)
  const rightId = splitCodeforcesProblemId(right.id)
  if (leftId && rightId) {
    if (leftId.contest !== rightId.contest) return rightId.contest - leftId.contest
    const indexOrder = leftId.index.localeCompare(rightId.index)
    if (indexOrder) return indexOrder
  } else if (leftId) return -1
  else if (rightId) return 1

  return left.id.localeCompare(right.id, undefined, { numeric: true, sensitivity: 'base' })
}
