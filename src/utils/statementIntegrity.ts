import type { Problem } from '../types'

export function statementSource(problem: Problem) {
  return JSON.stringify([problem.title, problem.description ?? '', problem.input ?? '', problem.output ?? '', problem.note ?? '', problem.contentFormat, problem.samples ?? []])
}

// Store the source alongside the Markdown so a translation cannot silently
// survive a different statement revision. The old file is retained until replaced.
export function encodeTranslation(content: string, source: string) {
  return `<!-- acm-source:${encodeURIComponent(source)} -->\n${content}`
}
export function decodeTranslation(value: string) {
  const match = value.match(/^<!-- acm-source:(.*?) -->\r?\n/)
  if (!match) return { content: value, source: undefined }
  try { return { content: value.slice(match[0].length), source: decodeURIComponent(match[1]!) } }
  catch { return { content: value, source: undefined } }
}

export function statementError(problem: Problem, previous?: Problem) {
  if (!problem.description?.trim()) return '题面正文为空'
  if (problem.platform === 'codeforces' && (!problem.input?.trim() || !problem.output?.trim() || !problem.samples?.length)) {
    return 'Codeforces 题面缺少输入输出说明或样例'
  }
  if (previous?.samples?.length && !problem.samples?.length) return '重新抓取的题面丢失了已有样例'
  if ((previous?.samples?.length ?? 0) > (problem.samples?.length ?? 0)) return '重新抓取的题面丢失了部分已有样例'
  if (previous?.input?.trim() && !problem.input?.trim()) return '重新抓取的题面丢失了输入说明'
  if (previous?.output?.trim() && !problem.output?.trim()) return '重新抓取的题面丢失了输出说明'
  if (problem.platform === 'codeforces' && previous?.description && previous.description.length > 200 && problem.description.length < previous.description.length / 2) return '重新抓取的正文明显不完整'
  return null
}

export function translationSourceError(problem: Problem) {
  return statementError(problem) || (/^该题使用 PDF 题面/.test(problem.description ?? '') ? 'PDF 正文尚未提取，不能翻译预览提示文字' : null)
}

export function translationCoverageError(content: string, problem: Problem) {
  if (problem.input?.trim() && !/(?:输入|读入|\binput\b)/i.test(content)) return '译文缺少输入说明'
  if (problem.output?.trim() && !/(?:输出|\boutput\b)/i.test(content)) return '译文缺少输出说明'
  return null
}
