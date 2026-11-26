import { toUuid } from '../../shared/ids'
import { getAuth } from '../_lib/auth'
import { json, oauthEnabled, passwordFallbackEnabled, type Env } from '../_lib/env'

export const onRequestGet: PagesFunction<Env> = async (ctx) => {
  const auth = await getAuth(ctx.request, ctx.env)
  const base = {
    oauthEnabled: oauthEnabled(ctx.env),
    passwordEnabled: passwordFallbackEnabled(ctx.env)
  }
  if (!auth) {
    return json({ ok: false, ...base })
  }
  if (auth.mode === 'oauth' && auth.session) {
    return json({
      ok: true,
      mode: 'oauth' as const,
      workspaceName: auth.session.workspaceName,
      workspaceId: auth.session.workspaceId,
      botId: auth.session.botId,
      rootPageId: null,
      ...base
    })
  }
  return json({
    ok: true,
    mode: 'password' as const,
    workspaceName: null,
    workspaceId: null,
    botId: null,
    rootPageId: toUuid(ctx.env.NOTION_ROOT_PAGE_ID || ''),
    hasToken: Boolean(ctx.env.NOTION_TOKEN),
    ...base
  })
}
