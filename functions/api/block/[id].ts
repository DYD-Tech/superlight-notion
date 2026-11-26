import { fromPages } from '../../_lib/context'
import type { Env } from '../../_lib/env'
import { handleDeleteBlock, handlePatchBlock } from '../../_lib/handlers'

export const onRequestPatch: PagesFunction<Env> = async (ctx) => {
  return handlePatchBlock(fromPages(ctx))
}

export const onRequestDelete: PagesFunction<Env> = async (ctx) => {
  return handleDeleteBlock(fromPages(ctx))
}
