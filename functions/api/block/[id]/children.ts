import { fromPages } from '../../../_lib/context'
import type { Env } from '../../../_lib/env'
import { handleAppendChild } from '../../../_lib/handlers'

export const onRequestPost: PagesFunction<Env> = async (ctx) => {
  return handleAppendChild(fromPages(ctx))
}
