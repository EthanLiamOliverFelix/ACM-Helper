import { reactive, watchEffect } from 'vue'
import { describe, expect, it } from 'vitest'
import type { AiMessage } from '../types'
import { appendAiStreamingMessage } from './aiStore'

describe('AI streaming messages', () => {
  it('returns the reactive message stored in the chat', () => {
    const messages = reactive<AiMessage[]>([])
    const message = appendAiStreamingMessage(messages, 1)
    let rendered = ''
    watchEffect(() => { rendered = messages[0]?.content ?? '' }, { flush: 'sync' })

    message.content += '第一段'
    expect(rendered).toBe('第一段')
    message.content += '第二段'
    expect(rendered).toBe('第一段第二段')
  })
})
