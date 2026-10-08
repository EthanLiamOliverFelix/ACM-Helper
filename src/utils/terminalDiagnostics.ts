import type { RunDiagnostic } from './runDiagnostics'

export interface PendingDiagnostic extends RunDiagnostic { id: number }

/** Keep events until delivery finishes; component loading must not erase them. */
export function createDiagnosticDelivery(deliver: (item: PendingDiagnostic) => Promise<void>, acknowledge: (id: number) => void, onError: (error: unknown) => void) {
  const pending = new Set<number>()
  let queue = Promise.resolve()
  return (items: readonly PendingDiagnostic[]) => {
    for (const item of items) {
      if (pending.has(item.id)) continue
      pending.add(item.id)
      queue = queue.then(async () => {
        try {
          await deliver(item)
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
  return `\r\n\x1b[33m[CPH · ${item.title}]\x1b[0m\r\n${message.replace(/\r?\n/g, '\r\n')}\r\n\r\n\x1b[90m[本次 CPH 运行已结束；终端可继续输入命令]\x1b[0m\r\n`
}
