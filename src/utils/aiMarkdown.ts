import { atCoderVarMarkupToTex } from './atcoderMath'

/** Normalize common whole-document wrappers and LaTeX delimiters returned by LLMs. */
export function normalizeAiMarkdown(value: string) {
  let markdown = value.trim()
  const fenced = markdown.match(/^```(?:markdown|md)?\s*\r?\n([\s\S]*?)\r?\n```\s*$/i)
  if (fenced) markdown = fenced[1]
  return markdown.split(/(```[\s\S]*?```|`[^`\n]*`)/g).map((part, index) => index % 2 ? part : part
    .replace(/<var\b[^>]*>([\s\S]*?)<\/var>/gi, (_, formula: string) => `$${atCoderVarMarkupToTex(formula)}$`)
    .replace(/\${3,}([\s\S]*?)\${3,}/g, (_, formula: string) => `$${formula}$`)
    .replace(/\\\[([\s\S]*?)\\\]/g, (_, formula: string) => `$$${formula}$$`)
    .replace(/\\\(([^\n]*?)\\\)/g, (_, formula: string) => `$${formula}$`)).join('')
}

/** Reject heading-only/empty replies without discarding the previous translation. */
export function hasTranslationBody(value: string) {
  const body = value.replace(/^\s*#{1,6}[^\n]*$/gm, '').replace(/<[^>]*>/g, '').replace(/\s/g, '')
  return body.length >= 40
}
