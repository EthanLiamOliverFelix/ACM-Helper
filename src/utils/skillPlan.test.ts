import { describe, expect, it } from 'vitest'
import { parseChatProblemSetResponse, parseSkillPlanResponse, stripChatProblemSetBlock } from './skillPlan'

describe('skill plan response', () => {
  it('extracts fenced JSON and canonicalizes links', () => {
    const result = parseSkillPlanResponse('```json\n[{"platform":"CF","id":"4a","title":"Watermelon","rating":800,"reason":"入门"},{"platform":"洛谷","id":"p1001","title":"A+B","reason":"练习"}]\n```')
    expect(result).toHaveLength(2)
    expect(result[0].url).toBe('https://codeforces.com/problemset/problem/4/A')
    expect(result[1].url).toBe('https://www.luogu.com.cn/problem/P1001')
  })

  it('rejects unsupported links and removes duplicates', () => {
    const result = parseSkillPlanResponse('[{"platform":"codeforces","id":"9E"},{"platform":"cf","id":"9e"},{"platform":"atcoder","id":"ABC001_A"},{"platform":"codeforces","id":"../1A"}]')
    expect(result.map(item => `${item.platform}:${item.id}`)).toEqual(['codeforces:9E', 'atcoder:ABC001_A'])
  })

  it('extracts an importable problem set from a normal chat response', () => {
    const text = '这是递进练习建议。\n```acm-problem-set\n{"name":"二分入门","problems":[{"platform":"cf","id":"4A","title":"Watermelon","reason":"热身"}]}\n```'
    expect(parseChatProblemSetResponse(text)?.name).toBe('二分入门')
    expect(parseChatProblemSetResponse(text)?.problems[0].id).toBe('4A')
    expect(stripChatProblemSetBlock(text)).toBe('这是递进练习建议。')
  })
})
