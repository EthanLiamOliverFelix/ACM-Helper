import type { GeneratedProblemSet, SkillPlanProblem } from '../types'

function jsonPayload(value: string) {
  const fenced = value.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]
  const source = fenced ?? value
  const arrayStart = source.indexOf('[')
  const arrayEnd = source.lastIndexOf(']')
  if (arrayStart < 0 || arrayEnd <= arrayStart) throw new Error('AI 没有返回 JSON 题目数组')
  return JSON.parse(source.slice(arrayStart, arrayEnd + 1))
}

/** Parse and constrain AI output to safe, canonical supported-OJ links. */
export function parseSkillPlanResponse(value: string): SkillPlanProblem[] {
  const raw = jsonPayload(value)
  if (!Array.isArray(raw)) throw new Error('AI 题单格式无效')
  const seen = new Set<string>()
  const result: SkillPlanProblem[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const platformValue = String(item.platform ?? '').toLowerCase()
    const platform = platformValue === 'cf' || platformValue === 'codeforces' ? 'codeforces'
      : platformValue === 'luogu' || platformValue === '洛谷' ? 'luogu'
        : platformValue === 'at' || platformValue === 'atcoder' ? 'atcoder'
        : null
    const id = String(item.id ?? '').trim().toUpperCase()
    if (!platform || !id) continue
    if (platform === 'codeforces' && !/^\d+[A-Z]\d*$/.test(id)) continue
    if (platform === 'luogu' && !/^(?:P|B|U|T|CF|AT_|UVA|SP)\w+$/i.test(id)) continue
    if (platform === 'atcoder' && !/^[A-Z0-9]+(?:_[A-Z0-9]+)+$/.test(id)) continue
    const key = `${platform}:${id}`
    if (seen.has(key)) continue
    seen.add(key)
    result.push({
      platform,
      id,
      title: String(item.title ?? id).trim() || id,
      url: platform === 'codeforces'
        ? `https://codeforces.com/problemset/problem/${id.match(/^\d+/)![0]}/${id.replace(/^\d+/, '')}`
        : platform === 'luogu'
          ? `https://www.luogu.com.cn/problem/${encodeURIComponent(id)}`
          : `https://atcoder.jp/contests/${id.split('_')[0].toLowerCase()}/tasks/${id.toLowerCase()}`,
      rating: Number.isFinite(Number(item.rating)) && Number(item.rating) > 0 ? Number(item.rating) : undefined,
      reason: String(item.reason ?? '用于巩固该知识点').trim() || '用于巩固该知识点',
    })
  }
  return result
}

/** AI 对话使用的可见文本 + 机器可导入题单协议。 */
export function parseChatProblemSetResponse(value: string): GeneratedProblemSet | null {
  const match = value.match(/```acm-problem-set\s*([\s\S]*?)```/i)
  if (!match) return null
  try {
    const payload = JSON.parse(match[1])
    const problems = parseSkillPlanResponse(JSON.stringify(payload?.problems ?? []))
    if (!problems.length) return null
    return {
      name: String(payload?.name ?? 'AI 推荐题单').trim() || 'AI 推荐题单',
      problems,
    }
  } catch {
    return null
  }
}

export function stripChatProblemSetBlock(value: string) {
  return value.replace(/```acm-problem-set\s*[\s\S]*?```/gi, '').trim()
}
