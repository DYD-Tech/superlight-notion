import { attachCookies, oauthEnabled, type Env } from './env'
import {
  authorizeUrl,
  clearStateCookie,
  encryptSession,
  exchangeCode,
  newStateCookie,
  oauthNotConfigured,
  sessionCookieValue,
  sessionFromTokenResponse,
  verifySignedState,
  OAUTH_STATE_COOKIE
} from './oauth'
import { readCookie } from './cookies'

export function redirectHome(request: Request, error?: string): string {
  const url = new URL(request.url)
  const home = new URL('/', url.origin)
  if (error) home.searchParams.set('oauth_error', error)
  return home.toString()
}

export async function handleOAuthStart(request: Request, env: Env): Promise<Response> {
  if (!oauthEnabled(env)) return oauthNotConfigured()
  const { state, cookie } = await newStateCookie(env, request)
  const location = authorizeUrl(env, request, state)
  return attachCookies(
    new Response(null, {
      status: 302,
      headers: { location, 'cache-control': 'no-store' }
    }),
    [cookie]
  )
}

export async function handleOAuthCallback(request: Request, env: Env): Promise<Response> {
  if (!oauthEnabled(env)) return oauthNotConfigured()

  const url = new URL(request.url)
  const denied = url.searchParams.get('error')
  if (denied) {
    return attachCookies(
      new Response(null, {
        status: 302,
        headers: { location: redirectHome(request, denied), 'cache-control': 'no-store' }
      }),
      [clearStateCookie(request)]
    )
  }

  const code = url.searchParams.get('code') || ''
  const state = url.searchParams.get('state') || ''
  const signed = readCookie(request, OAUTH_STATE_COOKIE)
  if (!code || !state || !signed || !(await verifySignedState(env.SESSION_SECRET!, signed, state))) {
    return attachCookies(
      new Response(null, {
        status: 302,
        headers: { location: redirectHome(request, 'state'), 'cache-control': 'no-store' }
      }),
      [clearStateCookie(request)]
    )
  }

  try {
    const tokens = await exchangeCode(env, request, code)
    const session = sessionFromTokenResponse(tokens)
    const encrypted = await encryptSession(env.SESSION_SECRET!, session)
    return attachCookies(
      new Response(null, {
        status: 302,
        headers: { location: redirectHome(request), 'cache-control': 'no-store' }
      }),
      [sessionCookieValue(encrypted, request), clearStateCookie(request)]
    )
  } catch {
    return attachCookies(
      new Response(null, {
        status: 302,
        headers: { location: redirectHome(request, 'exchange'), 'cache-control': 'no-store' }
      }),
      [clearStateCookie(request)]
    )
  }
}
