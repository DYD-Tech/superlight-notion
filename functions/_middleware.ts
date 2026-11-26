import { requireAuth } from './_lib/auth'
import type { Env } from './_lib/env'

const PUBLIC_API = new Set(['/api/login'])

export const onRequest: PagesFunction<Env> = async (ctx) => {
  const url = new URL(ctx.request.url)
  if (url.pathname.startsWith('/api/') && !PUBLIC_API.has(url.pathname)) {
    const denied = await requireAuth(ctx.request, ctx.env)
    if (denied) return denied
  }
  return ctx.next()
}
