import {
  DEFAULT_ANNOTATIONS,
  RICH_TEXT_ITEM_MAX,
  type OfficialRichText,
  type RichTextAnnotations
} from './types'

/** Unofficial Notion decorated title token: [text, decorations?]. */
export type Decoration = [string, Array<[string, ...string[]]>?]

export function annotationsEqual(a: RichTextAnnotations, b: RichTextAnnotations): boolean {
  return (
    a.bold === b.bold &&
    a.italic === b.italic &&
    a.strikethrough === b.strikethrough &&
    a.underline === b.underline &&
    a.code === b.code &&
    a.color === b.color
  )
}

export function decorationsToOfficial(title: Decoration[] | undefined): OfficialRichText[] {
  if (!title?.length) return []
  const items: OfficialRichText[] = []
  for (const token of title) {
    const text = token[0] ?? ''
    const decos = token[1] ?? []
    const annotations = { ...DEFAULT_ANNOTATIONS }
    let link: { url: string } | null = null
    for (const deco of decos) {
      const kind = deco[0]
      if (kind === 'b') annotations.bold = true
      else if (kind === 'i') annotations.italic = true
      else if (kind === 's') annotations.strikethrough = true
      else if (kind === '_') annotations.underline = true
      else if (kind === 'c') annotations.code = true
      else if (kind === 'a' && deco[1]) link = { url: deco[1] }
      else if (kind === 'h' && deco[1]) annotations.color = deco[1]
    }
    pushSplit(items, text, annotations, link)
  }
  return mergeAdjacent(items)
}

export function officialToDecorations(items: OfficialRichText[]): Decoration[] {
  return items.map((item) => {
    const decos: Array<[string, ...string[]]> = []
    const a = item.annotations
    if (a.bold) decos.push(['b'])
    if (a.italic) decos.push(['i'])
    if (a.strikethrough) decos.push(['s'])
    if (a.underline) decos.push(['_'])
    if (a.code) decos.push(['c'])
    if (a.color && a.color !== 'default') decos.push(['h', a.color])
    const url = item.text.link?.url
    if (url) decos.push(['a', url])
    const text = item.text.content
    return decos.length ? ([text, decos] as Decoration) : ([text] as Decoration)
  })
}

export function officialToHtml(items: OfficialRichText[]): string {
  return items
    .map((item) => {
      let html = escapeHtml(item.text.content).replace(/\n/g, '<br>')
      const a = item.annotations
      if (a.code) html = `<code>${html}</code>`
      if (a.bold) html = `<strong>${html}</strong>`
      if (a.italic) html = `<em>${html}</em>`
      if (a.underline) html = `<u>${html}</u>`
      if (a.strikethrough) html = `<s>${html}</s>`
      const url = item.text.link?.url
      if (url) {
        html = `<a href="${escapeAttr(url)}">${html}</a>`
      }
      return html
    })
    .join('')
}

export function htmlToOfficial(html: string): OfficialRichText[] {
  const root = parseMiniHtml(html)
  const items: OfficialRichText[] = []
  walk(root, { ...DEFAULT_ANNOTATIONS }, null, items)
  return mergeAdjacent(items)
}

export function plainTextToOfficial(text: string): OfficialRichText[] {
  const items: OfficialRichText[] = []
  pushSplit(items, text, { ...DEFAULT_ANNOTATIONS }, null)
  return items
}

export function officialPlainText(items: OfficialRichText[]): string {
  return items.map((i) => i.text.content).join('')
}

export function splitRichTextItems(items: OfficialRichText[]): OfficialRichText[] {
  const out: OfficialRichText[] = []
  for (const item of items) {
    pushSplit(out, item.text.content, item.annotations, item.text.link)
  }
  return out
}

