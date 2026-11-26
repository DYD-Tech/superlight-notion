import { fromPages } from '../_lib/context'
import type { Env } from '../_lib/env'
import { handleImageProxy } from '../_lib/handlers'

export const onRequestGet: PagesFunction<Env> = async (ctx) => {
  return handleImageProxy(fromPages(ctx))
}
