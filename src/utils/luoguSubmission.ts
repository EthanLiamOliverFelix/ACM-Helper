import type { LuoguRecordDetail, Verdict } from '../types'

export const luoguSubmissionVerdicts: Record<string, Verdict> = {
  AC: 'Accepted', WA: 'Wrong Answer', TLE: 'Time Limit Exceeded', RE: 'Runtime Error',
  MLE: 'Memory Limit Exceeded', CE: 'Compilation Error', OLE: 'Failed', UKE: 'Failed',
  IE: 'Failed', WJ: 'Pending', Judging: 'Running',
}
const statuses: Record<number, string> = { 0:'WJ', 1:'Judging', 2:'CE', 3:'OLE', 4:'MLE', 5:'TLE', 6:'WA', 7:'RE', 11:'UKE', 12:'AC', 14:'WA', 21:'AC', 22:'WA', 23:'WA' }

export function isLuoguJudging(status: Verdict) {
  return status === 'Pending' || status === 'Compiling' || status === 'Running'
}

export function resolveLuoguRecordVerdict(detail: LuoguRecordDetail): Verdict | undefined {
  if (detail.compileSuccess === false) return 'Compilation Error'
  const explicit = detail.verdict && luoguSubmissionVerdicts[detail.verdict]
  const overall = explicit || luoguSubmissionVerdicts[statuses[detail.status]]
  if (!overall || isLuoguJudging(overall)) return undefined
  if (overall === 'Wrong Answer') {
    for (const subtask of detail.subtasks ?? []) {
      for (const testCase of subtask.testCases ?? []) {
        const verdict = luoguSubmissionVerdicts[statuses[testCase.status]]
        if (verdict && !isLuoguJudging(verdict) && verdict !== 'Accepted') return verdict
      }
    }
  }
  return overall
}
