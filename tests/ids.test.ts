import { describe, expect, it } from 'vitest'
import { notionPageUrl, stripDashes, toUuid } from '../shared/ids'

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
