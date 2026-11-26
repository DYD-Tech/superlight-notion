import { describe, expect, it } from 'vitest'
import {
  createNotionClient,
  fetchBlockChildren,
  getRecordMap,
  type FetchLike
} from '../functions/_lib/notion'
import { handleGetBlockChildren, handleGetPage, handleSearch } from '../functions/_lib/handlers'
import { ctx, jsonResponse, pageAsBlock, pageObject, PARA, PARA2, ROOT, textBlock, testEnv } from './helpers'

const PARENT = 'dddddddd-dddd-dddd-dddd-dddddddddddd'
const CHILD = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'
const MENTION = 'ffffffff-ffff-ffff-ffff-ffffffffffff'
const LINKED = '99999999-9999-9999-9999-999999999999'
const TOGGLE = '11111111-1111-1111-1111-111111111111'
const HEADING = '22222222-2222-2222-2222-222222222222'
const INNER = '33333333-3333-3333-3333-333333333333'
const INNER2 = '44444444-4444-4444-4444-444444444444'
const CURSOR = 'cursor-page-2'
const LAST = '2026-01-02T00:00:00.000Z'

function richText(text: string, extras: unknown[] = []) {
  return [
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
    },
    ...extras
  ]
}

function mentionItem(id: string, title: string, kind: 'page' | 'database' = 'page') {
  return {
    type: 'mention',
    mention:
      kind === 'page'
        ? { type: 'page', page: { id } }
        : { type: 'database', database: { id } },
    plain_text: title,
    href: null,
    annotations: {
      bold: false,
      italic: false,
      strikethrough: false,
      underline: false,
      code: false,
      color: 'default'
    }
  }
}

function childList(results: unknown[], next_cursor: string | null = null) {
  return {
    object: 'list',
    results,
    next_cursor,
    has_more: Boolean(next_cursor)
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
    heading_2: { rich_text: richText(text), is_toggleable: true, color: 'default' }
  }
}

function toggleBlock(id: string, parent: string, text: string) {
  return {
    object: 'block',
    id,
    type: 'toggle',
    has_children: true,
    archived: false,
    last_edited_time: LAST,
    created_time: '2026-01-01T00:00:00.000Z',
    parent: { type: 'page_id', page_id: parent },
    toggle: { rich_text: richText(text), color: 'default' }
  }
}

function childPageBlock(id: string, parent: string, title: string) {
  return {
    object: 'block',
    id,
    type: 'child_page',
    has_children: true,
    archived: false,
    last_edited_time: LAST,
    created_time: '2026-01-01T00:00:00.000Z',
    parent: { type: 'page_id', page_id: parent },
    child_page: { title }
  }
}

function linkToPageBlock(id: string, parent: string, pageId: string) {
  return {
    object: 'block',
    id,
    type: 'link_to_page',
    has_children: false,
    archived: false,
    last_edited_time: LAST,
    created_time: '2026-01-01T00:00:00.000Z',
    parent: { type: 'page_id', page_id: parent },
    link_to_page: { type: 'page_id', page_id: pageId }
  }
}

function mentionParagraph(id: string, parent: string) {
  const para = textBlock(id, parent, 'See ', LAST)
  para.paragraph.rich_text = richText('See ', [
    mentionItem(MENTION, 'Mentioned page', 'page'),
    mentionItem('88888888-8888-8888-8888-888888888888', 'Mentioned db', 'database')
  ])
  return para
}

interface RecordedCall {
  method: string
  path: string
  search: string
  body: unknown
}

function pathCalls(calls: RecordedCall[], suffix: string, method = 'GET') {
  return calls.filter((c) => c.method === method && c.path === `/v1${suffix}`)
}

function mockClient(handler: (url: URL, method: string, body: unknown) => unknown) {
  const calls: RecordedCall[] = []
  const fetchFn: FetchLike = async (input, init) => {
    const url = new URL(String(input))
    const method = (init?.method || 'GET').toUpperCase()
    const body = init?.body ? JSON.parse(String(init.body)) : null
    calls.push({ method, path: url.pathname, search: url.searchParams.toString(), body })
    const data = handler(url, method, body)
    if (data === undefined) {
      return jsonResponse({ object: 'error', message: `unmocked ${method} ${url.pathname}` }, 404)
    }
    return jsonResponse(data)
  }
  return { client: createNotionClient('tok', fetchFn), calls, fetchFn }
}

