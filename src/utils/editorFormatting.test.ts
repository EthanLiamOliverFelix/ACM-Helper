import { describe, expect, it, vi } from 'vitest'
import { registerCodeFormatters } from './editorFormatting'
const mocks = vi.hoisted(() => ({ format: vi.fn() }))
vi.mock('./codeFormatter', () => ({ formatCode: mocks.format }))
function setup() {
  const providers: any[] = []
  const monaco = { languages: { registerDocumentFormattingEditProvider: vi.fn((_language, provider) => providers.push(provider)) } }
  const state = { isFormatting: false, formatError: '' }
  registerCodeFormatters(monaco, state)
  const model = { getValue: () => 'int main(){}', getVersionId: () => 1, isDisposed: () => false, getFullModelRange: () => 'range' }
  return { monaco, providers, state, model }
}
describe('editor formatting lifecycle', () => {
  it('keeps exactly one provider per language after reopening groups', () => {
    const { monaco, state } = setup()
    for (let index = 0; index < 10; index++) registerCodeFormatters(monaco, state)
    expect(monaco.languages.registerDocumentFormattingEditProvider).toHaveBeenCalledTimes(3)
  })
  it('clears busy state after failure and permits another save to format', async () => {
    const { providers, state, model } = setup()
    mocks.format.mockRejectedValueOnce(new Error('temporary failure')).mockResolvedValueOnce('formatted')
    expect(await providers[0].provideDocumentFormattingEdits(model, {}, {})).toEqual([])
    expect(state.isFormatting).toBe(false)
    expect(await providers[0].provideDocumentFormattingEdits(model, {}, {})).toEqual([{ range: 'range', text: 'formatted' }])
    expect(state.formatError).toBe('')
  })
  it('does not replace text edited while the formatter was loading', async () => {
    const { providers, state, model } = setup()
    let resolve!: (value: string) => void
    mocks.format.mockImplementationOnce(() => new Promise<string>(done => { resolve = done }))
    const formatting = providers[0].provideDocumentFormattingEdits(model, {}, {})
    model.getVersionId = () => 2
    resolve('outdated formatted text')
    expect(await formatting).toEqual([])
    expect(state.isFormatting).toBe(false)
  })
})
