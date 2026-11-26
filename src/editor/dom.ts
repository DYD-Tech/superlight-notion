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

const HOST_SELECTORS = [
  ':scope > .notion-h-content',
  ':scope > .notion-to-do-item .notion-to-do-body',
  ':scope > .notion-quote',
  ':scope.notion-quote',
  ':scope > .notion-list-item-body',
  ':scope > span',
  ':scope > div.notion-text'
]

export function findTextHost(blockEl: HTMLElement): HTMLElement | null {
  for (const sel of HOST_SELECTORS) {
    try {
      const hit = blockEl.querySelector(sel)
      if (hit instanceof HTMLElement) return hit
    } catch {
      // :scope may fail in old queries; ignore
    }
  }
  // Headings wrap content in an h1/h2/h3
  const heading = blockEl.querySelector('h1, h2, h3, h4')
  if (heading instanceof HTMLElement) {
    const content = heading.querySelector('.notion-h-content')
    if (content instanceof HTMLElement) return content
    return heading
  }
  if (blockEl.classList.contains('notion-text')) {
    // Use the block itself but we'll hide nested child wrappers when swapping in the editor.
    return blockEl
  }
  const li = blockEl.matches('li') ? blockEl : blockEl.querySelector(':scope > li, li')
  if (li instanceof HTMLElement) return li
  return blockEl
}

export function officialFromEditor(editor: HTMLElement): OfficialRichText[] {
  return htmlToOfficial(editor.innerHTML)
}

export function seedEditorHtml(recordMap: ExtendedRecordMap, blockId: string): string {
  const html = officialToHtml(titleOf(recordMap, blockId))
  return html || '<br>'
}
