import type { NotionAction, NotionActionBatch, NotionRequestEvent, PlanBudget } from '../../shared/notionMetrics'
import {
  MetricsRing,
  STANDARD_BUDGET,
  isNotionQueryPath,
  templateNotionPath
} from '../../shared/notionMetrics'

export type { NotionAction, NotionRequestEvent, NotionActionBatch }

const isolateRing = new MetricsRing()

export class RequestMetrics {
  readonly action: NotionAction
  readonly startedAt = Date.now()
  readonly events: NotionRequestEvent[] = []

  constructor(action: NotionAction) {
    this.action = action
  }

  record(event: Omit<NotionRequestEvent, 'action' | 't'> & { t?: number; action?: NotionAction }): void {
    this.events.push({
      t: event.t ?? Date.now(),
      method: event.method,
      endpoint: event.endpoint,
      query: event.query,
      status: event.status,
      rateLimitReason: event.rateLimitReason,
      action: event.action ?? this.action
    })
  }
}

export function createRequestMetrics(action: NotionAction): RequestMetrics {
  return new RequestMetrics(action)
}

export async function peekRateLimitReason(res: Response): Promise<string | undefined> {
  const header =
    res.headers.get('x-notion-rate-limit-reason') ||
    res.headers.get('x-rate-limit-reason') ||
    undefined
  try {
    const data = (await res.clone().json()) as { rate_limit_reason?: unknown; code?: unknown } | null
    if (data && typeof data.rate_limit_reason === 'string' && data.rate_limit_reason) {
      return data.rate_limit_reason
    }
    if (data && typeof data.code === 'string' && data.code) return data.code
  } catch {
    // ignore non-JSON bodies
  }
  return header
}

export function describeNotionCall(method: string, path: string): { endpoint: string; query: boolean } {
  void method
  return { endpoint: templateNotionPath(path), query: isNotionQueryPath(path) }
}

export function rememberMetrics(metrics: RequestMetrics, cache: NotionActionBatch['cache']): NotionActionBatch {
  const batch: NotionActionBatch = {
    action: metrics.action,
    t: metrics.startedAt,
    cache,
    requests: metrics.events.slice()
  }
  isolateRing.add(batch)
  return batch
}

export function debugMetricsPayload(budget: PlanBudget = STANDARD_BUDGET) {
  return isolateRing.snapshot(Date.now(), budget)
}

export function _resetIsolateMetrics() {
  isolateRing.clear()
}

export function attachMetrics(res: Response, metrics: RequestMetrics): Promise<Response> {
  const cacheHeader = (res.headers.get('x-cache') || '').toUpperCase()
  const cache: NotionActionBatch['cache'] = cacheHeader === 'HIT' ? 'HIT' : cacheHeader === 'MISS' ? 'MISS' : null
  const batch = rememberMetrics(metrics, cache)
  const headers = new Headers(res.headers)
  headers.set('X-Notion-Requests', String(batch.requests.length))
  headers.set('X-Notion-Action', metrics.action)
  const ct = headers.get('content-type') || ''
  if (!ct.includes('application/json')) {
    return Promise.resolve(new Response(res.body, { status: res.status, headers }))
  }
  return res.text().then((text) => {
    let body: unknown = text
    try {
      body = text ? JSON.parse(text) : {}
    } catch {
      return new Response(text, { status: res.status, headers })
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return new Response(text, { status: res.status, headers })
    }
    const next = {
      ...(body as Record<string, unknown>),
      meta: {
        cache,
        action: batch.action,
        notionRequests: batch.requests
      }
    }
    return new Response(JSON.stringify(next), { status: res.status, headers })
  })
}
