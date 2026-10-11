import type { RunDiagnostic } from './runDiagnostics'
import type { Terminal } from '@xterm/xterm'

export interface PendingDiagnostic extends RunDiagnostic { id: number }

/** onData includes automatic replies; only browser input events mark user activity. */
export function trackTerminalUserInput(terminal: Pick<Terminal, 'onKey'>, host: EventTarget, onInput: () => void): () => void {
  const keyboard = terminal.onKey(onInput)
  const options = { capture: true }
  host.addEventListener('paste', onInput, options)
  host.addEventListener('input', onInput, options)
  return () => {
    keyboard.dispose()
    host.removeEventListener('paste', onInput, options)
    host.removeEventListener('input', onInput, options)
  }
}

/** Keep events until delivery finishes; component loading must not erase them. */
export function createDiagnosticDelivery(deliver: (item: PendingDiagnostic, isCurrent: () => boolean) => Promise<void>, acknowledge: (id: number) => void, onError: (error: unknown) => void) {
  const pending = new Set<number>()
  let current = new Set<number>()
  let queue = Promise.resolve()
  return (items: readonly PendingDiagnostic[]) => {
    current = new Set(items.map(item => item.id))
    for (const item of items) {
      if (pending.has(item.id)) continue
      pending.add(item.id)
      queue = queue.then(async () => {
        try {
          const isCurrent = () => current.has(item.id)
          if (isCurrent()) await deliver(item, isCurrent)
          acknowledge(item.id)
        } catch (error) {
          pending.delete(item.id)
          onError(error)
        }
      })
    }
    return queue
  }
}

export function diagnosticText(item: RunDiagnostic) {
  // Compiler output is text, not terminal control sequences (e.g. clear screen).
  const message = item.message.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '')
  return `\r\n${message.replace(/\r?\n/g, '\r\n')}\r\n`
}
