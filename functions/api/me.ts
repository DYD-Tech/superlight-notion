import { toUuid } from '../../shared/ids'
import { json, type Env } from '../_lib/env'

export const onRequestGet: PagesFunction<Env> = async (ctx) => {
  const rootPageId = toUuid(ctx.env.NOTION_ROOT_PAGE_ID || '') 
  return json({
    ok: true,
    rootPageId,
    hasToken: Boolean(ctx.env.NOTION_TOKEN)
  })
}
