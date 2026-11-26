import { convertPage, NotionCompatAPI } from 'notion-compat'
import type { ExtendedRecordMap } from 'notion-types'
import { APPEND_CHILDREN_MAX } from '../../shared/types'
import { parsePageId, toUuid } from '../../shared/ids'
import { HttpError } from './env'
import { requestWith429Retry, type SleepFn } from './rateLimit'

export const NOTION_VERSION = '2022-06-28'
const API = 'https://api.notion.com/v1'

export interface NotionList<T> {
  object: 'list'
  results: T[]
  next_cursor: string | null
  has_more: boolean
}

export interface OfficialBlock {
  object: 'block'
  id: string
  type: string
  has_children?: boolean
  archived?: boolean
  in_trash?: boolean
  last_edited_time?: string
  created_time?: string
  parent?: {
    type: string
    page_id?: string
    block_id?: string
    database_id?: string
    workspace?: boolean
  }
  [key: string]: unknown
}

export interface OfficialPage {
  object: 'page'
  id: string
  last_edited_time?: string
  archived?: boolean
  parent?: OfficialBlock['parent']
  properties?: Record<string, unknown>
  url?: string
  icon?: unknown
  [key: string]: unknown
}

export type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

export interface NotionClient {
  pages: {
    retrieve: (args: { page_id: string }) => Promise<OfficialPage>
  }
  blocks: {
    retrieve: (args: { block_id: string }) => Promise<OfficialBlock>
    update: (args: { block_id: string } & Record<string, unknown>) => Promise<OfficialBlock>
    delete: (args: { block_id: string }) => Promise<OfficialBlock>
    children: {
      list: (args: {
        block_id: string
        start_cursor?: string
        page_size?: number
      }) => Promise<NotionList<OfficialBlock>>
      append: (args: {
        block_id: string
        children: unknown[]
        after?: string
      }) => Promise<NotionList<OfficialBlock>>
    }
  }
  search: (args: {
    query?: string
    filter?: { property: 'object'; value: 'page' | 'database' }
    start_cursor?: string
    page_size?: number
  }) => Promise<NotionList<OfficialPage>>
}

export function createNotionClient(
  token: string,
  fetchFn: FetchLike = fetch,
  opts: { sleep?: SleepFn } = {}
): NotionClient {
  const call = async <T>(method: string, path: string, body?: unknown): Promise<T> => {
    const res = await requestWith429Retry(
      () =>
        fetchFn(`${API}${path}`, {
          method,
          headers: {
            authorization: `Bearer ${token}`,
            'notion-version': NOTION_VERSION,
            'content-type': 'application/json'
          },
          body: body === undefined ? undefined : JSON.stringify(body)
        }),
      { sleep: opts.sleep }
    )
    const text = await res.text()
    let data: unknown = null
    if (text) {
      try {
        data = JSON.parse(text)
      } catch {
        data = { message: text }
      }
    }
    if (!res.ok) {
      const message =
        (data as { message?: string } | null)?.message || `Notion API ${res.status}`
      throw new HttpError(res.status, message, data)
    }
    return data as T
  }

  return {
    pages: {
      retrieve: ({ page_id }) => call('GET', `/pages/${page_id}`)
    },
    blocks: {
      retrieve: ({ block_id }) => call('GET', `/blocks/${block_id}`),
      update: ({ block_id, ...body }) => call('PATCH', `/blocks/${block_id}`, body),
      delete: ({ block_id }) => call('DELETE', `/blocks/${block_id}`),
      children: {
        list: ({ block_id, start_cursor, page_size }) => {
          const params = new URLSearchParams()
          if (start_cursor) params.set('start_cursor', start_cursor)
          if (page_size) params.set('page_size', String(page_size))
          const q = params.toString()
          return call('GET', `/blocks/${block_id}/children${q ? `?${q}` : ''}`)
        },
        append: ({ block_id, children, after }) => {
          if (children.length > APPEND_CHILDREN_MAX) {
            throw new HttpError(400, `一次最多插入 ${APPEND_CHILDREN_MAX} 个块`)
          }
          const body: Record<string, unknown> = { children }
          if (after) body.after = after
          return call('POST', `/blocks/${block_id}/children`, body)
        }
      }
    },
    search: (args) => call('POST', '/search', args)
  }
}

function memoizeRead<K, V>(map: Map<K, Promise<V>>, key: K, run: () => Promise<V>): Promise<V> {
  const existing = map.get(key)
  if (existing) return existing
  const pending = run()
  map.set(key, pending)
  return pending.catch((err) => {
    if (map.get(key) === pending) map.delete(key)
    throw err
  })
}

/**
 * Per-call wrapper that reuses in-flight/resolved read Promises so
 * NotionCompatAPI.getPage + resolvePage do not re-fetch the same endpoints.
 * Scoped to the returned client; no module-level shared state.
 */
