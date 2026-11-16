// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, nextTick } from 'vue'
import DebugPanel from './DebugPanel.vue'

vi.mock('../stores/problemStore', () => ({ useProblemStore: () => ({
  currentLanguage: 'cpp', currentCode: 'int main() {}', debugInput: '',
  watchExpressions: ['trees'],
  debugSession: { active: true, variables: [{ name: 'dp', value: 'std::vector of length 1, capacity 1 = {9}' }], watches: [{ name: 'trees', value: 'std::vector of length 1, capacity 1 = {{tt = std::vector of length 1, capacity 1 = {std::vector of length 2, capacity 2 = {3, 4}}}}' }] },
}) }))

const cleanups: (() => void)[] = []
afterEach(() => { cleanups.splice(0).forEach(clean => clean()) })
function mount() {
  const host = document.createElement('div')
  document.body.append(host)
  const app = createApp(DebugPanel)
  app.mount(host)
  cleanups.push(() => { app.unmount(); host.remove() })
  return host
}
async function click(element: Element | null) {
  expect(element).not.toBeNull()
  ;(element as HTMLElement).click()
  await nextTick()
}

describe('debug variable panel', () => {
  it('expands every layer including single-member structs and local containers', async () => {
    const host = mount()
    for (const name of ['trees', '[0]', 'tt', '[0]']) {
      await click(host.querySelector(`#debug-watches button[aria-label="展开 ${name}"]`))
    }
    expect(host.querySelector('#debug-watches')?.textContent).toContain('[0]3')
    expect(host.querySelector('#debug-watches')?.textContent).toContain('[1]4')
    await click(host.querySelector('#debug-locals button[aria-label="展开 dp"]'))
    expect(host.querySelector('#debug-locals')?.textContent).toContain('[0]9')
  })

  it('collapses sections independently and preserves expansion when reopened', async () => {
    const host = mount()
    await click(host.querySelector('#debug-locals button[aria-label="展开 dp"]'))
    const watches = host.querySelector('button[aria-controls="debug-watches"]')!
    const locals = host.querySelector('button[aria-controls="debug-locals"]')!
    await click(locals)
    expect((host.querySelector('#debug-locals') as HTMLElement).style.display).toBe('none')
    expect(watches.getAttribute('aria-expanded')).toBe('true')
    await click(watches)
    expect((host.querySelector('#debug-watches') as HTMLElement).style.display).toBe('none')
    await click(locals)
    expect(locals.getAttribute('aria-expanded')).toBe('true')
    expect(host.querySelector('#debug-locals')?.textContent).toContain('[0]9')
  })
})
