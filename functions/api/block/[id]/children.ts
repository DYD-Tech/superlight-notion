import { fromPages } from '../../../_lib/context'
import type { Env } from '../../../_lib/env'
import { handleAppendChild, handleGetBlockChildren } from '../../../_lib/handlers'

export const onRequestGet: PagesFunction<Env> = async (ctx) => {
  return handleGetBlockChildren(fromPages(ctx))
}

export const onRequestPost: PagesFunction<Env> = async (ctx) => {
  return handleAppendChild(fromPages(ctx))
}
