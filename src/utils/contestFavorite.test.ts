import { describe, expect, it } from 'vitest'
import { parseContestLink } from './contestFavorite'

describe('parseContestLink', () => {
  it.each([
    ['https://codeforces.com/contest/2040/problems', 'codeforces', 'contest:2040', 'https://codeforces.com/contest/2040'],
    ['https://codeforces.com/gym/105001', 'codeforces', 'gym:105001', 'https://codeforces.com/gym/105001'],
    ['https://www.luogu.com.cn/contest/123456#problems', 'luogu', '123456', 'https://www.luogu.com.cn/contest/123456'],
    ['https://atcoder.jp/contests/abc390/tasks', 'atcoder', 'abc390', 'https://atcoder.jp/contests/abc390'],
    ['https://qoj.ac/contest/1096', 'qoj', '1096', 'https://qoj.ac/contest/1096'],
  ])('recognizes %s', (input, platform, contestId, url) => {
    expect(parseContestLink(input)).toMatchObject({ platform, contestId, url })
  })

  it('rejects problem and unrelated links', () => {
    expect(() => parseContestLink('https://qoj.ac/problem/1')).toThrow()
    expect(() => parseContestLink('https://example.com/contest/1')).toThrow()
  })
})
