import { describe, expect, it } from 'vitest'
import {
  createNotionClient,
  DATABASE_QUERY_PAGE_SIZE,
  fetchBlockChildren,
  getRecordMap,
  loadDatabaseViews,
  type FetchLike
} from '../functions/_lib/notion'
import { handleGetPage } from '../functions/_lib/handlers'
import {
  createCache,
  rememberBlockChildrenKey,
  invalidatePage,
  blockChildrenCacheKey,
  _clearMemoryCache
} from '../functions/_lib/cache'
import { ctx, jsonResponse, pageObject, ROOT, testEnv } from './helpers'
import { formatPropertyValue, orderDatabaseProperties, rowTitle } from '../shared/database'
import type { DatabaseRow } from '../shared/types'

const DB_A = 'aaaaaaa1-aaaa-aaaa-aaaa-aaaaaaaaaaa1'
const DB_B = 'aaaaaaa2-aaaa-aaaa-aaaa-aaaaaaaaaaa2'
const ROW_1 = 'bbbbbbb1-bbbb-bbbb-bbbb-bbbbbbbbbbb1'
const ROW_2 = 'bbbbbbb2-bbbb-bbbb-bbbb-bbbbbbbbbbb2'
const TOGGLE = 'ccccccc1-cccc-cccc-cccc-ccccccccccc1'
const LAST = '2026-01-02T00:00:00.000Z'

function childList(results: unknown[]) {
  return { object: 'list', results, next_cursor: null, has_more: false }
}

function childDatabase(id: string, parent: string, title: string) {
  return {
    object: 'block',
    id,
    type: 'child_database',
    has_children: false,
    archived: false,
    last_edited_time: LAST,
    created_time: '2026-01-01T00:00:00.000Z',
    parent: { type: 'page_id', page_id: parent },
    child_database: { title }
  }
}

function headingToggle(id: string, parent: string, text: string) {
  return {
    object: 'block',
    id,
    type: 'heading_2',
    has_children: true,
    archived: false,
    last_edited_time: LAST,
    created_time: '2026-01-01T00:00:00.000Z',
    parent: { type: 'page_id', page_id: parent },
    heading_2: {
      rich_text: [
        {
          type: 'text',
          text: { content: text, link: null },
          annotations: { bold: false, italic: false, strikethrough: false, underline: false, code: false, color: 'default' },
          plain_text: text,
          href: null
        }
      ],
      is_toggleable: true,
      color: 'default'
    }
  }
}

function schema(id: string, title: string) {
  return {
    object: 'database',
    id,
    title: [{ type: 'text', text: { content: title }, plain_text: title }],
    icon: { type: 'emoji', emoji: '📒' },
    properties: {
      Name: { id: 'title', name: 'Name', type: 'title' },
      Status: { id: 'st', name: 'Status', type: 'select' },
      Done: { id: 'do', name: 'Done', type: 'checkbox' }
    }
  }
}

function row(id: string, title: string, status: string) {
  return {
    object: 'page',
    id,
    last_edited_time: LAST,
    url: `https://www.notion.so/${id.replace(/-/g, '')}`,
    properties: {
      Name: { type: 'title', title: [{ type: 'text', text: { content: title }, plain_text: title }] },
      Status: { type: 'select', select: { name: status } },
      Done: { type: 'checkbox', checkbox: false }
    }
  }
}

interface RecordedCall {
  method: string
  path: string
  body: unknown
}

function mockClient(handler: (url: URL, method: string, body: unknown) => unknown | Promise<unknown>) {
  const calls: RecordedCall[] = []
  const fetchFn: FetchLike = async (input, init) => {
    const url = new URL(String(input))
    const method = (init?.method || 'GET').toUpperCase()
    const body = init?.body ? JSON.parse(String(init.body)) : null
    calls.push({ method, path: url.pathname, body })
    const data = await handler(url, method, body)
    if (data === undefined) {
      return jsonResponse({ object: 'error', message: `unmocked ${method} ${url.pathname}` }, 404)
    }
    if (data && typeof data === 'object' && 'status' in (data as object) && 'payload' in (data as object)) {
      const boxed = data as { status: number; payload: unknown }
      return jsonResponse(boxed.payload, boxed.status)
    }
    return jsonResponse(data)
  }
  return { client: createNotionClient('tok', fetchFn), calls, fetchFn }
}

