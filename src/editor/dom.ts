import { decorationsToOfficial, htmlToOfficial, officialToHtml } from '@shared/richText'
import type { OfficialRichText } from '@shared/types'
import { isEditableUnofficialType } from '@shared/types'
import { toUuid } from '@shared/ids'
import type { ExtendedRecordMap } from 'notion-types'

const BLOCK_CLASS = /(?:^|\s)notion-block-([0-9a-f]{32})(?:\s|$)/i

export function findBlockElement(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) return null
  return target.closest('[class*="notion-block-"]')
}

export function blockIdFromElement(el: HTMLElement | null): string | null {
  if (!el) return null
  const cls = el.className?.toString() ?? ''
  const m = BLOCK_CLASS.exec(cls)
  if (!m?.[1]) {
    // Walk up in case closest matched a wrapper with a different class order
    let cur: HTMLElement | null = el
    while (cur) {
      const hit = BLOCK_CLASS.exec(cur.className?.toString() ?? '')
      if (hit?.[1]) return toUuid(hit[1])
      cur = cur.parentElement
    }
    return null
  }
  return toUuid(m[1])
}

export function isCheckboxClick(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false
  return Boolean(target.closest('.notion-property-checkbox, .notion-to-do-item .notion-property'))
}

export function blockTypeOf(recordMap: ExtendedRecordMap, blockId: string): string | undefined {
  const wrap = recordMap.block?.[blockId] as { value?: { type?: string } } | undefined
  return wrap?.value?.type
}

export function isEditableBlock(recordMap: ExtendedRecordMap, blockId: string): boolean {
  const t = blockTypeOf(recordMap, blockId)
  return Boolean(t && isEditableUnofficialType(t))
}

export function isChecked(recordMap: ExtendedRecordMap, blockId: string): boolean {
  const wrap = recordMap.block?.[blockId] as
    | { value?: { properties?: { checked?: string[][] } } }
    | undefined
  return wrap?.value?.properties?.checked?.[0]?.[0] === 'Yes'
}

export function titleOf(recordMap: ExtendedRecordMap, blockId: string): OfficialRichText[] {
  const wrap = recordMap.block?.[blockId] as
    | { value?: { properties?: { title?: Array<[string, Array<[string, ...string[]]>?]> } } }
    | undefined
  const title = wrap?.value?.properties?.title
  return decorationsToOfficial(title)
}

export function lastEditedOf(
  recordMap: ExtendedRecordMap,
  blockId: string,
  blockTimes?: Record<string, string>
): string | undefined {
  if (blockTimes?.[blockId]) return blockTimes[blockId]
  const wrap = recordMap.block?.[blockId] as { value?: { last_edited_time?: string | number } } | undefined
  const t = wrap?.value?.last_edited_time
  if (typeof t === 'string' && t.includes('T')) return t
  return undefined
}

const CHILD_CONTAINER_RE =
  /\b(notion-text-children|notion-to-do-children|notion-header-anchor|notion-hash-link)\b/

export function isProtectedChild(el: Element): boolean {
  const cls = el.className?.toString() ?? ''
  if (CHILD_CONTAINER_RE.test(cls)) return true
  if (el.classList.contains('notion-list')) return true
  if (BLOCK_CLASS.test(cls)) return true
  return false
}

/**
 * The element that displays this block's own title/body text, not nested
 * child blocks, list markers, callout icons, or todo checkboxes.
 */
export function findTextHost(blockEl: HTMLElement): HTMLElement {
  const heading = blockEl.querySelector('.notion-h-title')
  if (heading instanceof HTMLElement) return heading

  const todo = blockEl.querySelector(':scope .notion-to-do-body')
  if (todo instanceof HTMLElement) return todo

  const callout = blockEl.querySelector(':scope > .notion-callout-text')
  if (callout instanceof HTMLElement) return callout

  const summary = blockEl.querySelector(':scope > summary')
  if (summary instanceof HTMLElement) return summary

  if (blockEl.classList.contains('notion-quote') || blockEl.matches('blockquote')) {
    const first = blockEl.querySelector(':scope > div')
    if (first instanceof HTMLElement && !isProtectedChild(first)) return first
  }

  if (blockEl.classList.contains('notion-list')) {
    const li = blockEl.querySelector(':scope > li')
    if (li instanceof HTMLElement) return li
  }

  return blockEl
}

export interface InlineEditorSession {
  editor: HTMLElement
  host: HTMLElement
  teardown: () => void
}

/** Hide the host's own text in place and put a seamless contenteditable in the same spot. */
export function mountInlineEditor(host: HTMLElement, html: string): InlineEditorSession {
  const hidden: Array<{ el: HTMLElement; display: string }> = []
  const stash = document.createDocumentFragment()
  const firstProtected = Array.from(host.children).find((el) => isProtectedChild(el)) ?? null

  for (const node of Array.from(host.childNodes)) {
    if (node instanceof Element && isProtectedChild(node)) continue
    if (node instanceof HTMLElement) {
      hidden.push({ el: node, display: node.style.display })
      node.setAttribute('data-sln-hidden', '1')
      node.style.display = 'none'
    } else {
      stash.appendChild(node)
    }
  }

  const editor = document.createElement('div')
  editor.className = 'sln-editor'
  editor.contentEditable = 'true'
  editor.spellcheck = true
  editor.setAttribute('data-sln-editor', '1')
  editor.innerHTML = html || '<br>'

  if (firstProtected) host.insertBefore(editor, firstProtected)
  else host.appendChild(editor)

  return {
    editor,
    host,
    teardown() {
      editor.remove()
      for (const { el, display } of hidden) {
        el.style.display = display
        el.removeAttribute('data-sln-hidden')
      }
      if (stash.childNodes.length) {
        const anchor = Array.from(host.children).find((el) => isProtectedChild(el)) ?? null
        host.insertBefore(stash, anchor)
      }
    }
  }
}

export function officialFromEditor(editor: HTMLElement): OfficialRichText[] {
  return htmlToOfficial(editor.innerHTML)
}

export function seedEditorHtml(recordMap: ExtendedRecordMap, blockId: string): string {
  const html = officialToHtml(titleOf(recordMap, blockId))
  return html || '<br>'
}

export function placeCaretEnd(el: HTMLElement) {
  el.focus()
  const range = document.createRange()
  range.selectNodeContents(el)
  range.collapse(false)
  const sel = window.getSelection()
  sel?.removeAllRanges()
  sel?.addRange(range)
}

/** Place the caret at a page point when possible; otherwise at the end of `el`. */
export function placeCaretAtPoint(el: HTMLElement, clientX?: number, clientY?: number) {
  el.focus()
  if (clientX != null && clientY != null) {
    const doc = document as Document & {
      caretRangeFromPoint?: (x: number, y: number) => Range | null
      caretPositionFromPoint?: (
        x: number,
        y: number
      ) => { offsetNode: Node; offset: number } | null
    }
    let range: Range | null = null
    if (typeof doc.caretRangeFromPoint === 'function') {
      range = doc.caretRangeFromPoint(clientX, clientY)
    } else if (typeof doc.caretPositionFromPoint === 'function') {
      const pos = doc.caretPositionFromPoint(clientX, clientY)
      if (pos) {
        range = document.createRange()
        range.setStart(pos.offsetNode, pos.offset)
        range.collapse(true)
      }
    }
    if (range && el.contains(range.startContainer)) {
      const sel = window.getSelection()
      sel?.removeAllRanges()
      sel?.addRange(range)
      return
    }
  }
  placeCaretEnd(el)
}
