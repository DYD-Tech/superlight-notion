import type { Env } from '../../_lib/env'
import { handleOAuthStart } from '../../_lib/oauthHandlers'

export const onRequestGet: PagesFunction<Env> = async (ctx) => {
  return handleOAuthStart(ctx.request, ctx.env)
}