describe('database property formatting', () => {
  it('orders the title column first and formats common types', () => {
    const ordered = orderDatabaseProperties({
      Status: { id: 'st', name: 'Status', type: 'select' },
      Name: { id: 'title', name: 'Name', type: 'title' },
      Tags: { id: 'tg', name: 'Tags', type: 'multi_select' }
    })
    expect(ordered.map((p) => p.name)).toEqual(['Name', 'Status', 'Tags'])
    expect(formatPropertyValue({ type: 'select', select: { name: 'Open' } })).toBe('Open')
    expect(
      formatPropertyValue({
        type: 'multi_select',
        multi_select: [{ name: 'A' }, { name: 'B' }]
      })
    ).toBe('A, B')
    expect(formatPropertyValue({ type: 'date', date: { start: '2026-01-01', end: '2026-01-02' } })).toBe(
      '2026-01-01 → 2026-01-02'
    )
    expect(formatPropertyValue({ type: 'checkbox', checkbox: true })).toBe('Yes')
    expect(formatPropertyValue({ type: 'number', number: 12 })).toBe('12')
    expect(formatPropertyValue({ type: 'formula', formula: { type: 'string', string: 'ok' } })).toBe('ok')
    expect(formatPropertyValue({ type: 'people', people: [{ name: 'Ada' }] })).toBe('Ada')
    expect(formatPropertyValue({ type: 'url', url: 'https://example.com' })).toBe('https://example.com')
    const row: DatabaseRow = {
      id: ROW_1,
      properties: {
        Name: { type: 'title', title: [{ type: 'text', text: { content: 'Row' }, plain_text: 'Row' }] }
      }
    }
    expect(rowTitle(row, ordered)).toBe('Row')
  })
})

