export type BatchProblemPlatform = 'codeforces' | 'luogu'

export interface BatchProblemToken {
  raw: string
  url?: string
  platform?: BatchProblemPlatform
  id?: string
  query?: string
}
function platformName(value: string): BatchProblemPlatform | undefined {
  if (/^(?:cf|codeforces)$/i.test(value)) return 'codeforces'
  if (/^(?:洛谷|luogu)$/i.test(value)) return 'luogu'
}

function parseTextToken(rawValue: string): BatchProblemToken | null {
  const raw = rawValue.trim().replace(/^[\s,，、•*+-]+|[\s,，、]+$/g, '')
  if (!raw) return null
  const prefixed = raw.match(/^(cf|codeforces|洛谷|luogu)\s*[-—:：]\s*(.+)$/i)
  const platform = prefixed ? platformName(prefixed[1]) : undefined
  const body = (prefixed?.[2] ?? raw).trim()
  const luoguId = body.match(/(?:^|[^A-Za-z0-9])([PBTU]\d{3,7})(?=$|[^A-Za-z0-9])/i)?.[1]
  const cfId = body.match(/(?:^|[^A-Za-z0-9])(\d{1,7}[A-Za-z][A-Za-z0-9]*)(?=$|[^A-Za-z0-9])/)?.[1]
  const id = platform === 'luogu' ? luoguId : platform === 'codeforces' ? cfId : (luoguId ?? cfId)
  const inferredPlatform = platform ?? (luoguId ? 'luogu' : cfId ? 'codeforces' : undefined)
  const query = id
    ? body.replace(id, '').replace(/^[\s/|,，、-]+|[\s/|,，、-]+$/g, '').trim()
    : body
  return { raw, platform: inferredPlatform, id: id ? (inferredPlatform === 'luogu' ? id.toUpperCase() : `${id.match(/^\d+/)?.[0]}${id.slice(id.match(/^\d+/)?.[0].length ?? 0).toUpperCase()}`) : undefined, query: query || undefined }
}

/** Links may be separated by spaces; names occupy one line (or one semicolon-delimited item). */
export function parseBatchProblemInput(input: string): BatchProblemToken[] {
  const result: BatchProblemToken[] = []
  const urls = input.match(/https?:\/\/[^\s，,；;]+/gi) ?? []
  for (const value of urls) result.push({ raw: value, url: value.replace(/[)\]}>。！？]+$/g, '') })

  const remaining = input.replace(/https?:\/\/[^\s，,；;]+/gi, ' ')
  for (const lineValue of remaining.split(/[\r\n；;]+/)) {
    const line = lineValue.trim()
    if (!line) continue
    const words = line.split(/\s+/)
    const parsedWords = words.map(parseTextToken)
    const allStandaloneIds = words.length > 1 && parsedWords.every((item) => item?.id && !item.query)
    if (allStandaloneIds) result.push(...parsedWords.filter((item): item is BatchProblemToken => Boolean(item)))
    else {
      const parsed = parseTextToken(line)
      if (parsed) result.push(parsed)
    }
  }
  const seen = new Set<string>()
  return result.filter((item) => {
    const key = item.url?.toLowerCase() ?? `${item.platform ?? ''}:${item.id ?? ''}:${item.query?.toLowerCase() ?? ''}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
