export interface NoteImageLayout {
  id: string
  x: number
  y: number
  width: number
}

const REFERENCE_RE = /acm-note-image:\/\/([A-Za-z0-9._-]+)(?:#x=(-?\d+),y=(-?\d+),w=(\d+))?/g

function clampInteger(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, Math.round(value)))
}

export function resizeNoteImageWidth(width: number, deltaX: number, availableWidth: number) {
  return clampInteger(width + deltaX, 80, Math.max(80, Math.min(2_000, availableWidth)))
}

export function extractNoteImageLayouts(markdown: string): NoteImageLayout[] {
  const layouts: NoteImageLayout[] = []
  const seen = new Set<string>()
  for (const match of markdown.matchAll(REFERENCE_RE)) {
    const id = match[1]
    if (seen.has(id)) continue
    seen.add(id)
    layouts.push({
      id,
      x: clampInteger(Number(match[2] ?? 24), 0, 100_000),
      y: clampInteger(Number(match[3] ?? 24), 0, 100_000),
      width: clampInteger(Number(match[4] ?? 360), 80, 2_000),
    })
  }
  return layouts
}

export function createNoteImageMarkdown(id: string, alt: string, index: number): string {
  const safeAlt = alt.replace(/[\[\]\r\n]/g, ' ').trim() || '笔记图片'
  const y = 24 + Math.max(0, index) * 240
  return `![${safeAlt}](acm-note-image://${id}#x=24,y=${y},w=360)`
}

export function updateNoteImageLayout(markdown: string, id: string, x: number, y: number, width: number): string {
  const next = `acm-note-image://${id}#x=${clampInteger(x, 0, 100_000)},y=${clampInteger(y, 0, 100_000)},w=${clampInteger(width, 80, 2_000)}`
  return markdown.replace(REFERENCE_RE, (reference, currentId) => currentId === id ? next : reference)
}

export function replaceNoteImageSources(html: string, sources: Readonly<Record<string, string>>): string {
  return html.replace(/<img\s+([^>]*?)src="acm-note-image:\/\/([A-Za-z0-9._-]+)(?:#x=(-?\d+),y=(-?\d+),w=(\d+))?"([^>]*)>/g,
    (tag, before, id, rawX, rawY, rawWidth, after) => {
      const source = sources[id]
      if (!source) return tag
      const x = clampInteger(Number(rawX ?? 24), 0, 100_000)
      const y = clampInteger(Number(rawY ?? 24), 0, 100_000)
      const width = clampInteger(Number(rawWidth ?? 360), 80, 2_000)
      return `<img ${before}src="${source}" data-note-image-id="${id}" data-note-x="${x}" data-note-y="${y}" data-note-width="${width}" draggable="false" style="position:absolute;left:${x}px;top:${y}px;width:${width}px;max-width:calc(100% - ${x}px)"${after}>`
    })
}
