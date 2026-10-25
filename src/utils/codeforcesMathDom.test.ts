// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { removeMathJaxRenderedCopies } from './codeforcesMath'

function clean(html: string) {
  const doc = new DOMParser().parseFromString(`<div id="root">${html}</div>`, 'text/html')
  const root = doc.getElementById('root')!
  removeMathJaxRenderedCopies(root)
  return root
}

describe('cached MathJax output', () => {
  it('removes the HTML math copy but retains its source and surrounding text', () => {
    const root = clean('from <span class="MathJax_Preview">1</span><span class="MathJax" id="MathJax-Element-1-Frame">1</span><script type="math/tex" id="MathJax-Element-1">1</script> to <b>n documents</b>')
    expect(root.querySelector('.MathJax')).toBeNull()
    expect(root.querySelector('.MathJax_Preview')).toBeNull()
    expect(root.querySelector('script')?.textContent).toBe('1')
    expect(root.querySelector('b')?.textContent).toBe('n documents')
    expect(root.textContent).toBe('from 1 to n documents')
  })

  it.each(['MathJax_Display', 'MathJax_SVG_Display'])('removes a %s wrapper without dropping the display source', className => {
    const root = clean(`<div class="${className}"><span class="MathJax">x</span></div><script type="math/tex; mode=display">x</script>`)
    expect(root.children).toHaveLength(1)
    expect(root.firstElementChild?.tagName).toBe('SCRIPT')
  })

  it('uses source IDs if another element separates the output and source', () => {
    const root = clean('<span class="MathJax" id="MathJax-Element-2-Frame">n</span><b>note</b><script id="MathJax-Element-2" type="math/tex">n</script>')
    expect(root.querySelector('.MathJax')).toBeNull()
    expect(root.querySelector('b')?.textContent).toBe('note')
  })

  it('retains rendered-only math and ordinary numeric text', () => {
    const root = clean('1 <span class="MathJax">n</span><span class="katex">i</span>')
    expect(root.textContent).toBe('1 ni')
    expect(root.querySelector('.MathJax')).not.toBeNull()
    expect(root.querySelector('.katex')).not.toBeNull()
  })
})