export function withReadDedup(client: NotionClient): NotionClient {
  const pages = new Map<string, Promise<OfficialPage>>()
  const blocks = new Map<string, Promise<OfficialBlock>>()
  const children = new Map<string, Promise<NotionList<OfficialBlock>>>()

  return {
    pages: {
      retrieve: (args) => memoizeRead(pages, args.page_id, () => client.pages.retrieve(args))
    },
    blocks: {
      retrieve: (args) => memoizeRead(blocks, args.block_id, () => client.blocks.retrieve(args)),
      update: (args) => client.blocks.update(args),
      delete: (args) => client.blocks.delete(args),
      children: {
        list: (args) =>
          memoizeRead(
            children,
            `${args.block_id}\0${args.start_cursor ?? ''}\0${args.page_size ?? ''}`,
            () => client.blocks.children.list(args)
          ),
        append: (args) => client.blocks.children.append(args)
      }
    },
    search: (args) => client.search(args)
  }
}

export function createCompat(client: NotionClient): NotionCompatAPI {
  // NotionCompatAPI only needs pages.retrieve, blocks.retrieve, blocks.children.list.
  return new NotionCompatAPI(client as unknown as ConstructorParameters<typeof NotionCompatAPI>[0])
}

export const CHILDREN_PAGE_SIZE = 100
export const RESOLVE_CONCURRENCY = 4

export interface RecordMapResult {
  pageId: string
  recordMap: ExtendedRecordMap
  lastEditedTime: string | null
  lazyBlockIds: string[]
}

export interface BlockChildrenResult {
  blockId: string
  content: string[]
  recordMap: ExtendedRecordMap
  lazyBlockIds: string[]
}

export function isLazyToggleBlock(block: OfficialBlock): boolean {
  if (!block.has_children) return false
  if (block.type === 'toggle') return true
  if (block.type === 'heading_1' || block.type === 'heading_2' || block.type === 'heading_3') {
    const details = block[block.type] as { is_toggleable?: boolean } | undefined
    return details?.is_toggleable === true
  }
  return false
}

export function shouldExpandChildren(block: OfficialBlock): boolean {
  if (!block.has_children) return false
  if (block.type === 'child_database' || block.type === 'child_page') return false
  if (isLazyToggleBlock(block)) return false
  return true
}

function linkToPageId(block: OfficialBlock): string | null {
  if (block.type !== 'link_to_page') return null
  const link = (
    block as OfficialBlock & { link_to_page?: { type?: string; page_id?: string } }
  ).link_to_page
  if (link?.type === 'page_id' && link.page_id) return link.page_id
  return null
}

class ConcurrencyLimit {
  private running = 0
  private readonly waiters: Array<() => void> = []
  constructor(private readonly max: number) {}
  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.running >= this.max) {
      await new Promise<void>((resolve) => this.waiters.push(resolve))
    }
    this.running += 1
    try {
      return await fn()
    } finally {
      this.running -= 1
      this.waiters.shift()?.()
    }
  }
}

export async function listAllChildren(
  client: NotionClient,
  blockId: string
): Promise<OfficialBlock[]> {
  const results: OfficialBlock[] = []
  let cursor: string | undefined
  do {
    const res = await client.blocks.children.list({
      block_id: blockId,
      start_cursor: cursor,
      page_size: CHILDREN_PAGE_SIZE
    })
    results.push(...res.results)
    cursor = res.has_more && res.next_cursor ? res.next_cursor : undefined
  } while (cursor)
  return results
}

interface LeanMaps {
  blockMap: Record<string, OfficialBlock>
  blockChildrenMap: Record<string, string[]>
  pageMap: Record<string, OfficialPage>
  parentMap: Record<string, string>
  lazyBlockIds: string[]
  rootChildren: OfficialBlock[]
}

async function resolveLean(client: NotionClient, rootId: string, seedPage?: OfficialPage): Promise<LeanMaps> {
  const blockMap: Record<string, OfficialBlock> = {}
  const blockChildrenMap: Record<string, string[]> = {}
  const pageMap: Record<string, OfficialPage> = {}
  const parentMap: Record<string, string> = {}
  const lazyBlockIds: string[] = []
  const seenLazy = new Set<string>()
  const limit = new ConcurrencyLimit(RESOLVE_CONCURRENCY)

  if (seedPage) pageMap[seedPage.id] = seedPage

  async function ingest(parentId: string, children: OfficialBlock[]): Promise<void> {
    blockChildrenMap[parentId] = children.map((child) => child.id)
    const jobs: Promise<void>[] = []
    for (const child of children) {
      blockMap[child.id] = child
      parentMap[child.id] = parentId
      if (isLazyToggleBlock(child)) {
        if (!seenLazy.has(child.id)) {
          seenLazy.add(child.id)
          lazyBlockIds.push(child.id)
        }
        continue
      }
      const linked = linkToPageId(child)
      if (linked) {
        jobs.push(
          limit.run(async () => {
            if (pageMap[linked]) return
            try {
              const page = await client.pages.retrieve({ page_id: linked })
              pageMap[page.id] = page
            } catch {
              // Alias still renders without a title if the retrieve fails.
            }
          })
        )
      }
      if (shouldExpandChildren(child)) {
        jobs.push(limit.run(() => expand(child.id)))
      }
    }
    await Promise.all(jobs)
  }

  async function expand(blockId: string): Promise<void> {
    if (blockChildrenMap[blockId]) return
    const children = await listAllChildren(client, blockId)
    await ingest(blockId, children)
  }

  const rootChildren = await listAllChildren(client, rootId)
  await ingest(rootId, rootChildren)
  return { blockMap, blockChildrenMap, pageMap, parentMap, lazyBlockIds, rootChildren }
}

