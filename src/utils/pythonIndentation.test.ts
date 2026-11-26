import { describe, expect, it } from 'vitest'
import { pythonBlockIndentPattern } from './pythonIndentation'

describe('Python block indentation', () => {
  it.each([
    '            if(x & (1<<i)):',
    '    if (ready):  # start the block',
    'else:',
    'async def solve():',
    '    if value == "#:":',
    '    ):  # end a multiline header',
  ])('indents after %s', line => {
    expect(pythonBlockIndentPattern.test(line)).toBe(true)
  })

  it.each([
    '    # if ready:',
    '    if ready  # missing colon:',
    '    if ready: pass',
    '    value = {"key": 1}',
    '    text = "if ready:"',
    '    if_ready: int',
  ])('keeps the indentation after %s', line => {
    expect(pythonBlockIndentPattern.test(line)).toBe(false)
  })
})
