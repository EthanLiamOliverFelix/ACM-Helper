const HTML_ENTITIES: Record<string, string> = {
  amp: '&',
  apos: "'",
  gt: '>',
  lt: '<',
  nbsp: ' ',
  quot: '"',
}

function decodeHtmlEntities(value: string) {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
    if (entity[0] === '#') {
      const hexadecimal = entity[1]?.toLowerCase() === 'x'
      const codePoint = Number.parseInt(entity.slice(hexadecimal ? 2 : 1), hexadecimal ? 16 : 10)
      return Number.isFinite(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff
        ? String.fromCodePoint(codePoint)
        : match
    }
    return HTML_ENTITIES[entity.toLowerCase()] ?? match
  })
}

/** Convert the markup inside AtCoder's <var> elements into KaTeX input. */
export function atCoderVarMarkupToTex(markup: string) {
  const withScripts = markup
    .replace(/<sub\b[^>]*>([\s\S]*?)<\/sub>/gi, '_{$1}')
    .replace(/<sup\b[^>]*>([\s\S]*?)<\/sup>/gi, '^{$1}')
  return decodeHtmlEntities(withScripts.replace(/<[^>]+>/g, '')).trim()
}
