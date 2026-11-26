import { afterEach, describe, expect, it, vi } from 'vitest'
import { HttpError } from '../functions/_lib/env'
import { createNotionClient, type FetchLike } from '../functions/_lib/notion'
import {
  DEFAULT_BACKOFF_MS,
  MAX_RETRY_AFTER_MS,
  parseRetryAfter,
  requestWith429Retry
} from '../functions/_lib/rateLimit'

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

function jsonRes(status: number, body: unknown = {}, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers }
  })
}

function recordSleep() {
  const waits: number[] = []
  const sleep = vi.fn(async (ms: number) => {
    waits.push(ms)
  })
  return { sleep, waits }
}

describe('parseRetryAfter', () => {
  it('parses numeric seconds and clamps to 10s', () => {
    expect(parseRetryAfter('2')).toBe(2000)
    expect(parseRetryAfter('0')).toBe(0)
    expect(parseRetryAfter('1.5')).toBe(1500)
    expect(parseRetryAfter('30')).toBe(MAX_RETRY_AFTER_MS)
    expect(parseRetryAfter(null)).toBeNull()
    expect(parseRetryAfter('')).toBeNull()
    expect(parseRetryAfter('nope')).toBeNull()
  })

  it('parses HTTP-date relative to now and clamps', () => {
    const now = Date.parse('Wed, 21 Oct 2015 07:28:00 GMT')
    expect(parseRetryAfter('Wed, 21 Oct 2015 07:28:03 GMT', now)).toBe(3000)
    expect(parseRetryAfter('Wed, 21 Oct 2015 07:27:00 GMT', now)).toBe(0)
    expect(parseRetryAfter('Wed, 21 Oct 2015 08:28:00 GMT', now)).toBe(MAX_RETRY_AFTER_MS)
  })
})

describe('requestWith429Retry', () => {
  it('returns non-429 responses immediately without sleeping', async () => {
    const { sleep, waits } = recordSleep()
    const send = vi.fn(async () => jsonRes(200, { ok: true }))
    const res = await requestWith429Retry(send, { sleep })
    expect(res.status).toBe(200)
    expect(send).toHaveBeenCalledTimes(1)
    expect(waits).toEqual([])
  })

  it('waits Retry-After on 429 and retries successfully', async () => {
    const { sleep, waits } = recordSleep()
    const send = vi
      .fn()
      .mockResolvedValueOnce(jsonRes(429, { message: 'slow down' }, { 'Retry-After': '2' }))
      .mockResolvedValueOnce(jsonRes(200, { ok: true }))
    const res = await requestWith429Retry(send, { sleep })
    expect(res.status).toBe(200)
    expect(send).toHaveBeenCalledTimes(2)
    expect(waits).toEqual([2000])
  })

  it('uses fallback exponential backoff when Retry-After is missing', async () => {
    const { sleep, waits } = recordSleep()
    const send = vi
      .fn()
      .mockResolvedValueOnce(jsonRes(429, { message: 'slow' }))
      .mockResolvedValueOnce(jsonRes(429, { message: 'slow' }))
      .mockResolvedValueOnce(jsonRes(200, { ok: true }))
    const res = await requestWith429Retry(send, { sleep, backoffMs: [...DEFAULT_BACKOFF_MS] })
    expect(res.status).toBe(200)
    expect(send).toHaveBeenCalledTimes(3)
    expect(waits).toEqual([500, 1000])
  })

  it('returns the last 429 after exhausting retries', async () => {
    const { sleep, waits } = recordSleep()
    const send = vi.fn(async () => jsonRes(429, { message: 'still limited' }))
    const res = await requestWith429Retry(send, { sleep, backoffMs: [...DEFAULT_BACKOFF_MS] })
    expect(res.status).toBe(429)
    expect(send).toHaveBeenCalledTimes(4)
    expect(waits).toEqual([500, 1000, 2000])
  })
})