describe('minimal-request database fetch', () => {
  it('uses one GET schema and one POST query with page_size, and no per-row fetches', async () => {
    const { client, calls } = mockClient((url, method, body) => {
      if (method === 'GET' && url.pathname === `/v1/pages/${ROOT}`) return pageObject(ROOT, 'Workbench')
      if (method === 'GET' && url.pathname === `/v1/blocks/${ROOT}/children`) {
        return childList([childDatabase(DB_A, ROOT, '工作台条目')])
      }
      if (method === 'GET' && url.pathname === `/v1/databases/${DB_A}`) return schema(DB_A, '工作台条目')
      if (method === 'POST' && url.pathname === `/v1/databases/${DB_A}/query`) {
        expect((body as { page_size?: number }).page_size).toBe(DATABASE_QUERY_PAGE_SIZE)
        expect(DATABASE_QUERY_PAGE_SIZE).toBe(50)
        return childList([row(ROW_1, 'Alpha', 'Open'), row(ROW_2, 'Beta', 'Done')])
      }
      return undefined
    })
    const result = await getRecordMap(client, ROOT)
    const paths = calls.map((c) => `${c.method} ${c.path}`)
    expect(paths.filter((p) => p.startsWith('GET /v1/pages/'))).toHaveLength(1)
    expect(paths.filter((p) => p === `GET /v1/databases/${DB_A}`)).toHaveLength(1)
    expect(paths.filter((p) => p === `POST /v1/databases/${DB_A}/query`)).toHaveLength(1)
    expect(paths.some((p) => p.startsWith('GET /v1/pages/') && p !== `GET /v1/pages/${ROOT}`)).toBe(false)
    expect(result.databases[DB_A].title).toBe('工作台条目')
    expect(result.databases[DB_A].rows).toHaveLength(2)
    expect(result.databases[DB_A].hasMore).toBe(false)
    expect(result.recordMap.block[DB_A]?.value?.type).toBe('collection_view')
  })

  it('deduplicates schema+query when two blocks share the same database id', async () => {
    const { client, calls } = mockClient((url, method, body) => {
      if (method === 'GET' && url.pathname === `/v1/pages/${ROOT}`) return pageObject(ROOT, 'Page')
      if (method === 'GET' && url.pathname === `/v1/blocks/${ROOT}/children`) {
        return childList([childDatabase(DB_A, ROOT, 'A'), childDatabase(DB_A, ROOT, 'A again')])
      }
      if (method === 'GET' && url.pathname === `/v1/databases/${DB_A}`) return schema(DB_A, 'Shared')
      if (method === 'POST' && url.pathname === `/v1/databases/${DB_A}/query`) {
        void body
        return childList([row(ROW_1, 'One', 'Open')])
      }
      return undefined
    })
    const result = await getRecordMap(client, ROOT)
    expect(calls.filter((c) => c.path === `/v1/databases/${DB_A}` && c.method === 'GET')).toHaveLength(1)
    expect(calls.filter((c) => c.path === `/v1/databases/${DB_A}/query` && c.method === 'POST')).toHaveLength(1)
    expect(Object.keys(result.databases)).toEqual([DB_A])
  })

  it('deduplicates loadDatabaseViews for repeated ids', async () => {
    const { client, calls } = mockClient((url, method) => {
      if (method === 'GET' && url.pathname === `/v1/databases/${DB_A}`) return schema(DB_A, 'Shared')
      if (method === 'POST' && url.pathname === `/v1/databases/${DB_A}/query`) return childList([])
      return undefined
    })
    const views = await loadDatabaseViews(client, [DB_A, DB_A, DB_A])
    expect(Object.keys(views)).toEqual([DB_A])
    expect(calls.filter((c) => c.method === 'GET')).toHaveLength(1)
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(1)
  })

  it('degrades a missing database without failing the page or other databases', async () => {
    const { client, calls } = mockClient((url, method) => {
      if (method === 'GET' && url.pathname === `/v1/pages/${ROOT}`) return pageObject(ROOT, 'Page')
      if (method === 'GET' && url.pathname === `/v1/blocks/${ROOT}/children`) {
        return childList([childDatabase(DB_A, ROOT, 'Missing'), childDatabase(DB_B, ROOT, 'Ok')])
      }
      if (method === 'GET' && url.pathname === `/v1/databases/${DB_A}`) {
        return { status: 404, payload: { object: 'error', message: 'Could not find database' } }
      }
      if (method === 'GET' && url.pathname === `/v1/databases/${DB_B}`) return schema(DB_B, 'Ok')
      if (method === 'POST' && url.pathname === `/v1/databases/${DB_B}/query`) {
        return childList([row(ROW_1, 'One', 'Open')])
      }
      return undefined
    })
    const result = await getRecordMap(client, ROOT)
    expect(result.databases[DB_A].error).toBe('unavailable')
    expect(result.databases[DB_A].rows).toEqual([])
    expect(result.databases[DB_B].title).toBe('Ok')
    expect(result.databases[DB_B].rows).toHaveLength(1)
    expect(calls.some((c) => c.method === 'POST' && c.path === `/v1/databases/${DB_A}/query`)).toBe(false)
  })

  it('does not query databases inside lazy toggles until children are fetched', async () => {
    const { client, calls } = mockClient((url, method) => {
      if (method === 'GET' && url.pathname === `/v1/pages/${ROOT}`) return pageObject(ROOT, 'Page')
      if (method === 'GET' && url.pathname === `/v1/blocks/${ROOT}/children`) {
        return childList([headingToggle(TOGGLE, ROOT, 'Fold'), childDatabase(DB_A, ROOT, 'Root DB')])
      }
      if (method === 'GET' && url.pathname === `/v1/blocks/${TOGGLE}/children`) {
        return childList([childDatabase(DB_B, TOGGLE, 'Hidden DB')])
      }
      if (method === 'GET' && url.pathname === `/v1/databases/${DB_A}`) return schema(DB_A, 'Root DB')
      if (method === 'POST' && url.pathname === `/v1/databases/${DB_A}/query`) return childList([])
      if (method === 'GET' && url.pathname === `/v1/databases/${DB_B}`) return schema(DB_B, 'Hidden DB')
      if (method === 'POST' && url.pathname === `/v1/databases/${DB_B}/query`) {
        return childList([row(ROW_2, 'Hidden row', 'Open')])
      }
      return undefined
    })
    const page = await getRecordMap(client, ROOT)
    expect(page.lazyBlockIds).toContain(TOGGLE)
    expect(page.databases[DB_A]).toBeTruthy()
    expect(page.databases[DB_B]).toBeUndefined()
    expect(calls.some((c) => c.path.includes(DB_B))).toBe(false)

    const kids = await fetchBlockChildren(client, TOGGLE)
    expect(kids.databases[DB_B].title).toBe('Hidden DB')
    expect(kids.databases[DB_B].rows).toHaveLength(1)
    expect(kids.recordMap.block[DB_B]?.value?.type).toBe('collection_view')
  })

  it('caps concurrent database query jobs at two', async () => {
    const ids = [
      'aaaaaaa1-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
      'aaaaaaa2-aaaa-aaaa-aaaa-aaaaaaaaaaa2',
      'aaaaaaa3-aaaa-aaaa-aaaa-aaaaaaaaaaa3',
      'aaaaaaa4-aaaa-aaaa-aaaa-aaaaaaaaaaa4'
    ]
    let inflight = 0
    let maxInflight = 0
    const { client } = mockClient(async (url, method) => {
      const match = /\/v1\/databases\/([^/]+)(?:\/query)?$/.exec(url.pathname)
      if (!match) return undefined
      const id = match[1]
      if (method === 'GET') return schema(id, id)
      if (method === 'POST') {
        inflight += 1
        maxInflight = Math.max(maxInflight, inflight)
        await new Promise((r) => setTimeout(r, 30))
        inflight -= 1
        return childList([])
      }
      return undefined
    })
    await loadDatabaseViews(client, ids)
    expect(maxInflight).toBeLessThanOrEqual(2)
    expect(maxInflight).toBeGreaterThan(0)
  })

  it('includes databases in the page handler payload', async () => {
    _clearMemoryCache()
    const { fetchFn } = mockClient((url, method, body) => {
      if (method === 'GET' && url.pathname === `/v1/pages/${ROOT}`) return pageObject(ROOT, 'Page')
      if (method === 'GET' && url.pathname === `/v1/blocks/${ROOT}/children`) {
        return childList([childDatabase(DB_A, ROOT, 'DB')])
      }
      if (method === 'GET' && url.pathname === `/v1/databases/${DB_A}`) return schema(DB_A, 'DB')
      if (method === 'POST' && url.pathname === `/v1/databases/${DB_A}/query`) {
        void body
        return childList([row(ROW_1, 'One', 'Open')])
      }
      return undefined
    })
    const orig = globalThis.fetch
    globalThis.fetch = fetchFn as typeof fetch
    try {
      const res = await handleGetPage(
        ctx(new Request(`https://example.com/api/page/${ROOT}`), { id: ROOT }, testEnv())
      )
      expect(res.status).toBe(200)
      const payload = (await res.json()) as { databases: Record<string, { title: string; rows: unknown[] }> }
      expect(payload.databases[DB_A].title).toBe('DB')
      expect(payload.databases[DB_A].rows).toHaveLength(1)
    } finally {
      globalThis.fetch = orig
    }
  })
})

describe('block-children cache invalidation', () => {
  it('drops remembered child keys when the page is invalidated', async () => {
    _clearMemoryCache()
    const store = createCache(testEnv())
    const key = rememberBlockChildrenKey(ROOT, TOGGLE)
    expect(key).toBe(blockChildrenCacheKey(TOGGLE))
    await store.set(key, '{"ok":true}', 120)
    expect(await store.get(key)).toBe('{"ok":true}')
    await invalidatePage(store, ROOT)
    expect(await store.get(key)).toBeNull()
  })
})
