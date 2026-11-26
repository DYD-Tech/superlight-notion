import { describe, expect, it } from 'vitest'
import {
  ENTERPRISE_BUDGET,
  MAX_RECENT_ACTIONS,
  MAX_WINDOW_EVENTS,
  METRICS_WINDOW_MS,
  MetricsRing,
  STANDARD_BUDGET,
  isNotionQueryPath,
  remainingBudget,
  snapshotMetrics,
  templateNotionPath,
  usedInWindow,
  type NotionActionBatch,
  type NotionRequestEvent
} from '../shared/notionMetrics'
import {
  RequestMetrics,
  _resetIsolateMetrics,
  attachMetrics,
  debugMetricsPayload,
  describeNotionCall
} from '../functions/_lib/notionMetrics'
import { createNotionClient, type FetchLike } from '../functions/_lib/notion'
import { handleDebugMetrics, handleGetPage } from '../functions/_lib/handlers'
import { _clearMemoryCache } from '../functions/_lib/cache'
import { ctx, jsonResponse, pageObject, ROOT, textBlock, testEnv } from './helpers'

function ev(partial: Partial<NotionRequestEvent> & { t: number }): NotionRequestEvent {
  return {
    method: 'GET',
    endpoint: '/v1/pages/:id',
    query: false,
    status: 200,
    action: 'page_open',
    ...partial
  }
}

describe('path templating and window math', () => {
  it('templates official endpoints and detects database queries', () => {
    expect(templateNotionPath(`/pages/${ROOT}`)).toBe('/v1/pages/:id')
    expect(templateNotionPath(`/v1/blocks/${ROOT}/children?page_size=100`)).toBe('/v1/blocks/:id/children')
    expect(templateNotionPath(`/v1/databases/${ROOT}/query`)).toBe('/v1/databases/:id/query')
    expect(templateNotionPath('/search')).toBe('/v1/search')
    expect(isNotionQueryPath(`/v1/databases/${ROOT}/query`)).toBe(true)
    expect(isNotionQueryPath(`/v1/data_sources/${ROOT}/query`)).toBe(true)
    expect(isNotionQueryPath(`/v1/pages/${ROOT}`)).toBe(false)
    expect(describeNotionCall('POST', `/databases/${ROOT}/query`)).toEqual({
      endpoint: '/v1/databases/:id/query',
      query: true
    })
  })

  it('counts used/remaining in a rolling 60s window and query bursts in 1s', () => {
    const now = 1_000_000
    const events = [
      ev({ t: now - METRICS_WINDOW_MS - 1 }),
      ev({ t: now - 10, method: 'GET', endpoint: '/v1/pages/:id' }),
      ev({ t: now - 200, method: 'POST', endpoint: '/v1/databases/:id/query', query: true, action: 'toggle_expand' }),
      ev({
        t: now - 100,
        method: 'POST',
        endpoint: '/v1/databases/:id/query',
        query: true,
        status: 429,
        rateLimitReason: 'rate_limited',
        action: 'toggle_expand'
      })
    ]
    expect(usedInWindow(events, now)).toBe(3)
    expect(remainingBudget(3, STANDARD_BUDGET)).toBe(177)
    expect(remainingBudget(3, ENTERPRISE_BUDGET)).toBe(597)
    const snap = snapshotMetrics(events, [], now, STANDARD_BUDGET)
    expect(snap.remaining).toBe(177)
    expect(snap.queryUsed1s).toBe(2)
    expect(snap.recent429).toHaveLength(1)
    expect(snap.recent429[0]?.rateLimitReason).toBe('rate_limited')
  })

  it('keeps the ring buffer bounded to 30 actions and a 60s event window', () => {
    const ring = new MetricsRing()
    const now = Date.now()
    for (let i = 0; i < 40; i++) {
      const batch: NotionActionBatch = {
        action: 'page_open',
        t: now,
        cache: 'MISS',
        requests: [ev({ t: now })]
      }
      ring.add(batch)
    }
    ring.add({
      action: 'sidebar_load',
      t: now - METRICS_WINDOW_MS - 5_000,
      cache: 'MISS',
      requests: [ev({ t: now - METRICS_WINDOW_MS - 5_000, action: 'sidebar_load' })]
    })
    expect(ring.size().actions).toBe(MAX_RECENT_ACTIONS)
    expect(ring.size().events).toBeLessThanOrEqual(MAX_WINDOW_EVENTS)
    expect(ring.snapshot(now).actions).toHaveLength(MAX_RECENT_ACTIONS)

    const flood = new MetricsRing()
    for (let i = 0; i < MAX_WINDOW_EVENTS + 80; i++) {
      flood.add({
        action: 'page_open',
        t: now,
        cache: 'MISS',
        requests: [ev({ t: now })]
      })
    }
    expect(flood.size().events).toBe(MAX_WINDOW_EVENTS)
    expect(flood.size().actions).toBe(MAX_RECENT_ACTIONS)
  })
})

