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
  text = ''; prompt = 'PS F:/ > '
  buffer = { active: { baseY: 0, cursorY: 0, getLine: () => ({ translateToString: () => this.prompt }) } }
  clear = vi.fn(() => { this.text = '' })
  write = vi.fn((data: string | Uint8Array, callback?: () => void) => { this.text += typeof data === 'string' ? data : new TextDecoder().decode(data); callback?.() })
  writeln = vi.fn(); dispose = vi.fn(); focus = vi.fn(); scrollToBottom = vi.fn()
  constructor() { native.terminals.push(this) }
  keyHandler?: () => void
  loadAddon() {} open() {} onData() {} onKey(handler: () => void) { this.keyHandler = handler; return { dispose() {} } }
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
  const root = new Node('root')
  app.mount(root); unmount = () => app.unmount()
  return { props, delivered, root }
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
  it('uses the current tab for successive CPH errors without shell printing commands', async () => {
    const { props, delivered, root } = mount()
    await settle(); fail(props, 1); await settle()
    expect(native.terminals[0].text).toContain('error 1')
    fail(props, 2); await settle()
    expect(native.terminals[0].text).toContain('error 2')
    expect(native.terminals[0].text.match(/error 1/g)).toHaveLength(1)
    expect(find(root, 'CPH 编译报错')).toBeUndefined()
    expect(native.terminals).toHaveLength(1)
    expect(native.invoke.mock.calls.some(([command]) => command === 'print_terminal_diagnostic' || command === 'write_terminal')).toBe(false)
    expect(delivered.mock.calls).toEqual([[1], [2]])
  })
  it('does not resurrect cleared errors when the shell redraws or another CPH run fails', async () => {
    const { props, root } = mount()
    await settle(); fail(props, 1); await settle()
    find(actions, '清屏')!.props.onClick(); await settle()
    expect(native.terminals[0].clear).toHaveBeenCalledOnce()
    expect(find(root, 'CPH 编译报错')).toBeUndefined()
    expect(native.terminals[0].text).not.toContain('error 1')
    const channel = native.invoke.mock.calls.find(([command]) => command === 'start_terminal')![1].output
    channel.onmessage({ data: Array.from(new TextEncoder().encode('PS F:/ > ')), exited: false })
    // Even re-delivering an acknowledged result cannot bring it back.
    fail(props, 1); await settle()
    expect(find(root, 'CPH 编译报错')).toBeUndefined()
    fail(props, 2); await settle()
    expect(native.terminals[0].text).toContain('error 2')
    expect(native.terminals[0].text).not.toContain('error 1')
    expect(native.terminals).toHaveLength(1)
  })
  it('creates one replacement if the user deleted the current terminal', async () => {
    const { props, delivered } = mount()
    await settle(); fail(props, 1); await settle()
    find(actions, '终止并删除终端')!.props.onClick(); await settle()
    fail(props, 2); await settle()
    expect(native.terminals[1].text).toContain('error 2')
    expect(native.terminals).toHaveLength(2)
    expect(delivered.mock.calls).toEqual([[1], [2]])
  })
  it('preserves a user input line and prompt while displaying compiler errors in the current tab', async () => {
    const { props, root } = mount()
    await settle()
    const terminal = native.terminals[0]
    terminal.prompt = 'PS F:/ > partially typed command'
    terminal.keyHandler()
    fail(props, 1); await settle()
    expect(terminal.text).toContain('error 1')
    expect(terminal.text).toMatch(/error 1\r\nPS F:\/ > partially typed command$/)
    expect(find(root, 'CPH 编译报错')).toBeUndefined()
    expect(native.terminals).toHaveLength(1)
    expect(native.invoke.mock.calls.some(([command]) => command === 'write_terminal')).toBe(false)
  })
  it('shows errors without disturbing a shell that has exited or is running a command', async () => {
    const { props } = mount()
    await settle()
    const channel = native.invoke.mock.calls.find(([command]) => command === 'start_terminal')![1].output
    channel.onmessage({ data: [65], exited: true })
    fail(props, 1); await settle()
    expect(native.terminals[0].text).toContain('error 1')
    expect(native.terminals).toHaveLength(1)
    expect(native.invoke.mock.calls.some(([command]) => command === 'write_terminal')).toBe(false)
  })
  it('discards an error cleared while the initial terminal is still starting', async () => {
    let ready!: (value: { id: number; directory: string }) => void
    native.invoke.mockImplementationOnce(() => new Promise(resolve => { ready = resolve }))
    const { props, root } = mount()
    await nextTick(); await nextTick()
    fail(props, 1); await nextTick(); await nextTick()
    find(actions, '清屏')!.props.onClick()
    ready({ id: 1, directory: 'F:/' }); await settle()
    expect(find(root, 'CPH 编译报错')).toBeUndefined()
    fail(props, 2); await settle()
    expect(native.terminals[0].text).toContain('error 2')
    expect(native.terminals).toHaveLength(1)
  })
  it('cancels queued xterm writes on clear and still prints the next run', async () => {
    const { props } = mount()
    await settle()
    const terminal = native.terminals[0]
    const callbacks: (() => void)[] = []
    terminal.write.mockImplementationOnce((_data: unknown, callback: () => void) => { callbacks.push(callback) })
    fail(props, 1); await nextTick(); await nextTick(); await Promise.resolve(); await nextTick()
    find(actions, '清屏')!.props.onClick()
    for (const callback of callbacks) callback()
    await settle(); fail(props, 2); await settle()
    expect(terminal.text).not.toContain('error 1')
    expect(terminal.text).toContain('error 2')
  })
  it('does not block later errors if the tab is disposed before xterm finishes a write', async () => {
    const { props } = mount()
    await settle()
    const terminal = native.terminals[0]
    terminal.write.mockImplementationOnce(() => {})
    fail(props, 1); await nextTick(); await nextTick(); await Promise.resolve(); await nextTick()
    find(actions, '终止并删除终端')!.props.onClick()
    await settle(); fail(props, 2); await settle()
    expect(native.terminals[1].text).toContain('error 2')
    expect(native.terminals).toHaveLength(2)
  })
})
