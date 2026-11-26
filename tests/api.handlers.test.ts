import { afterEach, describe, expect, it } from 'vitest'
import {
  handleAppendChild,
  handleDeleteBlock,
  handleGetPage,
  handleImageProxy,
  handlePatchBlock,
  handleSearch
} from '../functions/_lib/handlers'
import { isAuthed, sessionCookie, sessionToken, SESSION_COOKIE } from '../functions/_lib/auth'
import { ctx, installNotionMock, PARA, ROOT, testEnv } from './helpers'

const origFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = origFetch
})

describe('auth', () => {
  it('accepts a valid session cookie and rejects a bad one', async () => {
    const env = testEnv()
    const token = await sessionToken(env.APP_PASSWORD)
    const okReq = new Request('https://example.com/api/me', {
      headers: { cookie: sessionCookie(token) }
    })
    expect(await isAuthed(okReq, env)).toBe(true)

    const badReq = new Request('https://example.com/api/me', {
      headers: { cookie: `${SESSION_COOKIE}=nope` }
    })
    expect(await isAuthed(badReq, env)).toBe(false)
    expect(await isAuthed(new Request('https://example.com/api/me'), env)).toBe(false)
  })
})

describe('page + search', () => {
  it('returns a recordMap for a mocked official page', async () => {
    installNotionMock()
    const res = await handleGetPage(
      ctx(new Request('https://example.com/api/page/' + ROOT), { id: ROOT })
    )
    expect(res.status).toBe(200)
    const data = (await res.json()) as {
      pageId: string
      recordMap: { block: Record<string, unknown> }
    }
    expect(data.pageId).toBe(ROOT)
    expect(data.recordMap.block[ROOT]).toBeTruthy()
    expect(Object.keys(data.recordMap.block).length).toBeGreaterThan(1)
  })

  it('lists the root page in search', async () => {
    installNotionMock()
    const res = await handleSearch(ctx(new Request('https://example.com/api/search')))
    expect(res.status).toBe(200)
    const data = (await res.json()) as { pages: Array<{ id: string; title: string }> }
    expect(data.pages.some((p) => p.id === ROOT && p.title === 'Root')).toBe(true)
  })
})

describe('block writes', () => {
  it('updates paragraph rich text', async () => {
    const seen: unknown[] = []
    installNotionMock({ onUpdate: (_id, body) => seen.push(body) })
    const res = await handlePatchBlock(
      ctx(
        new Request('https://example.com/api/block/' + PARA, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            pageId: ROOT,
            lastEditedTime: '2026-01-02T00:00:00.000Z',
            richText: [
              {
                type: 'text',
                text: { content: 'Updated', link: null },
                annotations: {
                  bold: false,
                  italic: false,
                  strikethrough: false,
                  underline: false,
                  code: false,
                  color: 'default'
                }
              }
            ]
          })
        }),
        { id: PARA }
      )
    )
    expect(res.status).toBe(200)
    expect(seen).toHaveLength(1)
    const body = seen[0] as { paragraph?: { rich_text?: Array<{ text: { content: string } }> } }
    expect(body.paragraph?.rich_text?.[0]?.text.content).toBe('Updated')
  })

  it('returns 409 when last_edited_time does not match', async () => {
    installNotionMock({ lastEdited: '2026-01-02T00:00:00.000Z' })
    const res = await handlePatchBlock(
      ctx(
        new Request('https://example.com/api/block/' + PARA, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            pageId: ROOT,
            lastEditedTime: '2026-01-01T00:00:00.000Z',
            richText: [
              {
                type: 'text',
                text: { content: 'Nope', link: null },
                annotations: {
                  bold: false,
                  italic: false,
                  strikethrough: false,
                  underline: false,
                  code: false,
                  color: 'default'
                }
              }
            ]
          })
        }),
        { id: PARA }
      )
    )
    expect(res.status).toBe(409)
    const data = (await res.json()) as { error: string }
    expect(data.error).toBe('conflict')
  })

  it('appends a paragraph after a block', async () => {
    let appended: unknown
    installNotionMock({ onAppend: (_id, body) => (appended = body) })
    const res = await handleAppendChild(
      ctx(
        new Request('https://example.com/api/block/' + PARA + '/children', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ pageId: ROOT })
        }),
        { id: PARA }
      )
    )
    expect(res.status).toBe(200)
    const body = appended as { after?: string; children?: unknown[] }
    expect(body.after).toBe(PARA)
    expect(body.children).toHaveLength(1)
  })

  it('archives a block', async () => {
    let deleted = ''
    installNotionMock({ onDelete: (id) => (deleted = id) })
    const res = await handleDeleteBlock(
      ctx(new Request('https://example.com/api/block/' + PARA + '?pageId=' + ROOT, { method: 'DELETE' }), {
        id: PARA
      })
    )
    expect(res.status).toBe(200)
    expect(deleted).toBe(PARA)
  })
})

describe('image proxy', () => {
  it('rejects disallowed hosts', async () => {
    const res = await handleImageProxy(
      ctx(new Request('https://example.com/api/img?u=' + encodeURIComponent('https://evil.example/x.png')))
    )
    expect(res.status).toBe(400)
  })
})
