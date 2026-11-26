import type { Env } from './env'

export const PAGE_CACHE_TTL_SECONDS = 120
export const IMAGE_CACHE_TTL_SECONDS = 50 * 60

const MEMORY = new Map<string, { body: string; expires: number }>()

export interface CacheStore {
  get(key: string): Promise<string | null>
  set(key: string, value: string, ttlSeconds: number): Promise<void>
  delete(key: string): Promise<void>
}

export function pageCacheKey(pageId: string, tenant = 'internal'): string {
  return `page:v2:${tenant}:${pageId}`
}

export function createCache(env: Env, cachesApi?: Cache | null): CacheStore {
  const kv = env.PAGE_CACHE
  return {
    async get(key) {
      const mem = MEMORY.get(key)
      if (mem && mem.expires > Date.now()) return mem.body
      if (mem) MEMORY.delete(key)
      if (kv) {
        const hit = await kv.get(key)
        if (hit) return hit
      }
      if (cachesApi) {
        const res = await cachesApi.match(cacheUrl(key))
        if (res && res.ok) return res.text()
      }
      return null
    },
    async set(key, value, ttlSeconds) {
      MEMORY.set(key, { body: value, expires: Date.now() + ttlSeconds * 1000 })
      if (kv) {
        await kv.put(key, value, { expirationTtl: Math.max(60, ttlSeconds) })
      }
      if (cachesApi) {
        await cachesApi.put(
          cacheUrl(key),
          new Response(value, {
            headers: {
              'content-type': 'application/json; charset=utf-8',
              'cache-control': `max-age=${ttlSeconds}`
            }
          })
        )
      }
    },
    async delete(key) {
      MEMORY.delete(key)
      if (kv) await kv.delete(key)
      if (cachesApi) await cachesApi.delete(cacheUrl(key))
    }
  }
}

export async function openCacheApi(): Promise<Cache | null> {
  try {
    if (typeof caches === 'undefined') return null
    const store = caches as CacheStorage & { default?: Cache }
    if (store.default) return store.default
    return await store.open('superlight-notion')
  } catch {
    return null
  }
}

export async function invalidatePage(store: CacheStore, pageId: string, tenant = 'internal'): Promise<void> {
  await store.delete(pageCacheKey(pageId, tenant))
}

function cacheUrl(key: string): string {
  return `https://superlight-notion.cache/${encodeURIComponent(key)}`
}

/** Test helper. */
export function _clearMemoryCache() {
  MEMORY.clear()
}
