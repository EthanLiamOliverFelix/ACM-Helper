/** Normalize common whole-document wrappers and LaTeX delimiters returned by LLMs. */
export function normalizeAiMarkdown(value: string) {
  let markdown = value.trim()
  const fenced = markdown.match(/^```(?:markdown|md)?\s*\r?\n([\s\S]*?)\r?\n```\s*$/i)
  if (fenced) markdown = fenced[1]
  return markdown
    .replace(/\$\$\$([\s\S]*?)\$\$\$/g, (_, formula: string) => `$${formula}$`)
    .replace(/\\\[([\s\S]*?)\\\]/g, (_, formula: string) => `$$${formula}$$`)
    .replace(/\\\(([^\n]*?)\\\)/g, (_, formula: string) => `$${formula}$`)
}
