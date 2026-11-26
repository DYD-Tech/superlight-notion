import type { Env } from '../../_lib/env'
import { handleOAuthCallback } from '../../_lib/oauthHandlers'

export const onRequestGet: PagesFunction<Env> = async (ctx) => {
  return handleOAuthCallback(ctx.request, ctx.env)
}
