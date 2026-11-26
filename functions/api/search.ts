import { fromPages } from '../_lib/context'
import type { Env } from '../_lib/env'
import { handleSearch } from '../_lib/handlers'

export const onRequestGet: PagesFunction<Env> = async (ctx) => {
  return handleSearch(fromPages(ctx))
}
