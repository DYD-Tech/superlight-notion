import { describe, expect, it } from 'vitest'
import { notionPageUrl, parsePageId, stripDashes, toUuid } from '../shared/ids'

describe('ids', () => {
  it('normalizes compact and dashed ids', () => {
    const compact = '0123456789abcdef0123456789abcdef'
    const uuid = toUuid(compact)
    expect(uuid).toBe('01234567-89ab-cdef-0123-456789abcdef')
    expect(toUuid(uuid!)).toBe(uuid)
    expect(stripDashes(uuid!)).toBe(compact)
    expect(notionPageUrl(compact)).toBe('https://www.notion.so/' + compact)
  })

  it('rejects invalid ids', () => {
    expect(toUuid('not-an-id')).toBeNull()
    expect(toUuid('')).toBeNull()
  })
})

  it('parses compact ids, dashed ids, and Notion URLs', () => {
    const compact = '0123456789abcdef0123456789abcdef'
    const uuid = '01234567-89ab-cdef-0123-456789abcdef'
    expect(parsePageId(compact)).toBe(uuid)
    expect(parsePageId(uuid)).toBe(uuid)
    expect(parsePageId(`https://www.notion.so/Title-${compact}`)).toBe(uuid)
    expect(parsePageId(`https://www.notion.so/${uuid}?pvs=4`)).toBe(uuid)
    expect(parsePageId(compact, { uuid: false })).toBe(compact)
    expect(parsePageId('')).toBeNull()
    expect(parsePageId('not-an-id')).toBeNull()
  })

