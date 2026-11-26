import type { Env } from '../functions/_lib/env'
import type { PagesContext } from '../functions/_lib/handlers'
import { _clearMemoryCache } from '../functions/_lib/cache'

export const ROOT = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
export const PARA = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
export const PARA2 = 'cccccccc-cccc-cccc-cccc-cccccccccccc'

export function testEnv(overrides: Partial<Env> = {}): Env {
  return {
    NOTION_TOKEN: 'secret_test',
    NOTION_ROOT_PAGE_ID: ROOT,
    APP_PASSWORD: 'test-password',
    ...overrides
  }
}

export function ctx(
  request: Request,
  params: Record<string, string> = {},
  env: Env = testEnv()
): PagesContext {
  return { request, env, params }
}

export function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' }
  })
}

export function textBlock(id: string, parent: string, text: string, last = '2026-01-02T00:00:00.000Z') {
  return {
    object: 'block',
    id,
    type: 'paragraph',
    has_children: false,
    archived: false,
    last_edited_time: last,
    created_time: '2026-01-01T00:00:00.000Z',
    parent: { type: 'page_id', page_id: parent },
    paragraph: {
      rich_text: [
        {
          type: 'text',
          text: { content: text, link: null },
          annotations: {
            bold: false,
            italic: false,
            strikethrough: false,
            underline: false,
            code: false,
            color: 'default'
          },
          plain_text: text,
          href: null
        }
      ],
      color: 'default'
    }
  }
}

export function pageObject(id: string, title: string, last = '2026-01-02T00:00:00.000Z') {
  return {
    object: 'page',
    id,
    last_edited_time: last,
    archived: false,
    parent: { type: 'workspace', workspace: true },
    properties: {
      title: {
        id: 'title',
        type: 'title',
        title: [
          {
            type: 'text',
            text: { content: title, link: null },
            plain_text: title,
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
      }
    },
    url: `https://www.notion.so/${id.replace(/-/g, '')}`
  }
}

export function pageAsBlock(id: string, title: string) {
  return {
    object: 'block',
    id,
    type: 'child_page',
    has_children: true,
    archived: false,
    last_edited_time: '2026-01-02T00:00:00.000Z',
    created_time: '2026-01-01T00:00:00.000Z',
    parent: { type: 'workspace', workspace: true },
    child_page: { title }
  }
}

export function installNotionMock(handlers?: {
  onUpdate?: (id: string, body: unknown) => void
  onDelete?: (id: string) => void
  onAppend?: (id: string, body: unknown) => void
  lastEdited?: string
}) {
  _clearMemoryCache()
  const last = handlers?.lastEdited ?? '2026-01-02T00:00:00.000Z'
  const para = textBlock(PARA, ROOT, 'Hello world', last)
  const fetchMock: typeof fetch = async (input, init) => {
    const url = new URL(String(input))
    const method = (init?.method || 'GET').toUpperCase()
    const body = init?.body ? JSON.parse(String(init.body)) : null

    if (url.pathname === `/v1/pages/${ROOT}` && method === 'GET') {
      return jsonResponse(pageObject(ROOT, 'Root', last))
    }
    if (url.pathname === `/v1/blocks/${ROOT}` && method === 'GET') {
      return jsonResponse(pageAsBlock(ROOT, 'Root'))
    }
    if (url.pathname === `/v1/blocks/${ROOT}/children` && method === 'GET') {
      return jsonResponse({
        object: 'list',
        results: [para],
        next_cursor: null,
        has_more: false
      })
    }
    if (url.pathname === `/v1/blocks/${PARA}` && method === 'GET') {
      return jsonResponse(para)
    }
    if (url.pathname === `/v1/blocks/${PARA}` && method === 'PATCH') {
      handlers?.onUpdate?.(PARA, body)
      return jsonResponse({ ...para, last_edited_time: '2026-01-03T00:00:00.000Z', ...flattenType(body) })
    }
    if (url.pathname === `/v1/blocks/${PARA}` && method === 'DELETE') {
      handlers?.onDelete?.(PARA)
      return jsonResponse({ ...para, archived: true })
    }
    if (url.pathname === `/v1/blocks/${ROOT}/children` && method === 'POST') {
      handlers?.onAppend?.(ROOT, body)
      const created = textBlock(PARA2, ROOT, body?.children?.[0]?.paragraph?.rich_text?.[0]?.text?.content ?? '')
      return jsonResponse({ object: 'list', results: [created], next_cursor: null, has_more: false })
    }
    if (url.pathname === '/v1/search' && method === 'POST') {
      return jsonResponse({
        object: 'list',
        results: [pageObject(ROOT, 'Root')],
        next_cursor: null,
        has_more: false
      })
    }
    return jsonResponse({ object: 'error', message: `unmocked ${method} ${url.pathname}` }, 404)
  }
  globalThis.fetch = fetchMock
  return fetchMock
}

function flattenType(body: Record<string, unknown> | null) {
  if (!body) return {}
  return body
}