function nestedPage(url: URL, method: string) {
  if (method !== 'GET') return undefined
  const page = { ...pageObject(ROOT, 'Nested', LAST), parent: { type: 'page_id', page_id: PARENT } }
  if (url.pathname === `/v1/pages/${ROOT}`) return page
  if (url.pathname === `/v1/pages/${PARENT}`) return pageObject(PARENT, 'Ancestor', LAST)
  if (url.pathname === `/v1/blocks/${ROOT}`) return pageAsBlock(ROOT, 'Nested')
  if (url.pathname === `/v1/blocks/${PARENT}`) return pageAsBlock(PARENT, 'Ancestor')
  if (url.pathname === `/v1/blocks/${PARENT}/children`) return childList([])
  if (url.pathname === `/v1/blocks/${ROOT}/children`) {
    const cursor = url.searchParams.get('start_cursor')
    if (!cursor) {
      return childList(
        [headingToggle(HEADING, ROOT, 'Fold'), childPageBlock(CHILD, ROOT, 'Subpage')],
        CURSOR
      )
    }
    if (cursor === CURSOR) {
      return childList([
        mentionParagraph(PARA, ROOT),
        linkToPageBlock(PARA2, ROOT, LINKED),
        toggleBlock(TOGGLE, ROOT, 'Notes')
      ])
    }
    return childList([])
  }
  if (url.pathname === `/v1/pages/${CHILD}`) return pageObject(CHILD, 'Subpage', LAST)
  if (url.pathname === `/v1/pages/${LINKED}`) return pageObject(LINKED, 'Linked', LAST)
  if (url.pathname === `/v1/pages/${MENTION}` || url.pathname === `/v1/blocks/${MENTION}`) {
    return pageObject(MENTION, 'Mentioned page', LAST)
  }
  if (url.pathname === `/v1/blocks/${HEADING}/children`) {
    return childList([textBlock(INNER, HEADING, 'Heading body', LAST)])
  }
  if (url.pathname === `/v1/blocks/${TOGGLE}/children`) {
    return childList([textBlock(INNER2, TOGGLE, 'Toggle body', LAST)])
  }
  if (url.pathname === `/v1/blocks/${CHILD}/children`) return childList([])
  return undefined
}

