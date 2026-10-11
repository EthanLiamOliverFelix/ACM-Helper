import { describe, expect, it, vi } from 'vitest'
import { createDiagnosticDelivery, diagnosticText, trackTerminalUserInput } from './terminalDiagnostics'
describe('terminal diagnostic delivery', () => {
  it('ignores automatic startup replies but tracks keyboard, paste and IME input', () => {
    let key!: () => void
    const keyboardDispose = vi.fn()
    const host = new EventTarget()
    const inputUsed = vi.fn()
    const source: Parameters<typeof trackTerminalUserInput>[0] = {
      onKey: handler => {
        key = () => handler({ key: 'x', domEvent: new Event('keydown') as KeyboardEvent })
        return { dispose: keyboardDispose }
      },
    }
    const cleanup = trackTerminalUserInput(source, host, inputUsed)
    const send = vi.fn()
    // onData carries many reply formats, including OSC colors not covered by CSI regexes.
    for (const reply of ['\x1b[1;1R', '\x1b[?1;2c', '\x1b]10;rgb:ffff/ffff/ffff\x1b\\', '\x1b[?25;1$y']) {
      send(reply)
    }
    expect(inputUsed).not.toHaveBeenCalled()
    key()
    host.dispatchEvent(new Event('paste'))
    host.dispatchEvent(new Event('input'))
    expect(inputUsed).toHaveBeenCalledTimes(3)
    cleanup()
    expect(keyboardDispose).toHaveBeenCalledOnce()
    host.dispatchEvent(new Event('paste'))
    expect(inputUsed).toHaveBeenCalledTimes(3)
  })
  it('retains the current error while startup waits', async () => {
    let ready!: () => void
    const startup = new Promise<void>(resolve => { ready = resolve })
    const written: string[] = []
    const acknowledge = vi.fn()
    const deliver = createDiagnosticDelivery(async item => { await startup; written.push(item.message) }, acknowledge, vi.fn())
    const item = { id: 1, title: '编译问题', message: 'missing semicolon' }
    const pending = deliver([item])
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
  it('cancels a previous round still waiting for terminal startup', async () => {
    let ready!: () => void
    const startup = new Promise<void>(resolve => { ready = resolve })
    const written: string[] = []
    const deliver = createDiagnosticDelivery(async (item, isCurrent) => {
      await startup
      if (isCurrent()) written.push(item.message)
    }, vi.fn(), vi.fn())
    const old = deliver([{ id: 1, title: '第 1 轮', message: 'old error' }])
    await Promise.resolve()
    const latest = deliver([{ id: 2, title: '第 2 轮', message: 'new error' }])
    ready()
    await old
    await latest
    expect(written).toEqual(['new error'])
  })
  it('discards queued errors when another run starts without an error result yet', async () => {
    const write = vi.fn(async () => {})
    const deliver = createDiagnosticDelivery(write, vi.fn(), vi.fn())
    const pending = deliver([{ id: 1, title: 'previous', message: 'old error' }])
    deliver([])
    await pending
    expect(write).not.toHaveBeenCalled()
  })
  it('renders compiler text without allowing screen clearing escapes', () => {
    expect(diagnosticText({ title: '编译问题', message: '\x1b[2Jerror\nnext' })).toContain('error\r\nnext')
    expect(diagnosticText({ title: '编译问题', message: '\x1b[2Jerror' })).not.toContain('\x1b[2J')
  })
  it('prints only the compiler message without round or completion notices', () => {
    expect(diagnosticText({ title: '第 15 轮 · 编译问题', message: 'expected semicolon\nsource.cpp:35' }))
      .toBe('\r\nexpected semicolon\r\nsource.cpp:35\r\n')
  })
})
