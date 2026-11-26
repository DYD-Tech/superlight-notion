import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRateLimiter, RateLimiter } from '../functions/_lib/rateLimit'

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

async function flushImmediate() {
  await vi.advanceTimersByTimeAsync(0)
}

describe('RateLimiter', () => {
  it('keeps two instances completely independent', async () => {
    vi.useFakeTimers()
    const a = createRateLimiter(1)
    const b = createRateLimiter(1)
    const started: string[] = []

    const tasks = [
      a.schedule(async () => {
        started.push('a0')
      }),
      a.schedule(async () => {
        started.push('a1')
      }),
      b.schedule(async () => {
        started.push('b0')
      }),
      b.schedule(async () => {
        started.push('b1')
      })
    ]

    await flushImmediate()
    expect([...started].sort()).toEqual(['a0', 'b0'])

    await vi.advanceTimersByTimeAsync(999)
    expect([...started].sort()).toEqual(['a0', 'b0'])

    await vi.advanceTimersByTimeAsync(1)
    expect([...started].sort()).toEqual(['a0', 'a1', 'b0', 'b1'])
    await Promise.all(tasks)
  })

  it('does not hang when Date.now() stays frozen across timer ticks', async () => {
    vi.useFakeTimers()
    const frozen = 1_700_000_000_000
    vi.spyOn(Date, 'now').mockReturnValue(frozen)

    const limiter = new RateLimiter(3)
    const started: number[] = []
    const tasks = Array.from({ length: 6 }, (_, i) =>
      limiter.schedule(async () => {
        started.push(i)
        return i
      })
    )

    await flushImmediate()
    expect(started).toEqual([0, 1, 2])
    expect(Date.now()).toBe(frozen)

    await vi.advanceTimersByTimeAsync(400)
    expect(started).toEqual([0, 1, 2, 3])
    expect(Date.now()).toBe(frozen)

    await vi.advanceTimersByTimeAsync(400)
    expect(started).toEqual([0, 1, 2, 3, 4])

    await vi.advanceTimersByTimeAsync(400)
    expect(started).toEqual([0, 1, 2, 3, 4, 5])
    await expect(Promise.all(tasks)).resolves.toEqual([0, 1, 2, 3, 4, 5])
  })
})
