import { splitRichTextItems } from '../../shared/richText'
import { toUuid, notionPageUrl } from '../../shared/ids'
import type { OfficialRichText, SearchPage } from '../../shared/types'
import { isEditableOfficialType } from '../../shared/types'
import {
  attachCookies,
  errorResponse,
  HttpError,
  json,
  oauthEnabled,
  type Env
} from './env'
import {
  createCache,
  invalidatePage,
  openCacheApi,
  pageCacheKey,
  PAGE_CACHE_TTL_SECONDS
} from './cache'
import {
  createNotionClient,
  getRecordMap,
  pageTitle,
  parentIdOf,
  type NotionClient,
  type OfficialBlock,
  type OfficialPage
} from './notion'
import { refreshIfNeeded, resolveAccessToken, type AccessResolution } from './auth'

export interface PagesContext {
  request: Request
  env: Env
  params: Record<string, string>
  waitUntil?: (p: Promise<unknown>) => void
}


async function withNotion(
  ctx: PagesContext,
  fn: (client: NotionClient, access: AccessResolution) => Promise<Response>
): Promise<Response> {
  try {
    let access = await resolveAccessToken(ctx.request, ctx.env)
    try {
      const res = await fn(createNotionClient(access.token), access)
      return attachCookies(res, access.cookies)
    } catch (err) {
      if (!(err instanceof HttpError) || err.status !== 401) throw err
      const refreshed = await refreshIfNeeded(ctx.env, ctx.request, access)
      if (!refreshed) throw err
      const res = await fn(createNotionClient(refreshed.token), refreshed)
      return attachCookies(res, refreshed.cookies)
    }
  } catch (err) {
    return errorResponse(err)
  }
}

export async function handleGetPage(ctx: PagesContext): Promise<Response> {
  const rawId = ctx.params.id || ''
  const pageId = toUuid(decodeURIComponent(rawId))
  if (!pageId) return json({ error: '无效的页面 ID' }, 400)
  return withNotion(ctx, async (client, access) => {
    const cache = createCache(ctx.env, await openCacheApi())
    const key = pageCacheKey(pageId, access.tenant)
    const hit = await cache.get(key)
    if (hit) {
      return new Response(hit, {
        status: 200,
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'x-cache': 'HIT',
          'cache-control': 'no-store'
        }
      })
    }
    const payload = await getRecordMap(client, pageId)
    const body = JSON.stringify(payload)
    const ttl = PAGE_CACHE_TTL_SECONDS
    ctx.waitUntil?.(cache.set(key, body, ttl))
    await cache.set(key, body, ttl)
    return new Response(body, {
      status: 200,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'x-cache': 'MISS',
        'cache-control': 'no-store'
      }
    })
  })
}

export async function handleSearch(ctx: PagesContext): Promise<Response> {
  const url = new URL(ctx.request.url)
  const q = (url.searchParams.get('q') || '').trim()
  const root = toUuid(ctx.env.NOTION_ROOT_PAGE_ID || '')
  return withNotion(ctx, async (client) => {
    const useSearch = oauthEnabled(ctx.env) || !root
    const pages = useSearch
      ? await listPagesBySearch(client, q)
      : await listPagesUnderRoot(client, root!, q)
    return json({ pages, rootPageId: root })
  })
}

async function listPagesBySearch(client: NotionClient, query: string): Promise<SearchPage[]> {
  const pages: SearchPage[] = []
  const seen = new Set<string>()
  let cursor: string | undefined
  let guard = 0
  do {
    const res = await client.search({
      query: query || undefined,
      filter: { property: 'object', value: 'page' },
      start_cursor: cursor,
      page_size: 50
    })
    for (const page of res.results as OfficialPage[]) {
      if (seen.has(page.id)) continue
      seen.add(page.id)
      pages.push({
        id: page.id,
        title: pageTitle(page),
        parentId: parentIdOf(page.parent)
      })
    }
    cursor = res.next_cursor ?? undefined
    guard += 1
  } while (cursor && pages.length < 200 && guard < 8)
  return pages
}

const WALK_MAX = 200
const WALK_DEPTH = 8

