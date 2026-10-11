import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRenderer, h, nextTick, reactive } from 'vue'
import * as Vue from 'vue'
import { readFileSync } from 'node:fs'
import { parse, compileScript } from '@vue/compiler-sfc'
import { compile } from '@vue/compiler-dom'

const native = vi.hoisted(() => ({ invoke: vi.fn(), terminals: [] as any[], nextId: 0 }))
vi.mock('@tauri-apps/api/core', () => ({ invoke: native.invoke, Channel: class { onmessage: any } }))
vi.mock('@xterm/xterm', () => ({ Terminal: class {
  options = {}; cols = 80; rows = 24
  write = vi.fn(); writeln = vi.fn(); dispose = vi.fn(); focus = vi.fn(); scrollToBottom = vi.fn()
  constructor() { native.terminals.push(this) }
  loadAddon() {} open() {} onData() {} onKey() { return { dispose() {} } }
} }))
vi.mock('@xterm/addon-fit', () => ({ FitAddon: class { fit() {} } }))
vi.mock('../stores/problemStore', () => ({ useProblemStore: () => ({ draftPath: 'F:/test.cpp' }) }))
vi.mock('../stores/workbenchStore', () => ({ useWorkbenchStore: () => ({ terminalRequest: { sequence: 0 } }) }))
import TerminalPanel from './TerminalPanel.vue'

// Vitest's Node transform generates an SSR template. Compile the same template
// for the custom client renderer so clicks and template refs run as in the app.
const { descriptor } = parse(readFileSync(new URL('./TerminalPanel.vue', import.meta.url), 'utf8'))
const { bindings } = compileScript(descriptor, { id: 'terminal-test' })
TerminalPanel.render = new Function('Vue', compile(descriptor.template!.content, {
  mode: 'function', prefixIdentifiers: true, bindingMetadata: bindings,
}).code)(Vue)

