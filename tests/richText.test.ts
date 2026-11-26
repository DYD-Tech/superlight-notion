import { describe, expect, it } from 'vitest'
import {
  decorationsToOfficial,
  htmlToOfficial,
  officialPlainText,
  officialToDecorations,
  officialToHtml,
  richTextEqual,
  splitRichTextItems
} from '../shared/richText'
import { RICH_TEXT_ITEM_MAX, type OfficialRichText } from '../shared/types'

function item(content: string, extra?: Partial<OfficialRichText['annotations']> & { url?: string }): OfficialRichText {
  return {
    type: 'text',
    text: { content, link: extra?.url ? { url: extra.url } : null },
    annotations: {
      bold: Boolean(extra?.bold),
      italic: Boolean(extra?.italic),
      strikethrough: false,
      underline: false,
      code: Boolean(extra?.code),
      color: 'default'
    }
  }
}

describe('rich text', () => {
  it('splits items longer than 2000 characters', () => {
    const text = 'α'.repeat(RICH_TEXT_ITEM_MAX + 50)
    const parts = splitRichTextItems([item(text)])
    expect(parts).toHaveLength(2)
    expect(parts[0]?.text.content).toHaveLength(RICH_TEXT_ITEM_MAX)
    expect(parts[1]?.text.content).toHaveLength(50)
    expect(officialPlainText(parts)).toBe(text)
  })

  it('converts unofficial decorations to official rich text', () => {
    const official = decorationsToOfficial([
      ['Hello ', [['b']]],
      ['world', [['i'], ['a', 'https://example.com']]]
    ])
    expect(official[0]?.annotations.bold).toBe(true)
    expect(official[1]?.annotations.italic).toBe(true)
    expect(official[1]?.text.link?.url).toBe('https://example.com')
    expect(officialToDecorations(official)[1]?.[1]).toEqual(
      expect.arrayContaining([['i'], ['a', 'https://example.com']])
    )
  })

  it('round-trips a simple HTML subset', () => {
    const src = [item('粗', { bold: true }), item('斜', { italic: true }), item('码', { code: true })]
    const html = officialToHtml(src)
    expect(html).toContain('<strong>')
    expect(html).toContain('<em>')
    expect(html).toContain('<code>')
    const back = htmlToOfficial(html)
    expect(officialPlainText(back)).toBe('粗斜码')
    expect(back[0]?.annotations.bold).toBe(true)
    expect(back[1]?.annotations.italic).toBe(true)
    expect(back[2]?.annotations.code).toBe(true)
  })

  it('parses links in HTML', () => {
    const back = htmlToOfficial('<a href="https://dydlab.com">hi</a>')
    expect(officialPlainText(back)).toBe('hi')
    expect(back[0]?.text.link?.url).toBe('https://dydlab.com')
  })
})

describe('richTextEqual', () => {
  it('treats structurally equal items as equal and ignores derived fields', () => {
    const a = [item('Hello', { bold: true })]
    const b: OfficialRichText[] = [
      {
        ...item('Hello', { bold: true }),
        plain_text: 'Hello',
        href: null
      }
    ]
    expect(richTextEqual(a, b)).toBe(true)
    expect(richTextEqual([], [])).toBe(true)
  })

  it('detects content, annotation, and link differences', () => {
    expect(richTextEqual([item('A')], [item('B')])).toBe(false)
    expect(richTextEqual([item('A', { bold: true })], [item('A')])).toBe(false)
    expect(richTextEqual([item('A', { url: 'https://a.example' })], [item('A')])).toBe(false)
    expect(richTextEqual([item('A'), item('B')], [item('A')])).toBe(false)
  })
})
