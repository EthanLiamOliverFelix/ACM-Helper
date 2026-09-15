import { describe, expect, it } from 'vitest'
import { createNoteImageMarkdown, extractNoteImageLayouts, replaceNoteImageSources, updateNoteImageLayout } from './noteImages'
import { renderLuoguMarkdown } from './luoguMarkdown'

describe('note image references', () => {
  it('creates portable references with initial canvas positions', () => {
    expect(createNoteImageMarkdown('123-photo.png', 'photo.png', 2)).toBe('![photo.png](acm-note-image://123-photo.png#x=24,y=504,w=360)')
  })

  it('updates only the selected image layout', () => {
    const markdown = `${createNoteImageMarkdown('a.png', 'A', 0)}\n${createNoteImageMarkdown('b.png', 'B', 1)}`
    const updated = updateNoteImageLayout(markdown, 'a.png', 81.6, -5, 420)
    expect(updated).toContain('a.png#x=82,y=0,w=420')
    expect(updated).toContain('b.png#x=24,y=264,w=360')
  })

  it('extracts layouts and replaces only known assets with safe data sources', () => {
    const markdown = createNoteImageMarkdown('a.png', 'A', 0)
    expect(extractNoteImageLayouts(markdown)).toEqual([{ id: 'a.png', x: 24, y: 24, width: 360 }])
    const html = '<p><img src="acm-note-image://a.png#x=24,y=24,w=360" alt="A"></p>'
    const replaced = replaceNoteImageSources(html, { 'a.png': 'data:image/png;base64,AAAA' })
    expect(replaced).toContain('data-note-image-id="a.png"')
    expect(replaced).toContain('left:24px;top:24px;width:360px')
  })

  it('survives the application Markdown renderer', () => {
    const markdown = createNoteImageMarkdown('a.png', 'A', 0)
    const html = replaceNoteImageSources(renderLuoguMarkdown(markdown), { 'a.png': 'data:image/png;base64,AAAA' })
    expect(html).toContain('data-note-image-id="a.png"')
  })
})