describe('createNotionClient 429 handling', () => {
  it('fires more than 3 requests immediately with no 333ms pacing', async () => {
    const { sleep, waits } = recordSleep()
    let startedCount = 0
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const fetchFn: FetchLike = async () => {
      startedCount += 1
      if (startedCount === 6) release()
      await gate
      return jsonRes(200, { object: 'page', id: 'x' })
    }
    const client = createNotionClient('tok', fetchFn, { sleep })
    const ids = Array.from({ length: 6 }, (_, i) => `00000000-0000-0000-0000-00000000000${i}`)
    const done = Promise.all(ids.map((id) => client.pages.retrieve({ page_id: id })))
    await gate
    expect(startedCount).toBe(6)
    expect(waits).toEqual([])
    expect(sleep).not.toHaveBeenCalled()
    await done
  })

  it('retries a 429 with Retry-After then succeeds', async () => {
    const { sleep, waits } = recordSleep()
    const fetchFn = vi
      .fn<FetchLike>()
      .mockResolvedValueOnce(jsonRes(429, { message: 'rate limited' }, { 'Retry-After': '1' }))
      .mockResolvedValueOnce(jsonRes(200, { object: 'page', id: 'ok' }))
    const client = createNotionClient('tok', fetchFn, { sleep })
    const page = await client.pages.retrieve({ page_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' })
    expect(page.id).toBe('ok')
    expect(fetchFn).toHaveBeenCalledTimes(2)
    expect(waits).toEqual([1000])
  })

  it('retries a 429 without Retry-After using fallback backoff', async () => {
    const { sleep, waits } = recordSleep()
    const fetchFn = vi
      .fn<FetchLike>()
      .mockResolvedValueOnce(jsonRes(429, { message: 'rate limited' }))
      .mockResolvedValueOnce(jsonRes(200, { object: 'page', id: 'ok' }))
    const client = createNotionClient('tok', fetchFn, { sleep })
    await client.pages.retrieve({ page_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' })
    expect(fetchFn).toHaveBeenCalledTimes(2)
    expect(waits).toEqual([500])
  })

  it('throws HttpError 429 after retries are exhausted', async () => {
    const { sleep, waits } = recordSleep()
    const fetchFn = vi.fn<FetchLike>(async () => jsonRes(429, { message: 'still limited' }))
    const client = createNotionClient('tok', fetchFn, { sleep })
    await expect(
      client.pages.retrieve({ page_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' })
    ).rejects.toMatchObject({ name: 'HttpError', status: 429, message: 'still limited' } satisfies Partial<HttpError>)
    expect(fetchFn).toHaveBeenCalledTimes(4)
    expect(waits).toEqual([500, 1000, 2000])
  })

  it('does not retry non-429 errors', async () => {
    const { sleep } = recordSleep()
    for (const status of [401, 500] as const) {
      const fetchFn = vi.fn<FetchLike>(async () => jsonRes(status, { message: `err ${status}` }))
      const client = createNotionClient('tok', fetchFn, { sleep })
      await expect(
        client.pages.retrieve({ page_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' })
      ).rejects.toMatchObject({ name: 'HttpError', status, message: `err ${status}` })
      expect(fetchFn).toHaveBeenCalledTimes(1)
    }
    expect(sleep).not.toHaveBeenCalled()
  })

  it('keeps two clients independent: a 429 on one does not delay the other', async () => {
    const { sleep, waits } = recordSleep()
    const slow = vi
      .fn<FetchLike>()
      .mockResolvedValueOnce(jsonRes(429, { message: 'wait' }, { 'Retry-After': '5' }))
      .mockResolvedValueOnce(jsonRes(200, { object: 'page', id: 'slow' }))
    const fast = vi.fn<FetchLike>(async () => jsonRes(200, { object: 'page', id: 'fast' }))
    const a = createNotionClient('a', slow, { sleep })
    const b = createNotionClient('b', fast, { sleep })
    const [slowPage, fastPage] = await Promise.all([
      a.pages.retrieve({ page_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' }),
      b.pages.retrieve({ page_id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' })
    ])
    expect(fastPage.id).toBe('fast')
    expect(slowPage.id).toBe('slow')
    expect(fast).toHaveBeenCalledTimes(1)
    expect(slow).toHaveBeenCalledTimes(2)
    expect(waits).toEqual([5000])
  })
})
