import { HttpError, json, oauthEnabled, passwordFallbackEnabled, type Env } from './env'
import { cookieAttrs, readCookie } from './cookies'
import { hmacSign, timingSafeEqual } from './codec'
import {
  OAUTH_STATE_COOKIE,
  readOAuthSession,
  refreshAccessToken,
  sessionCookieValue,
  sessionFromTokenResponse,
  encryptSession,
  type OAuthSession
} from './oauth'

export const SESSION_COOKIE = 'sln_session'
const SESSION_PURPOSE = 'superlight-notion-session-v1'

export type AuthMode = 'oauth' | 'password'

export interface ResolvedAuth {
  mode: AuthMode
  session: OAuthSession | null
}

export { readCookie }

export async function sessionToken(password: string): Promise<string> {
  return hmacSign(password, SESSION_PURPOSE)
}

export function sessionCookie(token: string, request?: Request, clear = false): string {
  const maxAge = clear ? 0 : 60 * 60 * 24 * 30
  const value = clear ? '' : encodeURIComponent(token)
  const attrs = request ? cookieAttrs(request, maxAge) : `Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`
  return `${SESSION_COOKIE}=${value}; ${attrs}`
}

export async function isPasswordAuthed(request: Request, env: Env): Promise<boolean> {
  if (!env.APP_PASSWORD) return false
  const cookie = readCookie(request, SESSION_COOKIE)
  if (!cookie) return false
  const expected = await sessionToken(env.APP_PASSWORD)
  return timingSafeEqual(cookie, expected)
}

/** @deprecated use isPasswordAuthed; kept for existing tests */
export const isAuthed = isPasswordAuthed

export async function getAuth(request: Request, env: Env): Promise<ResolvedAuth | null> {
  if (oauthEnabled(env)) {
    const session = await readOAuthSession(request, env)
    if (session) return { mode: 'oauth', session }
  }
  if (passwordFallbackEnabled(env) && (await isPasswordAuthed(request, env))) {
    return { mode: 'password', session: null }
  }
  return null
}

export async function requireAuth(request: Request, env: Env): Promise<Response | null> {
  if (await getAuth(request, env)) return null
  if (oauthEnabled(env) || passwordFallbackEnabled(env)) {
    return json({ error: 'unauthorized' }, 401)
  }
  return json(
    { error: '未配置 Notion OAuth（NOTION_OAUTH_CLIENT_ID / SECRET 与 SESSION_SECRET），也没有可用的开发回退（NOTION_TOKEN + APP_PASSWORD）' },
    503
  )
}

export interface AccessResolution {
  token: string
  mode: AuthMode
  session: OAuthSession | null
  cookies?: string[]
  tenant: string
}

export async function resolveAccessToken(request: Request, env: Env): Promise<AccessResolution> {
  const auth = await getAuth(request, env)
  if (auth?.mode === 'oauth' && auth.session) {
    return {
      token: auth.session.accessToken,
      mode: 'oauth',
      session: auth.session,
      tenant: auth.session.botId || auth.session.workspaceId || 'oauth'
    }
  }
  if (auth?.mode === 'password' && env.NOTION_TOKEN) {
    return { token: env.NOTION_TOKEN, mode: 'password', session: null, tenant: 'internal' }
  }
  // Handlers may be called from tests with NOTION_TOKEN and no cookie.
  if (!oauthEnabled(env) && env.NOTION_TOKEN) {
    return { token: env.NOTION_TOKEN, mode: 'password', session: null, tenant: 'internal' }
  }
  throw new HttpError(401, 'unauthorized')
}

export async function refreshIfNeeded(
  env: Env,
  request: Request,
  current: AccessResolution
): Promise<AccessResolution | null> {
  if (current.mode !== 'oauth' || !current.session?.refreshToken || !oauthEnabled(env)) return null
  const data = await refreshAccessToken(env, current.session.refreshToken)
  const session = sessionFromTokenResponse(data)
  // Keep previous workspace metadata if refresh response omits it.
  if (!session.workspaceName) session.workspaceName = current.session.workspaceName
  if (!session.workspaceId) session.workspaceId = current.session.workspaceId
  if (!session.botId) session.botId = current.session.botId
  const encrypted = await encryptSession(env.SESSION_SECRET!, session)
  return {
    token: session.accessToken,
    mode: 'oauth',
    session,
    cookies: [sessionCookieValue(encrypted, request)],
    tenant: session.botId || session.workspaceId || current.tenant
  }
}

export function clearAuthCookies(request: Request): string[] {
  return [
    sessionCookie('', request, true),
    sessionCookieValue('', request, true),
    `${OAUTH_STATE_COOKIE}=; ${cookieAttrs(request, 0)}`
  ]
}