describe('client recording and debug endpoint', () => {
  it('records outbound Notion calls including 429 retries and rate_limit_reason', async () => {
    const metrics = new RequestMetrics('page_open')
    let n = 0
    const fetchFn: FetchLike = async () => {
      n += 1
      if (n === 1) {
        return jsonResponse({ object: 'error', code: 'rate_limited', rate_limit_reason: 'rate_limited' }, 429)
      }
      return jsonResponse(pageObject(ROOT, 'Root'))
    }
    const client = createNotionClient('tok', fetchFn, { metrics, sleep: async () => undefined })
    await client.pages.retrieve({ page_id: ROOT })
    expect(metrics.events).toHaveLength(2)
    expect(metrics.events[0]).toMatchObject({
      method: 'GET',
      endpoint: '/v1/pages/:id',
      status: 429,
      rateLimitReason: 'rate_limited',
      action: 'page_open'
    })
    expect(metrics.events[1]?.status).toBe(200)
  })

  it('adds meta.notionRequests and X-Notion-Requests, and reports cache hits as 0 req', async () => {
    _clearMemoryCache()
    _resetIsolateMetrics()
    const orig = globalThis.fetch
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = new URL(String(input))
      if (url.pathname === `/v1/pages/${ROOT}`) return jsonResponse(pageObject(ROOT, 'Root'))
      if (url.pathname === `/v1/blocks/${ROOT}/children`) {
        return jsonResponse({
          object: 'list',
          results: [textBlock('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', ROOT, 'Hi')],
          next_cursor: null,
          has_more: false
        })
      }
      return jsonResponse({ object: 'error', message: 'unmocked' }, 404)
    }) as typeof fetch
    try {
      const miss = await handleGetPage(ctx(new Request(`https://example.com/api/page/${ROOT}`), { id: ROOT }))
      expect(miss.status).toBe(200)
      expect(miss.headers.get('X-Notion-Requests')).toBeTruthy()
      expect(Number(miss.headers.get('X-Notion-Requests'))).toBeGreaterThan(0)
      expect(miss.headers.get('X-Notion-Action')).toBe('page_open')
      const missBody = (await miss.json()) as {
        meta: { cache: string; action: string; notionRequests: Array<{ endpoint: string; method: string }> }
      }
      expect(missBody.meta.cache).toBe('MISS')
      expect(missBody.meta.action).toBe('page_open')
      expect(missBody.meta.notionRequests.some((r) => r.endpoint === '/v1/pages/:id')).toBe(true)
      expect(missBody.meta.notionRequests.some((r) => r.endpoint === '/v1/blocks/:id/children')).toBe(true)

      const hit = await handleGetPage(ctx(new Request(`https://example.com/api/page/${ROOT}`), { id: ROOT }))
      expect(hit.headers.get('X-Notion-Requests')).toBe('0')
      const hitBody = (await hit.json()) as { meta: { cache: string; notionRequests: unknown[] } }
      expect(hitBody.meta.cache).toBe('HIT')
      expect(hitBody.meta.notionRequests).toEqual([])
    } finally {
      globalThis.fetch = orig
    }
  })

  it('requires auth on GET /api/debug/metrics and never returns tokens', async () => {
    _resetIsolateMetrics()
    const unauth = await handleDebugMetrics(
      ctx(new Request('https://example.com/api/debug/metrics'), {}, testEnv({ NOTION_TOKEN: undefined, APP_PASSWORD: undefined }))
    )
    expect(unauth.status).toBe(401)

    const ok = await handleDebugMetrics(ctx(new Request('https://example.com/api/debug/metrics')))
    expect(ok.status).toBe(200)
    const body = (await ok.json()) as { used: number; remainingStandard: number; note: string }
    expect(body.remainingStandard).toBeGreaterThanOrEqual(0)
    expect(body.note).toMatch(/two-layer|per-connection|60/)
    const text = JSON.stringify(body)
    expect(text.includes('secret_')).toBe(false)
    expect(text.toLowerCase().includes('bearer')).toBe(false)
  })

  it('attaches metrics meta without leaking page contents into the isolate snapshot fields', async () => {
    _resetIsolateMetrics()
    const metrics = new RequestMetrics('sidebar_load')
    metrics.record({
      method: 'POST',
      endpoint: '/v1/search',
      query: false,
      status: 200
    })
    const res = await attachMetrics(
      new Response(JSON.stringify({ pages: [{ id: ROOT, title: 'Secret page' }] }), {
        headers: { 'content-type': 'application/json' }
      }),
      metrics
    )
    expect(res.headers.get('X-Notion-Requests')).toBe('1')
    const body = (await res.json()) as { pages: unknown[]; meta: { notionRequests: unknown[] } }
    expect(body.pages).toHaveLength(1)
    expect(body.meta.notionRequests).toHaveLength(1)
    const snap = debugMetricsPayload()
    expect(JSON.stringify(snap)).not.toContain('Secret page')
  })
})
