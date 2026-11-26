import { fromPages } from '../../_lib/context'
import type { Env } from '../../_lib/env'
import { handleGetPage } from '../../_lib/handlers'

export const onRequestGet: PagesFunction<Env> = async (ctx) => {
  return handleGetPage(fromPages(ctx))
}