async function listPagesUnderRoot(
  client: NotionClient,
  rootId: string,
  query: string
): Promise<SearchPage[]> {
  const pages: SearchPage[] = []
  const seen = new Set<string>()

  async function walk(pageId: string, parentId: string | null, depth: number) {
    if (depth > WALK_DEPTH || pages.length >= WALK_MAX || seen.has(pageId)) return
    seen.add(pageId)
    let title = '无标题'
    try {
      const page = await client.pages.retrieve({ page_id: pageId })
      title = pageTitle(page)
    } catch {
      title = '无标题'
    }
    pages.push({ id: pageId, title, parentId })
    let cursor: string | undefined
    do {
      const res = await client.blocks.children.list({
        block_id: pageId,
        start_cursor: cursor,
        page_size: 100
      })
      for (const child of res.results) {
        if (child.type === 'child_page') {
          const childTitle =
            (child as OfficialBlock & { child_page?: { title?: string } }).child_page?.title ||
            '无标题'
          // Prefer the title from the child_page block to skip an extra retrieve when possible.
          if (!seen.has(child.id) && pages.length < WALK_MAX) {
            // Recurse to collect grandchildren; title may be overwritten by retrieve.
            void childTitle
            await walk(child.id, pageId, depth + 1)
          }
        }
      }
      cursor = res.next_cursor ?? undefined
    } while (cursor && pages.length < WALK_MAX)
  }

  await walk(rootId, null, 0)

  if (!query) return pages

  const lowered = query.toLowerCase()
  const filtered = pages.filter((p) => p.title.toLowerCase().includes(lowered))
  if (filtered.length) return filtered

  // Fallback: workspace search (still limited to pages the integration can see).
  const found: SearchPage[] = []
  const search = await client.search({
    query,
    filter: { property: 'object', value: 'page' },
    page_size: 20
  })
  const known = new Set(pages.map((p) => p.id))
  for (const page of search.results as OfficialPage[]) {
    if (known.has(page.id) || known.size === 0) {
      found.push({
        id: page.id,
        title: pageTitle(page),
        parentId: parentIdOf(page.parent)
      })
    }
  }
  // If the walk set is non-empty, keep only descendants; otherwise return search hits.
  return found.length ? found : filtered
}

export async function handlePatchBlock(ctx: PagesContext): Promise<Response> {
  const blockId = toUuid(decodeURIComponent(ctx.params.id || ''))
  if (!blockId) return json({ error: '无效的块 ID' }, 400)
  const body = (await ctx.request.json()) as {
    richText?: OfficialRichText[]
    checked?: boolean
    lastEditedTime?: string
    pageId?: string
  }
  return withNotion(ctx, async (client, access) => {
    const current = await client.blocks.retrieve({ block_id: blockId })
    if (body.lastEditedTime && current.last_edited_time && body.lastEditedTime !== current.last_edited_time) {
      return json(
        {
          error: 'conflict',
          message: '内容已在别处修改，请刷新',
          lastEditedTime: current.last_edited_time,
          block: current
        },
        409
      )
    }
    const type = current.type
    if (!isEditableOfficialType(type)) {
      return json({ error: `不支持编辑的块类型: ${type}` }, 400)
    }
    const patch: Record<string, unknown> = {}
    const fields: Record<string, unknown> = {}
    if (body.richText) {
      fields.rich_text = splitRichTextItems(body.richText)
    }
    if (type === 'to_do' && typeof body.checked === 'boolean') {
      fields.checked = body.checked
    }
    if (Object.keys(fields).length === 0) {
      return json({ error: '缺少 richText 或 checked' }, 400)
    }
    patch[type] = fields
    const updated = await client.blocks.update({ block_id: blockId, ...patch })
    await invalidateByPage(ctx, client, body.pageId, current, access.tenant)
    return json({ block: updated })
  })
}

export async function handleDeleteBlock(ctx: PagesContext): Promise<Response> {
  const blockId = toUuid(decodeURIComponent(ctx.params.id || ''))
  if (!blockId) return json({ error: '无效的块 ID' }, 400)
  const url = new URL(ctx.request.url)
  const pageId = url.searchParams.get('pageId')
  return withNotion(ctx, async (client, access) => {
    const current = await client.blocks.retrieve({ block_id: blockId })
    const deleted = await client.blocks.delete({ block_id: blockId })
    await invalidateByPage(ctx, client, pageId, current, access.tenant)
    return json({ block: deleted })
  })
}

