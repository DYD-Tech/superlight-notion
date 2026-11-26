import { describe, expect, it } from 'vitest'
import {
  createCompat,
  createNotionClient,
  getRecordMap,
  type FetchLike
} from '../functions/_lib/notion'
import { PARA, PARA2, ROOT, jsonResponse, pageAsBlock, pageObject, textBlock } from './helpers'

const TOGGLE = '11111111-1111-1111-1111-111111111111'
const INNER = '22222222-2222-2222-2222-222222222222'
const CURSOR = 'cursor-page-2'
const LAST = '2026-01-02T00:00:00.000Z'

function richText(text: string) {
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
    }
  ]
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

function childList(results: unknown[], next_cursor: string | null = null) {
  return {
    object: 'list',
    results,
    next_cursor,
    has_more: Boolean(next_cursor)
  }
}

interface RecordedCall {
  method: string
  path: string
  search: string
}

function pathCalls(calls: RecordedCall[], suffix: string, method = 'GET') {
  return calls.filter((c) => c.method === method && c.path === `/v1${suffix}`)
}

function mockClient(handler: (url: URL, method: string) => unknown) {
  const calls: RecordedCall[] = []
  const fetchFn: FetchLike = async (input, init) => {
    const url = new URL(String(input))
    const method = (init?.method || 'GET').toUpperCase()
    calls.push({ method, path: url.pathname, search: url.searchParams.toString() })
    const data = handler(url, method)
    if (data === undefined) {
      return jsonResponse({ object: 'error', message: `unmocked ${method} ${url.pathname}` }, 404)
    }
    return jsonResponse(data)
  }
  return { client: createNotionClient('tok', fetchFn), calls }
}

function flatPageHandler(url: URL, method: string) {
  if (method !== 'GET') return undefined
  if (url.pathname === `/v1/pages/${ROOT}`) return pageObject(ROOT, 'Root', LAST)
  if (url.pathname === `/v1/blocks/${ROOT}`) return pageAsBlock(ROOT, 'Root')
  if (url.pathname === `/v1/blocks/${ROOT}/children`) {
    return childList([textBlock(PARA, ROOT, 'Hello world', LAST)])
  }
  if (url.pathname === `/v1/blocks/${PARA}`) return textBlock(PARA, ROOT, 'Hello world', LAST)
  return undefined
}

function nestedPageHandler(url: URL, method: string) {
  if (method !== 'GET') return undefined
  if (url.pathname === `/v1/pages/${ROOT}`) return pageObject(ROOT, 'Workbench', LAST)
  if (url.pathname === `/v1/blocks/${ROOT}`) return pageAsBlock(ROOT, 'Workbench')
  if (url.pathname === `/v1/blocks/${ROOT}/children`) {
    const cursor = url.searchParams.get('start_cursor')
    if (!cursor) return childList([toggleBlock(TOGGLE, ROOT, 'Section')], CURSOR)
    if (cursor === CURSOR) return childList([textBlock(PARA2, ROOT, 'Tail', LAST)])
    return childList([])
  }
  if (url.pathname === `/v1/blocks/${TOGGLE}`) return toggleBlock(TOGGLE, ROOT, 'Section')
  if (url.pathname === `/v1/blocks/${TOGGLE}/children`) {
    return childList([textBlock(INNER, TOGGLE, 'Nested', LAST)])
  }
  if (url.pathname === `/v1/blocks/${PARA2}`) return textBlock(PARA2, ROOT, 'Tail', LAST)
  if (url.pathname === `/v1/blocks/${INNER}`) return textBlock(INNER, TOGGLE, 'Nested', LAST)
  return undefined
}

describe('getRecordMap read dedup', () => {
  it('fetches pages, blocks, and root children exactly once for a flat page', async () => {
    const { client, calls } = mockClient(flatPageHandler)
    const undeduped = await createCompat(createNotionClient('tok', async (input, init) => {
      const url = new URL(String(input))
      const data = flatPageHandler(url, (init?.method || 'GET').toUpperCase())
      return jsonResponse(data ?? { message: 'unmocked' }, data ? 200 : 404)
    })).getPage(ROOT)

    const { pageId, recordMap, lastEditedTime } = await getRecordMap(client, ROOT)

    expect(pageId).toBe(ROOT)
    expect(lastEditedTime).toBe(LAST)
    expect(recordMap.raw).toEqual(undeduped.raw)
    expect(recordMap.block[ROOT]).toBeTruthy()
    expect(recordMap.block[PARA]).toBeTruthy()

    expect(pathCalls(calls, `/pages/${ROOT}`)).toHaveLength(1)
    expect(pathCalls(calls, `/blocks/${ROOT}`)).toHaveLength(1)
    expect(pathCalls(calls, `/blocks/${ROOT}/children`)).toHaveLength(1)
    expect(calls).toHaveLength(3)
  })

  it('dedupes root fetches while still loading nested and paginated children', async () => {
    const { client, calls } = mockClient(nestedPageHandler)
    const { pageId, recordMap, lastEditedTime } = await getRecordMap(client, ROOT)

    expect(pageId).toBe(ROOT)
    expect(lastEditedTime).toBe(LAST)
    expect((recordMap.raw as { page?: { id?: string } } | undefined)?.page?.id).toBe(ROOT)
    expect(recordMap.block[ROOT]).toBeTruthy()
    expect(recordMap.block[TOGGLE]).toBeTruthy()
    expect(recordMap.block[INNER]).toBeTruthy()
    expect(recordMap.block[PARA2]).toBeTruthy()

    const rootChildren = pathCalls(calls, `/blocks/${ROOT}/children`)
    expect(pathCalls(calls, `/pages/${ROOT}`)).toHaveLength(1)
    expect(pathCalls(calls, `/blocks/${ROOT}`)).toHaveLength(1)
    expect(rootChildren.filter((c) => !c.search)).toHaveLength(1)
    expect(rootChildren.filter((c) => c.search === `start_cursor=${CURSOR}`)).toHaveLength(1)
    expect(rootChildren).toHaveLength(2)
    expect(pathCalls(calls, `/blocks/${TOGGLE}/children`)).toHaveLength(1)
  })

  it('does not share memoized reads across separate getRecordMap calls', async () => {
    const { client, calls } = mockClient(flatPageHandler)
    await getRecordMap(client, ROOT)
    await getRecordMap(client, ROOT)

    expect(pathCalls(calls, `/pages/${ROOT}`)).toHaveLength(2)
    expect(pathCalls(calls, `/blocks/${ROOT}`)).toHaveLength(2)
    expect(pathCalls(calls, `/blocks/${ROOT}/children`)).toHaveLength(2)
    expect(calls).toHaveLength(6)
  })
})
