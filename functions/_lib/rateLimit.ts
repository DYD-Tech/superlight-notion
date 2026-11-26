export const MAX_429_RETRIES = 3
export const MAX_RETRY_AFTER_MS = 10_000
export const DEFAULT_BACKOFF_MS = [500, 1000, 2000] as const

export type SleepFn = (ms: number) => Promise<void>

export function defaultSleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve()
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Parse Retry-After as seconds or HTTP-date. Returns milliseconds, or null if missing/invalid. Clamped to [0, 10s]. */
export function parseRetryAfter(header: string | null | undefined, now = Date.now()): number | null {
  if (header == null) return null
  const raw = header.trim()
  if (!raw) return null
  if (/^\d+(\.\d+)?$/.test(raw)) {
    const ms = Number(raw) * 1000
    if (!Number.isFinite(ms) || ms < 0) return null
    return clampRetryMs(ms)
  }
  const at = Date.parse(raw)
  if (Number.isNaN(at)) return null
  return clampRetryMs(at - now)
}

function clampRetryMs(ms: number): number {
  if (!Number.isFinite(ms)) return 0
  return Math.min(MAX_RETRY_AFTER_MS, Math.max(0, ms))
}

export interface Retry429Options {
  sleep?: SleepFn
  maxRetries?: number
  backoffMs?: number[]
  now?: () => number
}

/**
 * Send a request immediately (no pre-emptive pacing). Only waits and retries
 * when Notion returns HTTP 429. Per-call; no shared module state.
 */
export async function requestWith429Retry(
  send: () => Promise<Response>,
  opts: Retry429Options = {}
): Promise<Response> {
  const sleep = opts.sleep ?? defaultSleep
  const maxRetries = opts.maxRetries ?? MAX_429_RETRIES
  const backoff = opts.backoffMs ?? [...DEFAULT_BACKOFF_MS]

  let attempt = 0
  while (true) {
    const res = await send()
    if (res.status !== 429 || attempt >= maxRetries) return res
    const fromHeader = parseRetryAfter(res.headers.get('Retry-After'), opts.now?.() ?? Date.now())
    const wait = fromHeader ?? backoff[Math.min(attempt, backoff.length - 1)] ?? DEFAULT_BACKOFF_MS[0]
    await sleep(wait)
    attempt += 1
  }
}