// Mount the actual component with Vue's renderer; no native window is required.
class Node extends EventTarget {
  children: Node[] = []; parent: Node | null = null; props: Record<string, any> = {}
  style: Record<string, any> = {}; clientWidth = 800; clientHeight = 200; text = ''
  constructor(readonly tag: string) { super() }
  setAttribute() {} removeAttribute() {}
}
const actions = new Node('actions')
const renderer = createRenderer<Node, Node>({
  createElement: tag => new Node(tag), createText: text => Object.assign(new Node('#text'), { text }),
  createComment: text => Object.assign(new Node('#comment'), { text }),
  setText: (node, text) => { node.text = text }, setElementText: (node, text) => { node.text = text },
  patchProp: (node, key, _old, value) => { node.props[key] = value },
  insert: (node, parent, anchor) => {
    if (node.parent) {
      const oldIndex = node.parent.children.indexOf(node)
      if (oldIndex >= 0) node.parent.children.splice(oldIndex, 1)
    }
    node.parent = parent
    const index = anchor ? parent.children.indexOf(anchor) : -1
    parent.children.splice(index < 0 ? parent.children.length : index, 0, node)
  },
  remove: node => { node.parent?.children.splice(node.parent.children.indexOf(node), 1); node.parent = null },
  parentNode: node => node.parent,
  nextSibling: node => node.parent?.children[node.parent.children.indexOf(node) + 1] ?? null,
  querySelector: () => actions,
})
function find(node: Node, label: string): Node | undefined {
  if (node.props['aria-label'] === label) return node
  for (const child of node.children) { const match = find(child, label); if (match) return match }
}
async function settle() {
  for (let i = 0; i < 12; i++) { await nextTick(); await vi.advanceTimersByTimeAsync(50) }
}
let unmount: (() => void) | undefined
function mount() {
  const props = reactive({ visible: true, diagnostics: [] as { id: number; title: string; message: string }[] })
  const delivered = vi.fn((id: number) => { props.diagnostics = props.diagnostics.filter(item => item.id !== id) })
  const app = renderer.createApp({ render: () => h(TerminalPanel, { ...props, onDiagnosticDelivered: delivered }) })
  app.provide(Vue.ssrContextKey, {})
  app.mount(new Node('root')); unmount = () => app.unmount()
  return { props, delivered }
}
function fail(props: ReturnType<typeof mount>['props'], id: number) {
  props.diagnostics = [{ id, title: '编译问题', message: `error ${id}` }]
}
describe('CPH terminal deletion', () => {
  beforeEach(() => {
    vi.useFakeTimers(); native.invoke.mockReset(); native.terminals.length = 0; native.nextId = 0
    actions.children = []
    vi.stubGlobal('HTMLElement', Node)
    vi.stubGlobal('window', globalThis)
    vi.stubGlobal('navigator', { userAgent: 'Windows' })
    vi.stubGlobal('document', { documentElement: new Node('html'), body: { classList: { remove() {} } } })
    vi.stubGlobal('getComputedStyle', () => ({ getPropertyValue: () => '' }))
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
    vi.stubGlobal('MutationObserver', class { observe() {} disconnect() {} })
    native.invoke.mockImplementation(async (command, args) => {
      if (command === 'start_terminal') {
        args.output.onmessage({ data: Array.from(new TextEncoder().encode('PS F:/ > ')), exited: false })
        return { id: ++native.nextId, directory: 'F:/' }
      }
    })
  })
  afterEach(() => { unmount?.(); unmount = undefined; vi.useRealTimers(); vi.unstubAllGlobals() })
  it('creates a new terminal after the previous diagnostic terminal is deleted', async () => {
    const { props, delivered } = mount()
    await settle(); fail(props, 1); await settle()
    const firstId = native.invoke.mock.calls.find(([cmd]) => cmd === 'print_terminal_diagnostic')![1].id
    find(actions, '终止并删除终端')!.props.onClick()
    await settle(); fail(props, 2); await settle()
    const prints = native.invoke.mock.calls.filter(([cmd]) => cmd === 'print_terminal_diagnostic')
    expect(prints).toHaveLength(2)
    expect(prints[1]![1]).toMatchObject({ id: firstId + 1, text: '\r\nerror 2\r\n' })
    expect(delivered.mock.calls).toEqual([[1], [2]])
  })
  it('recovers when the diagnostic terminal is deleted while delivery waits for its prompt', async () => {
    const { props, delivered } = mount()
    await settle(); fail(props, 1); await settle()
    // A shell output burst keeps the next diagnostic waiting for an idle prompt.
    const starts = native.invoke.mock.calls.filter(([cmd]) => cmd === 'start_terminal')
    starts.slice(-1)[0]![1].output.onmessage({ data: [32], exited: false })
    fail(props, 2); await nextTick(); await nextTick(); await Promise.resolve()
    find(actions, '终止并删除终端')!.props.onClick()
    await settle()
    expect(delivered.mock.calls).toEqual([[1], [2]])
    expect(native.invoke.mock.calls.filter(([cmd]) => cmd === 'print_terminal_diagnostic').slice(-1)[0]![1].text)
      .toBe('\r\nerror 2\r\n')
  })
  it('replaces a closed backend session even before the channel exit event arrives', async () => {
    const { props, delivered } = mount()
    await settle(); fail(props, 1); await settle()
    native.invoke.mockImplementationOnce(async () => { throw '终端已结束' })
    fail(props, 2); await settle()
    const prints = native.invoke.mock.calls.filter(([cmd]) => cmd === 'print_terminal_diagnostic')
    expect(prints).toHaveLength(3)
    expect(prints[2]![1].id).not.toBe(prints[1]![1].id)
    expect(delivered.mock.calls).toEqual([[1], [2]])
  })
  it('does not create terminals indefinitely after a startup failure, and allows the next run', async () => {
    const { props, delivered } = mount()
    await settle(); fail(props, 1); await settle()
    find(actions, '终止并删除终端')!.props.onClick()
    await settle()
    native.invoke.mockImplementationOnce(async () => { throw '无法启动 PowerShell' })
    fail(props, 2); await settle()
    const failedCount = native.terminals.length
    await settle()
    expect(native.terminals.length).toBe(failedCount)
    expect(delivered.mock.calls).toEqual([[1]])
    fail(props, 3); await settle()
    expect(delivered.mock.calls).toEqual([[1], [3]])
    expect(native.invoke.mock.calls.filter(([cmd]) => cmd === 'print_terminal_diagnostic').slice(-1)[0]![1].text)
      .toBe('\r\nerror 3\r\n')
  })
  it('does not replay a pending error after a newer run clears it during deletion', async () => {
    const { props, delivered } = mount()
    await settle(); fail(props, 1); await settle()
    native.invoke.mock.calls.filter(([cmd]) => cmd === 'start_terminal').slice(-1)[0]![1].output
      .onmessage({ data: [32], exited: false })
    fail(props, 2); await nextTick(); await nextTick(); await Promise.resolve()
    find(actions, '终止并删除终端')!.props.onClick()
    props.diagnostics = []
    await settle(); fail(props, 3); await settle()
    expect(native.invoke.mock.calls.filter(([cmd]) => cmd === 'print_terminal_diagnostic').map(([, args]) => args.text))
      .toEqual(['\r\nerror 1\r\n', '\r\nerror 3\r\n'])
    expect(delivered).toHaveBeenLastCalledWith(3)
  })
})
