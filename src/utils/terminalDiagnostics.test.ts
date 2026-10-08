import { describe, expect, it, vi } from 'vitest'
import { createDiagnosticDelivery, diagnosticText } from './terminalDiagnostics'
describe('terminal diagnostic delivery', () => {
  it('retains an error while startup waits and later props clear', async () => {
    let ready!: () => void
    const startup = new Promise<void>(resolve => { ready = resolve })
    const written: string[] = []
    const acknowledge = vi.fn()
    const deliver = createDiagnosticDelivery(async item => { await startup; written.push(item.message) }, acknowledge, vi.fn())
    const item = { id: 1, title: '编译问题', message: 'missing semicolon' }
    const pending = deliver([item])
    deliver([])
    deliver([item])
    expect(acknowledge).not.toHaveBeenCalled()
    ready()
    await pending
    expect(written).toEqual(['missing semicolon'])
    expect(acknowledge).toHaveBeenCalledExactlyOnceWith(1)
  })
  it('delivers successive runs in order and retries failed delivery', async () => {
    const write = vi.fn().mockRejectedValueOnce(new Error('terminal closed')).mockResolvedValue(undefined)
    const acknowledge = vi.fn()
    const error = vi.fn()
    const deliver = createDiagnosticDelivery(write, acknowledge, error)
    const first = { id: 1, title: '编译问题', message: 'error one' }
    const second = { id: 2, title: '编译问题', message: 'error two' }
    await deliver([first])
    expect(acknowledge).not.toHaveBeenCalled()
    await deliver([first, second])
    expect(acknowledge.mock.calls).toEqual([[1], [2]])
    expect(error).toHaveBeenCalledTimes(1)
  })
  it('renders compiler text without allowing screen clearing escapes', () => {
    expect(diagnosticText({ title: '编译问题', message: '\x1b[2Jerror\nnext' })).toContain('error\r\nnext')
    expect(diagnosticText({ title: '编译问题', message: '\x1b[2Jerror' })).not.toContain('\x1b[2J')
  })
})
