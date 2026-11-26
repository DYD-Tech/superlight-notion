import type { Env } from './env'
import type { PagesContext } from './handlers'

export function fromPages(ctx: EventContext<Env, string, unknown>): PagesContext {
  return {
    request: ctx.request,
    env: ctx.env,
    params: ctx.params as Record<string, string>,
    waitUntil: (p) => ctx.waitUntil(p)
  }
}
