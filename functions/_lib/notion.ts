import { NotionCompatAPI } from 'notion-compat'
import type { ExtendedRecordMap } from 'notion-types'
import { APPEND_CHILDREN_MAX } from '../../shared/types'
import { parsePageId, toUuid } from '../../shared/ids'
import { HttpError } from './env'
import { createRateLimiter } from './rateLimit'

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

export function createNotionClient(token: string, fetchFn: FetchLike = fetch): NotionClient {
  const limiter = createRateLimiter()
  const call = async <T>(method: string, path: string, body?: unknown): Promise<T> => {
    return limiter.schedule(async () => {
      const res = await fetchFn(`${API}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${token}`,
          'notion-version': NOTION_VERSION,
          'content-type': 'application/json'
        },
        body: body === undefined ? undefined : JSON.stringify(body)
      })
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
    })
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

export function createCompat(client: NotionClient): NotionCompatAPI {
  // NotionCompatAPI only needs pages.retrieve, blocks.retrieve, blocks.children.list.
  return new NotionCompatAPI(client as unknown as ConstructorParameters<typeof NotionCompatAPI>[0])
}

export async function getRecordMap(
  client: NotionClient,
  rawPageId: string
): Promise<{ pageId: string; recordMap: ExtendedRecordMap; lastEditedTime: string | null }> {
  const pageId = parsePageId(rawPageId) || toUuid(rawPageId)
  if (!pageId) {
    throw new HttpError(400, `无效的页面 ID: ${rawPageId}`)
  }
  const compat = createCompat(client)
  const recordMap = await compat.getPage(pageId)
  const lastEditedTime =
    ((recordMap as unknown as { raw?: { page?: { last_edited_time?: string } } }).raw?.page
      ?.last_edited_time as string | undefined) ||
    findBlockTime(recordMap, pageId)
  return { pageId, recordMap, lastEditedTime }
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
