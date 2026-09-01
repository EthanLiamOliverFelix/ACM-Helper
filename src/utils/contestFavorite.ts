export type ContestPlatform = 'codeforces' | 'luogu' | 'atcoder' | 'qoj'

export interface ParsedContestLink {
  platform: ContestPlatform
  contestId: string
  url: string
  title: string
}

export function parseContestLink(input: string): ParsedContestLink {
  let url: URL
  try { url = new URL(input.trim()) }
  catch { throw new Error('请输入完整的比赛链接') }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('比赛链接必须使用 http 或 https')

  const host = url.hostname.toLowerCase().replace(/^www\./, '')
  const path = url.pathname.replace(/\/+$/, '')
  let match: RegExpMatchArray | null

  if (host === 'codeforces.com' && (match = path.match(/^\/(contest|gym)\/(\d+)(?:\/.*)?$/i))) {
    const kind = match[1].toLowerCase()
    const contestId = match[2]
    return {
      platform: 'codeforces',
      contestId: `${kind}:${contestId}`,
      url: `https://codeforces.com/${kind}/${contestId}`,
      title: kind === 'gym' ? `Codeforces Gym ${contestId}` : `Codeforces Contest ${contestId}`,
    }
  }
  if (host === 'luogu.com.cn' && (match = path.match(/^\/contest\/(\d+)(?:\/.*)?$/i))) {
    const contestId = match[1]
    return { platform: 'luogu', contestId, url: `https://www.luogu.com.cn/contest/${contestId}`, title: `洛谷比赛 ${contestId}` }
  }
  if (host === 'atcoder.jp' && (match = path.match(/^\/contests\/([a-z0-9_-]+)(?:\/.*)?$/i))) {
    const contestId = match[1].toLowerCase()
    return { platform: 'atcoder', contestId, url: `https://atcoder.jp/contests/${contestId}`, title: `AtCoder ${contestId.toUpperCase()}` }
  }
  if (host === 'qoj.ac' && (match = path.match(/^\/contest\/(\d+)(?:\/.*)?$/i))) {
    const contestId = match[1]
    return { platform: 'qoj', contestId, url: `https://qoj.ac/contest/${contestId}`, title: `QOJ Contest ${contestId}` }
  }
  throw new Error('仅支持洛谷、Codeforces、AtCoder 和 QOJ 的比赛链接')
}