function pushSplit(
  items: OfficialRichText[],
  text: string,
  annotations: RichTextAnnotations,
  link: { url: string } | null
) {
  if (text.length === 0) return
  let remaining = text
  while (remaining.length > RICH_TEXT_ITEM_MAX) {
    items.push(makeItem(remaining.slice(0, RICH_TEXT_ITEM_MAX), annotations, link))
    remaining = remaining.slice(RICH_TEXT_ITEM_MAX)
  }
  if (remaining.length) items.push(makeItem(remaining, annotations, link))
}

function makeItem(
  content: string,
  annotations: RichTextAnnotations,
  link: { url: string } | null
): OfficialRichText {
  return {
    type: 'text',
    text: { content, link },
    annotations: { ...annotations },
    plain_text: content,
    href: link?.url ?? null
  }
}

function mergeAdjacent(items: OfficialRichText[]): OfficialRichText[] {
  const out: OfficialRichText[] = []
  for (const item of items) {
    const prev = out[out.length - 1]
    if (
      prev &&
      annotationsEqual(prev.annotations, item.annotations) &&
      (prev.text.link?.url ?? null) === (item.text.link?.url ?? null) &&
      prev.text.content.length + item.text.content.length <= RICH_TEXT_ITEM_MAX
    ) {
      prev.text.content += item.text.content
      prev.plain_text = prev.text.content
    } else {
      out.push({
        ...item,
        annotations: { ...item.annotations },
        text: { content: item.text.content, link: item.text.link }
      })
    }
  }
  return out
}

interface WalkNode {
  nodeType: number
  textContent?: string | null
  childNodes: WalkNode[]
  name?: string
  href?: string | null
}

/** Tiny HTML subset parser so this module stays free of DOM lib types (Workers-safe). */
export function parseMiniHtml(html: string): WalkNode {
  const root: WalkNode = { nodeType: 1, textContent: '', childNodes: [], name: 'div' }
  const stack: WalkNode[] = [root]
  const re = /<!--.*?-->|<\/?([a-zA-Z0-9]+)([^>]*)>|([^<]+)/gs
  let m: RegExpExecArray | null
  while ((m = re.exec(html))) {
    const parent = stack[stack.length - 1]!
    if (m[3] != null) {
      parent.childNodes.push({
        nodeType: 3,
        textContent: decodeEntities(m[3]),
        childNodes: []
      })
      continue
    }
    const tag = (m[1] || '').toLowerCase()
    const isClose = m[0].startsWith('</')
    if (tag === 'br' && !isClose) {
      parent.childNodes.push({ nodeType: 3, textContent: '\n', childNodes: [] })
      continue
    }
    if (isClose) {
      if (stack.length > 1) stack.pop()
      continue
    }
    const hrefMatch = /href\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(m[2] || '')
    const node: WalkNode = {
      nodeType: 1,
      textContent: '',
      childNodes: [],
      name: tag,
      href: hrefMatch?.[1] ?? hrefMatch?.[2] ?? null
    }
    parent.childNodes.push(node)
    if (!m[0].endsWith('/>')) stack.push(node)
  }
  return root
}

function walk(
  node: WalkNode,
  annotations: RichTextAnnotations,
  link: { url: string } | null,
  items: OfficialRichText[]
) {
  for (const child of node.childNodes) {
    if (child.nodeType === 3) {
      pushSplit(items, child.textContent ?? '', annotations, link)
      continue
    }
    if (child.nodeType !== 1) continue
    const name = (child.name || '').toLowerCase()
    if (name === 'br') {
      pushSplit(items, '\n', annotations, link)
      continue
    }
    const next = { ...annotations }
    let nextLink = link
    if (name === 'strong' || name === 'b') next.bold = true
    if (name === 'em' || name === 'i') next.italic = true
    if (name === 'u') next.underline = true
    if (name === 's' || name === 'strike' || name === 'del') next.strikethrough = true
    if (name === 'code') next.code = true
    if (name === 'a' && child.href) nextLink = { url: child.href }
    walk(child, next, nextLink, items)
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/"/g, '&quot;')
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
}
