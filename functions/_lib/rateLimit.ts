import { NOTION_RATE_PER_SEC } from '../../shared/types'

const FAST =
  (typeof process !== 'undefined' && Boolean((process as { env?: { VITEST?: string } }).env?.VITEST)) ||
  false


/** Token-bucket limiter aiming for ~3 Notion requests per second per isolate. */
export class RateLimiter {
  private tokens: number
  private last = Date.now()
  private queue: Array<() => void> = []
  private ticking = false

  constructor(private readonly perSecond = NOTION_RATE_PER_SEC) {
    this.tokens = perSecond
  }

  async schedule<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire()
    return fn()
  }

  private acquire(): Promise<void> {
    this.refill()
    if (this.tokens >= 1) {
      this.tokens -= 1
      return Promise.resolve()
    }
    return new Promise((resolve) => {
      this.queue.push(resolve)
      this.arm()
    })
  }

  private refill() {
    const now = Date.now()
    const elapsed = now - this.last
    if (elapsed <= 0) return
    this.tokens = Math.min(this.perSecond, this.tokens + (elapsed / 1000) * this.perSecond)
    this.last = now
  }

  private arm() {
    if (this.ticking) return
    this.ticking = true
    const wait = Math.max(20, Math.ceil(1000 / this.perSecond))
    setTimeout(() => {
      this.ticking = false
      this.refill()
      while (this.queue.length && this.tokens >= 1) {
        this.tokens -= 1
        this.queue.shift()!()
      }
      if (this.queue.length) this.arm()
    }, wait)
  }
}

export const notionLimiter = new RateLimiter(FAST ? 10_000 : NOTION_RATE_PER_SEC)
