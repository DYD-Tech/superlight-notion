import { describe, expect, it, beforeEach } from 'vitest'
import { _clearMemoryCache, createCache, pageCacheKey } from '../functions/_lib/cache'
import type { Env } from '../functions/_lib/env'

const env = {} as Env

describe('cache store', () => {
  beforeEach(() => _clearMemoryCache())

  it('stores and reads values from memory', async () => {
    const cache = createCache(env, null)
    const key = pageCacheKey('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')
    expect(await cache.get(key)).toBeNull()
    await cache.set(key, '{"ok":true}', 60)
    expect(await cache.get(key)).toBe('{"ok":true}')
    await cache.delete(key)
    expect(await cache.get(key)).toBeNull()
  })

  it('expires memory entries', async () => {
    const cache = createCache(env, null)
    await cache.set('k', 'v', 0)
    // ttl 0 -> expires immediately (expires <= now)
    expect(await cache.get('k')).toBeNull()
  })
})
