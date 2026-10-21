export type BatchProblemPlatform = 'codeforces' | 'luogu' | 'atcoder' | 'qoj'

export interface BatchProblemToken {
  raw: string
  url?: string
  platform?: BatchProblemPlatform
  id?: string
  query?: string
}

export interface BatchProblemFailure {
  raw: string
  line: number
  reason: string
}

export function normalizeBatchProblemTitle(value: string) {
  return value.trim().toLocaleLowerCase().replace(/\s+/gu, ' ')
}

/** Build once per import, rather than deduplicating the full catalog for every token. */
export function createBatchCatalogLookup<T extends { platform: string; id: string; title: string }>(items: Iterable<T>) {
  const byId = new Map<string, T>()
  for (const item of items) {
    if (!['codeforces', 'luogu', 'atcoder', 'qoj'].includes(item.platform)) continue
    const key = `${item.platform}:${item.id.toUpperCase()}`
    if (!byId.has(key)) byId.set(key, item)
  }
  let titles: { item: T; title: string }[] | undefined
  return (token: BatchProblemToken): T | undefined => {
    if (token.id && token.platform) return byId.get(`${token.platform}:${token.id.toUpperCase()}`)
    if (!token.query) return undefined
    titles ??= Array.from(byId.values(), item => ({ item, title: normalizeBatchProblemTitle(item.title) }))
    const wanted = normalizeBatchProblemTitle(token.query)
    if (!wanted) return undefined
    let exact: T | undefined
    let exactCount = 0
    for (const entry of titles) {
      if (token.platform && entry.item.platform !== token.platform) continue
      if (entry.title === wanted) { exact = entry.item; exactCount++ }
    }
    return exactCount === 1 ? exact : undefined
  }
}

const idPatterns: Record<BatchProblemPlatform, RegExp> = {
  luogu: /^(?:[PBTU]\d+|CF\d+[A-Z]\d*|AT_[A-Z0-9_]+|SP\d+|UVA\d+)$/i,
  codeforces: /^\d+[A-Z]\d*$/i,
  atcoder: /^[A-Z0-9]+_[A-Z0-9]+(?:_[A-Z0-9]+)*$/i,
  qoj: /^(?:\d+|C\d+[A-Z][A-Z0-9_]*)$/i,
}

