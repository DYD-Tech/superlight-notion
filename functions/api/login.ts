import { sessionCookie, sessionToken } from '../_lib/auth'
import { json, passwordFallbackEnabled, type Env } from '../_lib/env'

export const onRequestPost: PagesFunction<Env> = async (ctx) => {
  if (!passwordFallbackEnabled(ctx.env)) {
    return json({ error: '未启用密码登录。请使用 Notion 登录。' }, 503)
  }
  let password = ''
  try {
    const body = (await ctx.request.json()) as { password?: string }
    password = body.password || ''
  } catch {
    return json({ error: '无效的请求' }, 400)
  }
  if (password !== ctx.env.APP_PASSWORD) {
    return json({ error: '密码不正确' }, 401)
  }
  const token = await sessionToken(ctx.env.APP_PASSWORD!)
  return json({ ok: true }, 200, { 'set-cookie': sessionCookie(token, ctx.request) })
}