describe('lean getRecordMap request reductions', () => {
  it('fetches a flat page with exactly 2 calls and no blocks.retrieve', async () => {
    const { client, calls } = mockClient((url, method) => {
      if (method !== 'GET') return undefined
      if (url.pathname === `/v1/pages/${ROOT}`) return pageObject(ROOT, 'Root', LAST)
      if (url.pathname === `/v1/blocks/${ROOT}`) return pageAsBlock(ROOT, 'Root')
      if (url.pathname === `/v1/blocks/${ROOT}/children`) {
        expect(url.searchParams.get('page_size')).toBe('100')
        return childList([textBlock(PARA, ROOT, 'Hello world', LAST)])
      }
      if (url.pathname === `/v1/blocks/${PARA}`) return textBlock(PARA, ROOT, 'Hello world', LAST)
      return undefined
    })
    const { pageId, recordMap, lastEditedTime, lazyBlockIds } = await getRecordMap(client, ROOT)
    expect(pageId).toBe(ROOT)
    expect(lastEditedTime).toBe(LAST)
    expect(lazyBlockIds).toEqual([])
    expect(recordMap.block[ROOT]).toBeTruthy()
    expect(recordMap.block[PARA]).toBeTruthy()
    expect((recordMap as unknown as { raw?: { page?: { id?: string } } }).raw?.page?.id).toBe(ROOT)
    expect(pathCalls(calls, `/pages/${ROOT}`)).toHaveLength(1)
    expect(pathCalls(calls, `/blocks/${ROOT}/children`)).toHaveLength(1)
    expect(pathCalls(calls, `/blocks/${ROOT}`)).toHaveLength(0)
    expect(calls.filter((c) => c.path.includes('/blocks/') && !c.path.endsWith('/children'))).toHaveLength(0)
    expect(calls).toHaveLength(2)
  })

  it('does not crawl ancestor pages or blocks for a nested page', async () => {
    const { client, calls } = mockClient(nestedPage)
    const { recordMap } = await getRecordMap(client, ROOT)
    expect(recordMap.block[ROOT]).toBeTruthy()
    expect(pathCalls(calls, `/pages/${PARENT}`)).toHaveLength(0)
    expect(pathCalls(calls, `/blocks/${PARENT}`)).toHaveLength(0)
    expect(pathCalls(calls, `/blocks/${PARENT}/children`)).toHaveLength(0)
    expect(pathCalls(calls, `/blocks/${ROOT}`)).toHaveLength(0)
  })

  it('does not pages.retrieve a child_page that already has an inline title', async () => {
    const { client, calls } = mockClient(nestedPage)
    const { recordMap } = await getRecordMap(client, ROOT)
    expect(recordMap.block[CHILD]).toBeTruthy()
    expect(pathCalls(calls, `/pages/${CHILD}`)).toHaveLength(0)
    expect(pathCalls(calls, `/blocks/${CHILD}`)).toHaveLength(0)
    expect(pathCalls(calls, `/blocks/${CHILD}/children`)).toHaveLength(0)
  })

  it('skips @mention fetches and retrieves link_to_page pages at most once', async () => {
    const { client, calls } = mockClient(nestedPage)
    const { recordMap } = await getRecordMap(client, ROOT)
    expect(pathCalls(calls, `/pages/${MENTION}`)).toHaveLength(0)
    expect(pathCalls(calls, `/blocks/${MENTION}`)).toHaveLength(0)
    expect(pathCalls(calls, `/pages/${LINKED}`)).toHaveLength(1)
    expect(pathCalls(calls, `/blocks/${LINKED}`)).toHaveLength(0)
    expect(pathCalls(calls, `/blocks/${LINKED}/children`)).toHaveLength(0)
    expect(recordMap.block[LINKED]).toBeTruthy()
    expect(recordMap.block[PARA2]).toBeTruthy()
  })

  it('defers toggle and toggleable heading_2 children until fetchBlockChildren', async () => {
    const { client, calls } = mockClient(nestedPage)
    const result = await getRecordMap(client, ROOT)
    expect(result.lazyBlockIds.sort()).toEqual([HEADING, TOGGLE].sort())
    expect(pathCalls(calls, `/blocks/${HEADING}/children`)).toHaveLength(0)
    expect(pathCalls(calls, `/blocks/${TOGGLE}/children`)).toHaveLength(0)
    expect(result.recordMap.block[INNER]).toBeFalsy()
    expect(result.recordMap.block[INNER2]).toBeFalsy()
    const heading = result.recordMap.block[HEADING] as { value?: { format?: { toggleable?: boolean }; content?: string[] } }
    expect(heading?.value?.format?.toggleable).toBe(true)
    expect(heading?.value?.content).toBeUndefined()

    const before = calls.length
    const children = await fetchBlockChildren(client, HEADING)
    expect(children.blockId).toBe(HEADING)
    expect(children.content).toEqual([INNER])
    expect(children.recordMap.block[INNER]).toBeTruthy()
    expect(pathCalls(calls.slice(before), `/blocks/${HEADING}/children`)).toHaveLength(1)
    expect(pathCalls(calls.slice(before), `/blocks/${HEADING}`)).toHaveLength(0)
    expect(pathCalls(calls.slice(before), `/pages/${PARENT}`)).toHaveLength(0)
  })

  it('does not share memoized reads across separate getRecordMap calls', async () => {
    const { client, calls } = mockClient((url, method) => {
      if (method !== 'GET') return undefined
      if (url.pathname === `/v1/pages/${ROOT}`) return pageObject(ROOT, 'Root', LAST)
      if (url.pathname === `/v1/blocks/${ROOT}/children`) {
        return childList([textBlock(PARA, ROOT, 'Hello world', LAST)])
      }
      return undefined
    })
    await getRecordMap(client, ROOT)
    await getRecordMap(client, ROOT)
    expect(pathCalls(calls, `/pages/${ROOT}`)).toHaveLength(2)
    expect(pathCalls(calls, `/blocks/${ROOT}/children`)).toHaveLength(2)
    expect(calls).toHaveLength(4)
  })
})

describe('GET /api/block/:id/children and search page_size', () => {
  it('returns lazy toggle children via handleGetBlockChildren', async () => {
    const { fetchFn } = mockClient(nestedPage)
    const orig = globalThis.fetch
    globalThis.fetch = fetchFn as typeof fetch
    try {
      const res = await handleGetBlockChildren(
        ctx(new Request('https://example.com/api/block/' + HEADING + '/children'), { id: HEADING })
      )
      expect(res.status).toBe(200)
      const data = (await res.json()) as {
        blockId: string
        content: string[]
        recordMap: { block: Record<string, unknown> }
      }
      expect(data.blockId).toBe(HEADING)
      expect(data.content).toEqual([INNER])
      expect(data.recordMap.block[INNER]).toBeTruthy()
    } finally {
      globalThis.fetch = orig
    }
  })

  it('requests up to 100 sidebar pages in a single search call', async () => {
    const { fetchFn, calls } = mockClient((url, method, body) => {
      if (url.pathname === '/v1/search' && method === 'POST') {
        return childList([pageObject(ROOT, 'Root', LAST)])
      }
      return undefined
    })
    const orig = globalThis.fetch
    globalThis.fetch = fetchFn as typeof fetch
    try {
      const res = await handleSearch(
        ctx(new Request('https://example.com/api/search'), {}, testEnv({ NOTION_ROOT_PAGE_ID: '' }))
      )
      expect(res.status).toBe(200)
      const search = calls.find((c) => c.path === '/v1/search')
      expect(search?.body).toMatchObject({ filter: { property: 'object', value: 'page' }, page_size: 100 })
    } finally {
      globalThis.fetch = orig
    }
  })
})
