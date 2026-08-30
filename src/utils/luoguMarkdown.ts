import getLuoguProcessor from 'lg-markdown-processor'
import rehypeStringify from 'rehype-stringify'
import remarkDirective from 'remark-directive'

type Node = {
  type: string
  name?: string
  attributes?: Record<string, string>
  data?: Record<string, unknown>
  children?: Node[]
  value?: string
  tagName?: string
  properties?: Record<string, unknown>
}

const calloutTitles: Record<string, string> = {
  info: '提示', success: '成功', warning: '警告', error: '错误',
}

function hasOwn(value: object, key: string) {
  return Object.prototype.hasOwnProperty.call(value, key)
}

function addClass(node: Node, ...names: string[]) {
  const data = (node.data ??= {})
  const properties = ((data.hProperties as Record<string, unknown>) ??= {})
  const current = properties.className
  properties.className = [
    ...(Array.isArray(current) ? current : typeof current === 'string' ? [current] : []),
    ...names,
  ]
}

function isLabel(node?: Node) {
  return node?.type === 'paragraph' && node.data?.directiveLabel === true
}

function fallbackDirective(node: Node) {
  const inline = node.type === 'textDirective'
  const antiAi = node.name === 'anti-ai'
  const label = antiAi ? 'AI 使用限制（anti-ai 指令）' : `未知 Markdown 指令（${node.name || '未命名'}）`
  const data = (node.data ??= {})
  data.hName = inline ? 'span' : 'aside'
  addClass(node, 'luogu-directive-fallback', inline ? 'luogu-directive-fallback-inline' : 'luogu-directive-fallback-block', ...(antiAi ? ['luogu-directive-fallback-anti-ai'] : []))
  const properties = ((data.hProperties as Record<string, unknown>) ??= {})
  properties.role = antiAi ? 'alert' : 'note'
  ;(node.children ??= []).unshift({
    type: 'text', value: `${label}：`,
    data: { hName: inline ? 'span' : 'div', hProperties: { className: ['luogu-directive-fallback-label'] } },
  })
}

function transformDirective(node: Node) {
  if (!['containerDirective', 'leafDirective', 'textDirective'].includes(node.type)) return
  if (node.type === 'textDirective' && (node.name === 'underline' || node.name === 'u')) {
    ;(node.data ??= {}).hName = 'u'
    return
  }
  if (node.type === 'containerDirective' && node.name === 'align') {
    ;(node.data ??= {}).hName = 'div'
    addClass(node, 'luogu-align', hasOwn(node.attributes ?? {}, 'right') ? 'luogu-align-right' : 'luogu-align-center')
    return
  }
  if (node.type === 'containerDirective' && node.name === 'epigraph') {
    ;(node.data ??= {}).hName = 'blockquote'
    addClass(node, 'luogu-epigraph')
    const label = node.children?.find(isLabel)
    if (label && node.children) {
      addClass(node, 'luogu-epigraph-with-footer')
      node.children = node.children.filter(child => child !== label)
      ;(label.data ??= {}).hName = 'footer'
      node.children.push(label)
    }
    return
  }
  const kind = node.name ?? ''
  if (node.type !== 'containerDirective' || !(kind in calloutTitles)) {
    fallbackDirective(node)
    return
  }
  ;(node.data ??= {}).hName = 'details'
  addClass(node, 'luogu-callout', `luogu-callout-${kind}`)
  const properties = (((node.data ??= {}).hProperties as Record<string, unknown>) ??= {})
  if (hasOwn(node.attributes ?? {}, 'open')) properties.open = true
  const children = (node.children ??= [])
  let label = children.find(isLabel)
  if (label) node.children = children.filter(child => child !== label)
  else label = { type: 'paragraph', data: { directiveLabel: true }, children: [{ type: 'text', value: calloutTitles[kind] }] }
  ;(label.data ??= {}).hName = 'summary'
  node.children.unshift(label)
}

function walkMarkdown(parent: Node) {
  if (!parent.children) return
  for (let index = 0; index < parent.children.length; index++) {
    const child = parent.children[index]
    if (child.type === 'leafDirective' && child.name === 'cute-table' && hasOwn(child.attributes ?? {}, 'tuack')) {
      const table = parent.children[index + 1]
      parent.children.splice(index, 1)
      index--
      if (table?.type === 'table') addClass(table, 'luogu-cute-table', 'luogu-cute-table-tuack')
      continue
    }
    transformDirective(child)
    walkMarkdown(child)
  }
}

function remarkLuoguExtensions() {
  return (tree: Node) => walkMarkdown(tree)
}

function classNames(node: Node) {
  const value = node.properties?.className
  return Array.isArray(value) ? value.map(String) : typeof value === 'string' ? [value] : []
}

function textContent(node: Node): string {
  if (node.type === 'text') return node.value ?? ''
  return node.children?.map(textContent).join('') ?? ''
}

function collectRows(node: Node, rows: Node[]) {
  if (node.type !== 'element') return
  if (node.tagName === 'tr') { rows.push(node); return }
  node.children?.forEach(child => collectRows(child, rows))
}

function mergeTuackCells(table: Node) {
  const rows: Node[] = []
  collectRows(table, rows)
  const grid: Array<Array<Node | undefined>> = []
  rows.forEach((row, rowIndex) => {
    const cells = (row.children ?? []).filter(child => child.type === 'element' && (child.tagName === 'td' || child.tagName === 'th'))
    const mergedUp = new Set<Node>()
    grid[rowIndex] = []
    cells.forEach((cell, columnIndex) => {
      const marker = textContent(cell).trim()
      if (marker === '^') {
        const target = grid[rowIndex - 1]?.[columnIndex]
        if (target) {
          if (!mergedUp.has(target)) {
            ;(target.properties ??= {}).rowSpan = Number(target.properties?.rowSpan ?? 1) + 1
            mergedUp.add(target)
          }
          grid[rowIndex][columnIndex] = target
          row.children = row.children?.filter(child => child !== cell)
          return
        }
      } else if (marker === '<') {
        const target = grid[rowIndex][columnIndex - 1]
        if (target) {
          ;(target.properties ??= {}).colSpan = Number(target.properties?.colSpan ?? 1) + 1
          grid[rowIndex][columnIndex] = target
          row.children = row.children?.filter(child => child !== cell)
          return
        }
      }
      grid[rowIndex][columnIndex] = cell
    })
  })
}

function rehypeLuoguExtensions() {
  return (tree: Node) => {
    const walk = (node: Node) => {
      if (node.type !== 'element') return
      if (node.tagName === 'table' && classNames(node).includes('luogu-cute-table-tuack')) mergeTuackCells(node)
      node.children?.forEach(walk)
    }
    tree.children?.forEach(walk)
  }
}

const processor = getLuoguProcessor({
  remarkPlugins: [remarkDirective, remarkLuoguExtensions],
  rehypePlugins: [rehypeLuoguExtensions],
}).use(rehypeStringify).freeze()

/** Render Luogu-flavoured Markdown, including math, GFM and Luogu directives. */
export function renderLuoguMarkdown(markdown: string) {
  return String(processor.processSync(markdown))
}
