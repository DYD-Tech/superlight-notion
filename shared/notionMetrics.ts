export const METRICS_WINDOW_MS = 60_000
export const METRICS_QUERY_WINDOW_MS = 1_000
export const STANDARD_BUDGET = 180
export const ENTERPRISE_BUDGET = 600
export const QUERY_LIMIT_PER_SEC = 3
export const MAX_RECENT_ACTIONS = 30
/** Hard cap so a busy 60s window cannot grow without bound (Enterprise budget is 600/min). */
export const MAX_WINDOW_EVENTS = ENTERPRISE_BUDGET + 50

export type NotionAction =
  | 'page_open'
  | 'sidebar_load'
  | 'database_query'
  | 'toggle_expand'
  | 'block_edit'
  | 'block_append'
  | 'block_delete'
  | 'unknown'

export type PlanBudget = typeof STANDARD_BUDGET | typeof ENTERPRISE_BUDGET

export interface NotionRequestEvent {
  t: number
  method: string
  endpoint: string
  query: boolean
  status: number
  rateLimitReason?: string
  action: NotionAction
}

export interface NotionActionBatch {
  action: NotionAction
  t: number
  cache: 'HIT' | 'MISS' | null
  requests: NotionRequestEvent[]
  label?: string
}

export interface MetricsSnapshot {
  windowMs: number
  used: number
  remaining: number
  budget: PlanBudget
  remainingStandard: number
  remainingEnterprise: number
  queryUsed1s: number
  queryLimitPerSec: number
  recent429: Array<{ t: number; endpoint: string; status: number; rateLimitReason?: string; action: NotionAction }>
  actions: NotionActionBatch[]
  note: string
}

export const RATE_LIMIT_NOTE =
  'Notion uses two-layer limiting: a per-connection (per-token) budget of 180 req/60s on Free/Plus or 600 req/60s on Business/Enterprise, plus a separate workspace-wide shared limit. Data source / database queries also have a distinct ~3 req/s cap per connection. Official docs describe a fixed budget per 60-second window (Retry-After is the time until the window resets, at most 60 seconds for the connection limit) but do not say whether that window is calendar-aligned.'

const ID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{32}/gi

export function templateNotionPath(path: string): string {
  const withPrefix = path.startsWith('http')
    ? new URL(path).pathname
    : path.startsWith('/v1')
      ? path
      : `/v1${path.startsWith('/') ? path : `/${path}`}`
  return withPrefix.split('?')[0]!.replace(ID_RE, ':id')
}

export function isNotionQueryPath(path: string): boolean {
  const pathname = (path.startsWith('http') ? new URL(path).pathname : path).split('?')[0] ?? path
  return /\/(databases|data_sources)\/[^/]+\/query$/.test(pathname) || pathname.endsWith('/query')
}

export function pruneEvents(events: NotionRequestEvent[], now: number, windowMs = METRICS_WINDOW_MS): NotionRequestEvent[] {
  const cut = now - windowMs
  return events.filter((event) => event.t >= cut)
}

export function usedInWindow(events: NotionRequestEvent[], now: number, windowMs = METRICS_WINDOW_MS): number {
  return pruneEvents(events, now, windowMs).length
}

export function queryUsedInWindow(
  events: NotionRequestEvent[],
  now: number,
  windowMs = METRICS_QUERY_WINDOW_MS
): number {
  return events.filter((event) => event.query && event.t >= now - windowMs).length
}

export function remainingBudget(used: number, budget: PlanBudget): number {
  return Math.max(0, budget - used)
}

export function recent429(events: NotionRequestEvent[], now: number, windowMs = METRICS_WINDOW_MS): MetricsSnapshot['recent429'] {
  return pruneEvents(events, now, windowMs)
    .filter((event) => event.status === 429 || event.status === 529)
    .map((event) => ({
      t: event.t,
      endpoint: event.endpoint,
      status: event.status,
      rateLimitReason: event.rateLimitReason,
      action: event.action
    }))
}

export function snapshotMetrics(
  events: NotionRequestEvent[],
  actions: NotionActionBatch[],
  now: number,
  budget: PlanBudget = STANDARD_BUDGET
): MetricsSnapshot {
  const used = usedInWindow(events, now)
  return {
    windowMs: METRICS_WINDOW_MS,
    used,
    remaining: remainingBudget(used, budget),
    budget,
    remainingStandard: remainingBudget(used, STANDARD_BUDGET),
    remainingEnterprise: remainingBudget(used, ENTERPRISE_BUDGET),
    queryUsed1s: queryUsedInWindow(events, now),
    queryLimitPerSec: QUERY_LIMIT_PER_SEC,
    recent429: recent429(events, now),
    actions: actions.slice(-MAX_RECENT_ACTIONS),
    note: RATE_LIMIT_NOTE
  }
}

export class MetricsRing {
  private events: NotionRequestEvent[] = []
  private actions: NotionActionBatch[] = []

  add(batch: NotionActionBatch): void {
    this.actions.push(batch)
    this.events.push(...batch.requests)
    this.prune(Date.now())
  }

  prune(now: number): void {
    this.events = pruneEvents(this.events, now)
    if (this.events.length > MAX_WINDOW_EVENTS) {
      this.events = this.events.slice(-MAX_WINDOW_EVENTS)
    }
    if (this.actions.length > MAX_RECENT_ACTIONS) {
      this.actions = this.actions.slice(-MAX_RECENT_ACTIONS)
    }
  }

  snapshot(now = Date.now(), budget: PlanBudget = STANDARD_BUDGET): MetricsSnapshot {
    this.prune(now)
    return snapshotMetrics(this.events, this.actions, now, budget)
  }

  /** Bound memory: events in the 60s window plus at most 30 action batches. */
  size(): { events: number; actions: number } {
    return { events: this.events.length, actions: this.actions.length }
  }

  clear(): void {
    this.events = []
    this.actions = []
  }

  labelLast(label: string): void {
    const last = this.actions.at(-1)
    if (last && !last.label) last.label = label
  }
}

export function endpointBreakdown(requests: NotionRequestEvent[]): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const req of requests) {
    const key = `${req.method} ${req.endpoint}`
    counts[key] = (counts[key] || 0) + 1
  }
  return counts
}