function validateToken(token: BatchProblemToken): BatchProblemToken | string {
  if (token.url) {
    try {
      const url = new URL(token.url)
      const routes: Record<string, RegExp> = {
        'codeforces.com': /^\/(?:problemset\/problem\/\d+\/[A-Z]\d*|contest\/\d+\/problem\/[A-Z]\d*)\/?$/i,
        'luogu.com.cn': /^\/problem\/(?:[PBTU]\d+|CF\d+[A-Z]\d*|AT_[A-Z0-9_]+|SP\d+|UVA\d+)\/?$/i,
        'luogu.com': /^\/problem\/(?:[PBTU]\d+|CF\d+[A-Z]\d*|AT_[A-Z0-9_]+|SP\d+|UVA\d+)\/?$/i,
        'atcoder.jp': /^\/contests\/[A-Z0-9_-]+\/tasks\/[A-Z0-9]+(?:_[A-Z0-9]+)+\/?$/i,
        'qoj.ac': /^\/(?:problem\/\d+|contest\/\d+\/problem\/[A-Z0-9_]+)(?:\/statement\/[A-Z_]+)?\/?$/i,
      }
      const route = routes[url.hostname.replace(/^www\./, '')]
      if (!/^https?:$/.test(url.protocol) || url.username || url.password || url.port || !route?.test(url.pathname)) {
        return '链接格式不正确，请使用所支持 OJ 的具体题目链接'
      }
      return token
    } catch { return '链接格式不正确' }
  }
  const prefix = token.raw.match(/^(cf|codeforces|洛谷|luogu|at|atcoder|qoj)\s*[-—:：]\s*(.*)$/i)
  const platform = prefix ? platformName(prefix[1]) : undefined
  const body = (prefix?.[2] ?? token.raw).trim()
  const slash = body.indexOf('/')
  const id = (slash < 0 ? body : body.slice(0, slash)).trim()
  const inferred = platform ?? (['luogu', 'codeforces', 'atcoder'] as const).find(name => idPatterns[name].test(id))
  if (inferred && idPatterns[inferred].test(id)) {
    const query = slash < 0 ? undefined : body.slice(slash + 1).trim() || undefined
    return { raw: token.raw, platform: inferred, id: id.toUpperCase(), query }
  }
  // Titles remain supported; ID-shaped input must never silently become a title search.
  if (prefix || !body || slash >= 0 || /^\d|^[A-Z][A-Z0-9_-]*\d|^[A-Z0-9]+_/i.test(body)
    || /^[^\s]*[:/\\?#]/.test(body) || /^(?:cf|codeforces|洛谷|luogu|at|atcoder|qoj)\s*[-—:：]/i.test(body)) {
    return /^\d+$/.test(body) && !platform ? '纯数字题号请加 QOJ- 前缀' : '题号格式不正确或与 OJ 前缀不匹配'
  }
  return { raw: token.raw, platform, query: body }
}

/** Validate before resolving anything, retaining the original line for failure feedback. */
export function validateBatchProblemInput(input: string) {
  const tokens: (BatchProblemToken & { line: number })[] = []
  const failures: BatchProblemFailure[] = []
  const seen = new Set<string>()
  input.split(/\r\n|\n|\r/).forEach((line, index) => {
    for (const token of parseBatchProblemInput(line)) {
      const checked = validateToken(token)
      if (typeof checked === 'string') {
        failures.push({ raw: token.raw, line: index + 1, reason: checked })
        continue
      }
      const key = checked.url ?? `${checked.platform ?? ''}:${checked.id ?? ''}:${checked.query ?? ''}`.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      tokens.push({ ...checked, line: index + 1 })
    }
  })
  return { tokens, failures }
}

/** Run each batch concurrently while keeping results in the original input order. */
export async function mapInOrderedBatches<T, R>(
  items: T[],
  batchSize: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = []
  const size = Math.max(1, Math.floor(batchSize))
  for (let offset = 0; offset < items.length; offset += size) {
    const batch = items.slice(offset, offset + size)
    results.push(...await Promise.allSettled(batch.map((item, index) => mapper(item, offset + index))))
  }
  return results
}

function platformName(value: string): BatchProblemPlatform | undefined {
  if (/^(?:cf|codeforces)$/i.test(value)) return 'codeforces'
  if (/^(?:洛谷|luogu)$/i.test(value)) return 'luogu'
  if (/^(?:at|atcoder)$/i.test(value)) return 'atcoder'
  if (/^qoj$/i.test(value)) return 'qoj'
}

function parseTextToken(rawValue: string): BatchProblemToken | null {
  const raw = rawValue.trim().replace(/^[\s,，、•*+-]+|[\s,，、]+$/g, '')
  if (!raw) return null
  const prefixed = raw.match(/^(cf|codeforces|洛谷|luogu|at|atcoder|qoj)\s*[-—:：]\s*(.+)$/i)
  const platform = prefixed ? platformName(prefixed[1]) : undefined
  const body = (prefixed?.[2] ?? raw).trim()
  const luoguId = body.match(/(?:^|[^A-Za-z0-9])([PBTU]\d{3,7})(?=$|[^A-Za-z0-9])/i)?.[1]
  const cfId = body.match(/(?:^|[^A-Za-z0-9])(\d{1,7}[A-Za-z][A-Za-z0-9]*)(?=$|[^A-Za-z0-9])/)?.[1]
  const atcoderId = body.match(/(?:^|[^A-Za-z0-9])([A-Za-z0-9]+(?:_[A-Za-z0-9]+)+)(?=$|[^A-Za-z0-9])/)?.[1]
  const qojId = platform === 'qoj' ? body.match(/^(?:\d+|C\d+[A-Za-z][A-Za-z0-9_]*)$/i)?.[0] : undefined
  const id = platform === 'luogu' ? luoguId : platform === 'codeforces' ? cfId : platform === 'atcoder' ? atcoderId : platform === 'qoj' ? qojId : (luoguId ?? cfId ?? atcoderId)
  const inferredPlatform = platform ?? (luoguId ? 'luogu' : cfId ? 'codeforces' : atcoderId ? 'atcoder' : undefined)
  const query = id
    ? body.replace(id, '').replace(/^[\s/|,，、-]+|[\s/|,，、-]+$/g, '').trim()
    : body
  return { raw, platform: inferredPlatform, id: id ? (inferredPlatform === 'luogu' || inferredPlatform === 'atcoder' ? id.toUpperCase() : inferredPlatform === 'qoj' ? id : `${id.match(/^\d+/)?.[0]}${id.slice(id.match(/^\d+/)?.[0].length ?? 0).toUpperCase()}`) : undefined, query: query || undefined }
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