export async function handleAppendChild(ctx: PagesContext): Promise<Response> {
  const afterId = toUuid(decodeURIComponent(ctx.params.id || ''))
  if (!afterId) return json({ error: '无效的块 ID' }, 400)
  const body = (await ctx.request.json().catch(() => ({}))) as {
    pageId?: string
    asChild?: boolean
    richText?: OfficialRichText[]
  }
  return withNotion(ctx, async (client, access) => {
    const current = await client.blocks.retrieve({ block_id: afterId })
    const rich_text = splitRichTextItems(body.richText ?? [])
    const children = [
      {
        object: 'block',
        type: 'paragraph',
        paragraph: { rich_text }
      }
    ]
    let parentId: string
    let after: string | undefined
    if (body.asChild) {
      parentId = afterId
      after = undefined
    } else {
      const p = parentIdOf(current.parent)
      if (!p) throw new HttpError(400, '无法确定该块的父级，不能插入')
      parentId = p
      after = afterId
    }
    const appended = await client.blocks.children.append({
      block_id: parentId,
      children,
      after
    })
    await invalidateByPage(ctx, client, body.pageId, current, access.tenant)
    return json({ results: appended.results, parentId })
  })
}

export async function handleImageProxy(ctx: PagesContext): Promise<Response> {
  try {
    const url = new URL(ctx.request.url)
    const raw = url.searchParams.get('u')
    if (!raw) return json({ error: '缺少 u 参数' }, 400)
    let target: URL
    try {
      target = new URL(raw)
    } catch {
      return json({ error: '无效的图片地址' }, 400)
    }
    if (!isAllowedImageHost(target)) {
      return json({ error: '不允许代理该地址' }, 400)
    }
    const cacheApi = await openCacheApi()
    if (cacheApi) {
      const cached = await cacheApi.match(ctx.request)
      if (cached) return cached
    }
    const upstream = await fetch(target.toString(), {
      headers: { accept: 'image/*,*/*;q=0.8' }
    })
    if (!upstream.ok) {
      return new Response(upstream.statusText, { status: upstream.status })
    }
    const headers = new Headers()
    const ct = upstream.headers.get('content-type') || 'application/octet-stream'
    if (!ct.startsWith('image/') && ct !== 'application/octet-stream' && !ct.includes('pdf')) {
      // Still allow typical Notion file content types.
    }
    headers.set('content-type', ct)
    headers.set('cache-control', 'public, max-age=3000')
    const res = new Response(upstream.body, { status: 200, headers })
    if (cacheApi && ctx.request.method === 'GET') {
      ctx.waitUntil?.(cacheApi.put(ctx.request, res.clone()))
    }
    return res
  } catch (err) {
    return errorResponse(err)
  }
}

export function isAllowedImageHost(target: URL): boolean {
  if (target.protocol !== 'https:') return false
  const host = target.hostname.toLowerCase()
  const allowedExact = new Set([
    'www.notion.so',
    'notion.so',
    'file.notion.so',
    'secure.notion-static.com',
    'prod-files-secure.s3.us-west-2.amazonaws.com',
    's3.us-west-2.amazonaws.com',
    's3-us-west-2.amazonaws.com'
  ])
  if (allowedExact.has(host)) return true
  if (host.endsWith('.notion-static.com')) return true
  if (host.endsWith('.amazonaws.com') && host.includes('files') && host.includes('notion')) return true
  if (host.endsWith('.amazonaws.com') && (host.startsWith('prod-files-secure') || host.includes('secure.notion'))) {
    return true
  }
  return false
}

export function openInNotionLink(id: string): string {
  return notionPageUrl(id)
}

async function invalidateByPage(
  ctx: PagesContext,
  client: NotionClient,
  pageId: string | null | undefined,
  block: OfficialBlock,
  tenant = 'internal'
) {
  const cache = createCache(ctx.env, await openCacheApi())
  const ids = new Set<string>()
  if (pageId && toUuid(pageId)) ids.add(toUuid(pageId)!)
  const parent = parentIdOf(block.parent)
  if (parent) ids.add(parent)
  if (block.parent?.type === 'page_id' && block.parent.page_id) ids.add(block.parent.page_id)
  // Walk one level up if the parent is a block — cheap best-effort invalidation.
  if (block.parent?.type === 'block_id' && block.parent.block_id) {
    try {
      const parentBlock = await client.blocks.retrieve({ block_id: block.parent.block_id })
      const page = parentIdOf(parentBlock.parent)
      if (page) ids.add(page)
      if (parentBlock.parent?.type === 'page_id' && parentBlock.parent.page_id) {
        ids.add(parentBlock.parent.page_id)
      }
    } catch {
      // ignore
    }
  }
  for (const id of ids) {
    await invalidatePage(cache, id, tenant)
  }
}
