import { json, oauthEnabled, type Env } from './env'
import {
  decryptJson,
  encryptJson,
  hmacSign,
  randomBase64Url,
  timingSafeEqual
} from './codec'
import { cookieAttrs, readCookie } from './cookies'

export const OAUTH_SESSION_COOKIE = 'sln_oauth'
export const OAUTH_STATE_COOKIE = 'sln_oauth_state'
const AUTHORIZE_URL = 'https://api.notion.com/v1/oauth/authorize'
const TOKEN_URL = 'https://api.notion.com/v1/oauth/token'

export interface OAuthSession {
  accessToken: string
  refreshToken: string | null
  workspaceName: string | null
  workspaceId: string | null
  botId: string | null
  obtainedAt: number
}

export interface NotionTokenResponse {
  access_token: string
  token_type?: string
  refresh_token?: string | null
  bot_id?: string
  workspace_name?: string | null
  workspace_id?: string
  workspace_icon?: string | null
}

export function redirectUri(env: Env, request: Request): string {
  if (env.NOTION_OAUTH_REDIRECT_URI) return env.NOTION_OAUTH_REDIRECT_URI
  const url = new URL(request.url)
  return `${url.origin}/api/oauth/callback`
}

export async function signedState(secret: string, state: string): Promise<string> {
  const sig = await hmacSign(secret, `oauth-state:${state}`)
  return `${state}.${sig}`
}

export async function verifySignedState(secret: string, cookieValue: string, queryState: string): Promise<boolean> {
  const dot = cookieValue.lastIndexOf('.')
  if (dot <= 0) return false
  const state = cookieValue.slice(0, dot)
  const sig = cookieValue.slice(dot + 1)
  if (!timingSafeEqual(state, queryState)) return false
  const expected = await hmacSign(secret, `oauth-state:${state}`)
  return timingSafeEqual(sig, expected)
}

export async function newStateCookie(env: Env, request: Request): Promise<{ state: string; cookie: string }> {
  const state = randomBase64Url(24)
  const value = await signedState(env.SESSION_SECRET!, state)
  const cookie = `${OAUTH_STATE_COOKIE}=${encodeURIComponent(value)}; ${cookieAttrs(request, 600)}`
  return { state, cookie }
}

export function clearStateCookie(request: Request): string {
  return `${OAUTH_STATE_COOKIE}=; ${cookieAttrs(request, 0)}`
}

export async function encryptSession(secret: string, session: OAuthSession): Promise<string> {
  return encryptJson(secret, session)
}

export async function decryptSession(secret: string, token: string): Promise<OAuthSession | null> {
  try {
    const data = await decryptJson<OAuthSession>(secret, token)
    if (!data || typeof data.accessToken !== 'string') return null
    return data
  } catch {
    return null
  }
}

export function sessionCookieValue(encrypted: string, request: Request, clear = false): string {
  const value = clear ? '' : encodeURIComponent(encrypted)
  return `${OAUTH_SESSION_COOKIE}=${value}; ${cookieAttrs(request, clear ? 0 : 60 * 60 * 24 * 30)}`
}

export async function readOAuthSession(request: Request, env: Env): Promise<OAuthSession | null> {
  if (!oauthEnabled(env)) return null
  const raw = readCookie(request, OAUTH_SESSION_COOKIE)
  if (!raw) return null
  return decryptSession(env.SESSION_SECRET!, raw)
}

export function sessionFromTokenResponse(data: NotionTokenResponse): OAuthSession {
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? null,
    workspaceName: data.workspace_name ?? null,
    workspaceId: data.workspace_id ?? null,
    botId: data.bot_id ?? null,
    obtainedAt: Date.now()
  }
}

export function authorizeUrl(env: Env, request: Request, state: string): string {
  const params = new URLSearchParams({
    client_id: env.NOTION_OAUTH_CLIENT_ID!,
    response_type: 'code',
    owner: 'user',
    redirect_uri: redirectUri(env, request),
    state
  })
  return `${AUTHORIZE_URL}?${params.toString()}`
}

export async function exchangeCode(
  env: Env,
  request: Request,
  code: string,
  fetchFn: typeof fetch = fetch
): Promise<NotionTokenResponse> {
  return tokenRequest(
    env,
    { grant_type: 'authorization_code', code, redirect_uri: redirectUri(env, request) },
    fetchFn
  )
}

export async function refreshAccessToken(
  env: Env,
  refreshToken: string,
  fetchFn: typeof fetch = fetch
): Promise<NotionTokenResponse> {
  return tokenRequest(env, { grant_type: 'refresh_token', refresh_token: refreshToken }, fetchFn)
}

async function tokenRequest(
  env: Env,
  body: Record<string, string>,
  fetchFn: typeof fetch
): Promise<NotionTokenResponse> {
  const basic = globalThis.btoa(`${env.NOTION_OAUTH_CLIENT_ID}:${env.NOTION_OAUTH_CLIENT_SECRET}`)
  const res = await fetchFn(TOKEN_URL, {
    method: 'POST',
    headers: {
      authorization: `Basic ${basic}`,
      accept: 'application/json',
      'content-type': 'application/json'
    },
    body: JSON.stringify(body)
  })
  const text = await res.text()
  let data: unknown = null
  if (text) {
    try {
      data = JSON.parse(text)
    } catch {
      data = { message: '无法解析 Notion 的响应' }
    }
  }
  if (!res.ok) {
    const message = (data as { message?: string } | null)?.message || `OAuth 换票失败 (${res.status})`
    const err = new Error(message)
    ;(err as Error & { status?: number }).status = res.status
    throw err
  }
  const parsed = data as NotionTokenResponse
  if (!parsed?.access_token) {
    throw new Error('Notion 未返回 access_token')
  }
  return parsed
}

export function oauthNotConfigured(): Response {
  return json({ error: '未配置 Notion OAuth（需要 NOTION_OAUTH_CLIENT_ID、NOTION_OAUTH_CLIENT_SECRET 和 SESSION_SECRET）' }, 503)
}
