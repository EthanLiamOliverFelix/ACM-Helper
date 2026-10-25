import type { Problem } from '../types'
import { qojStatementPdfUrl } from './qoj'

/** PDF headers and formula letters are not a reliable indicator of statement language. */
export function isChineseQojPdf(problem?: Problem | null) {
  if (problem?.platform !== 'qoj') return false
  const pdf = qojStatementPdfUrl(problem.note)
  if (!pdf) return false
  const version = new URL(pdf).searchParams.get('ver') ?? ''
  if (/^(?:zh(?:[_-]|$)|cn$|chinese$)/i.test(version) || /中文题面/.test(problem.source ?? '')) return true
  // Older cached entries may have no language marker. Count Chinese in the body
  // only, so an English contest title/header cannot outweigh Chinese prose.
  const body = `${problem.description ?? ''} ${problem.input ?? ''} ${problem.output ?? ''}`.replace(/<[^>]+>/g, ' ')
  return (body.match(/[\u3400-\u9fff]/g) ?? []).length >= 12
}

export function supportsStatementTranslation(problem?: Problem | null, hasTranslation = false) {
  if (!problem || !['codeforces', 'luogu', 'atcoder', 'qoj'].includes(problem.platform) || isChineseQojPdf(problem)) return false
  if (hasTranslation) return true
  const source = `${problem.title} ${problem.description ?? ''} ${problem.input ?? ''} ${problem.output ?? ''}`.replace(/<[^>]+>/g, ' ')
  const latin = (source.match(/[A-Za-z]/g) ?? []).length
  const cjk = (source.match(/[\u3400-\u9fff]/g) ?? []).length
  return latin >= 24 && latin > cjk * 2
}