function toCompatMaps(maps: LeanMaps) {
  return {
    blockMap: maps.blockMap as unknown as Parameters<typeof convertPage>[0]['blockMap'],
    blockChildrenMap: maps.blockChildrenMap,
    pageMap: maps.pageMap as unknown as Parameters<typeof convertPage>[0]['pageMap'],
    parentMap: maps.parentMap
  }
}

function applyToggleableFormat(recordMap: ExtendedRecordMap, blockMap: Record<string, OfficialBlock>) {
  for (const block of Object.values(blockMap)) {
    if (block.type !== 'heading_1' && block.type !== 'heading_2' && block.type !== 'heading_3') continue
    const details = block[block.type] as { is_toggleable?: boolean } | undefined
    if (!details?.is_toggleable) continue
    const wrap = recordMap.block[block.id] as { value?: { format?: Record<string, unknown> } } | undefined
    if (!wrap?.value) continue
    wrap.value.format = { ...(wrap.value.format ?? {}), toggleable: true }
  }
}

function buildRecordMap(pageId: string, maps: LeanMaps, raw?: unknown): ExtendedRecordMap {
  const recordMap = convertPage({ pageId, ...toCompatMaps(maps) })
  applyToggleableFormat(recordMap, maps.blockMap)
  if (raw !== undefined) {
    ;(recordMap as unknown as { raw?: unknown }).raw = raw
  }
  return recordMap
}

export async function fetchRecordMap(client: NotionClient, rawPageId: string): Promise<RecordMapResult> {
  const pageId = parsePageId(rawPageId) || toUuid(rawPageId)
  if (!pageId) {
    throw new HttpError(400, `无效的页面 ID: ${rawPageId}`)
  }
  const deduped = withReadDedup(client)
  const page = await deduped.pages.retrieve({ page_id: pageId })
  const maps = await resolveLean(deduped, pageId, page)
  const recordMap = buildRecordMap(pageId, maps, { page, children: maps.rootChildren })
  const lastEditedTime = page.last_edited_time || findBlockTime(recordMap, pageId)
  return { pageId, recordMap, lastEditedTime, lazyBlockIds: maps.lazyBlockIds }
}

export async function fetchBlockChildren(
  client: NotionClient,
  rawBlockId: string
): Promise<BlockChildrenResult> {
  const blockId = parsePageId(rawBlockId) || toUuid(rawBlockId)
  if (!blockId) {
    throw new HttpError(400, `无效的块 ID: ${rawBlockId}`)
  }
  const maps = await resolveLean(withReadDedup(client), blockId)
  const recordMap = buildRecordMap(blockId, maps)
  return {
    blockId,
    content: maps.blockChildrenMap[blockId] ?? [],
    recordMap,
    lazyBlockIds: maps.lazyBlockIds
  }
}

export async function getRecordMap(client: NotionClient, rawPageId: string): Promise<RecordMapResult> {
  return fetchRecordMap(client, rawPageId)
}

function findBlockTime(recordMap: ExtendedRecordMap, pageId: string): string | null {
  const entry = recordMap.block?.[pageId] as { value?: { last_edited_time?: string | number } } | undefined
  const t = entry?.value?.last_edited_time
  if (typeof t === 'string') return t
  if (typeof t === 'number') return new Date(t).toISOString()
  return null
}

export function pageTitle(page: OfficialPage): string {
  const props = page.properties ?? {}
  for (const value of Object.values(props)) {
    const v = value as { type?: string; title?: Array<{ plain_text?: string; text?: { content?: string } }> }
    if (v?.type === 'title' || v?.title) {
      return (v.title ?? []).map((t) => t.plain_text || t.text?.content || '').join('') || '无标题'
    }
  }
  return '无标题'
}

export function parentIdOf(parent: OfficialBlock['parent'] | undefined): string | null {
  if (!parent) return null
  if (parent.type === 'page_id') return parent.page_id ?? null
  if (parent.type === 'block_id') return parent.block_id ?? null
  if (parent.type === 'database_id') return parent.database_id ?? null
  return null
}
