import { describe, expect, it } from 'vitest'
import { isAllowedImageHost } from '../functions/_lib/handlers'

describe('image proxy allowlist', () => {
  it('allows Notion file hosts', () => {
    expect(isAllowedImageHost(new URL('https://prod-files-secure.s3.us-west-2.amazonaws.com/foo'))).toBe(true)
    expect(isAllowedImageHost(new URL('https://file.notion.so/x.png'))).toBe(true)
    expect(isAllowedImageHost(new URL('https://www.notion.so/image/foo'))).toBe(true)
    expect(isAllowedImageHost(new URL('https://secure.notion-static.com/a.png'))).toBe(true)
  })

  it('rejects other hosts and http', () => {
    expect(isAllowedImageHost(new URL('https://evil.example.com/x.png'))).toBe(false)
    expect(isAllowedImageHost(new URL('http://www.notion.so/x.png'))).toBe(false)
  })
})
