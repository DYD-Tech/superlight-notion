import { clearAuthCookies } from '../_lib/auth'
import { attachCookies, json, type Env } from '../_lib/env'

export const onRequestPost: PagesFunction<Env> = async (ctx) => {
  return attachCookies(json({ ok: true }), clearAuthCookies(ctx.request))
}

export const onRequestGet: PagesFunction<Env> = async (ctx) => {
  return attachCookies(json({ ok: true }), clearAuthCookies(ctx.request))
}
