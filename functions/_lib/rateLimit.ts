import { NOTION_RATE_PER_SEC } from '../../shared/types'

const FAST =
  (typeof process !== 'undefined' && Boolean((process as { env?: { VITEST?: string } }).env?.VITEST)) ||
  false

function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve()
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Per-instance scheduler: allows a burst of `perSecond` starts, then spaces
 * further starts by 1000/perSecond ms. Uses a promise chain + setTimeout only
 * (no Date.now(), no module-level shared queue). In Cloudflare Workers,
 * Date.now() can stay frozen between I/O events, so refill loops that wait
 * for the clock to move can stall; timer delays still fire.
 */
export class RateLimiter {
  private readonly perSecond: number
  private readonly intervalMs: number
  private tokens: number
  private gate: Promise<void> = Promise.resolve()

  constructor(perSecond = NOTION_RATE_PER_SEC) {
    this.perSecond = Math.max(1, perSecond)
    this.intervalMs = 1000 / this.perSecond
    this.tokens = this.perSecond
  }

  async schedule<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire()
    return fn()
  }

  private acquire(): Promise<void> {
    const granted = this.gate.then(() => this.takeSlot())
    this.gate = granted.then(
      () => undefined,
      () => undefined
    )
    return granted
  }

  private async takeSlot(): Promise<void> {
    if (this.tokens >= 1) {
      this.tokens -= 1
      return
    }
    await sleep(this.intervalMs)
  }
}

/** Build a limiter scoped to one client/request. In Vitest, default rate is raised so tests stay fast. */
export function createRateLimiter(perSecond?: number): RateLimiter {
  return new RateLimiter(perSecond ?? (FAST ? 10_000 : NOTION_RATE_PER_SEC))
}
