import { describe, expect, it } from 'vitest'
import { parseDebugValue } from './debugValue'

describe('debug aggregate values', () => {
  it('walks vector<tree> through a member and nested vectors', () => {
    const trees = parseDebugValue('std::vector of length 1, capacity 1 = {{tt = std::vector of length 2, capacity 2 = {std::vector of length 0, capacity 0, std::vector of length 2, capacity 2 = {3, 4}}}}')
    expect(trees.summary).toBe('容器 · 1 项')
    expect(trees.children[0].name).toBe('[0]')
    const tree = parseDebugValue(trees.children[0].value)
    expect(tree.summary).toBe('对象 · 1 个成员')
    expect(tree.children[0].name).toBe('tt')
    const tt = parseDebugValue(tree.children[0].value)
    expect(tt.children).toHaveLength(2)
    expect(parseDebugValue(tt.children[0].value).summary).toBe('容器 · 0 项')
    expect(parseDebugValue(tt.children[1].value).children).toEqual([{ name: '[0]', value: '3' }, { name: '[1]', value: '4' }])
  })

  it('supports single elements and single named members', () => {
    expect(parseDebugValue('{42}').children).toEqual([{ name: '[0]', value: '42' }])
    expect(parseDebugValue('{value = 42}').children).toEqual([{ name: 'value', value: '42' }])
    expect(parseDebugValue('{}').summary).toBe('容器 · 0 项')
  })

  it('preserves strings, commas, escapes and equals signs inside nested values', () => {
    const raw = '{text = "a, {b} = \\\"c\\\"", pair = {first = 1, second = 2}}'
    const parsed = parseDebugValue(raw)
    expect(parsed.children).toHaveLength(2)
    expect(parsed.children[0].value).toBe('"a, {b} = \\\"c\\\""')
    expect(parseDebugValue(parsed.children[1].value).children[1]).toEqual({ name: 'second', value: '2' })
    for (const value of ['"{a, b}"', '0x123 "{a, b}"', '7', '<不可用>']) {
      expect(parseDebugValue(value)).toEqual({ summary: value, children: [], expandable: false })
    }
  })

  it('keeps the real total when GDB truncates a container', () => {
    const parsed = parseDebugValue('std::vector of length 1000, capacity 1024 = {1, 2, ...}')
    expect(parsed.summary).toBe('容器 · 1000 项')
    expect(parsed.children[2].value).toBe('...')
  })
})
