import { afterEach, describe, expect, it } from 'vitest'
import type { Env } from '../functions/_lib/env'
import { decryptSession, encryptSession, type OAuthSession } from '../functions/_lib/oauth'
import { handleOAuthCallback, handleOAuthStart } from '../functions/_lib/oauthHandlers'
import { getAuth } from '../functions/_lib/auth'
import { handleSearch } from '../functions/_lib/handlers'
import { ctx, installNotionMock, jsonResponse, pageObject, ROOT } from './helpers'
import { onRequestGet as getMe } from '../functions/api/me'

const ACCESS = 'ntn_test_access_token_do_not_leak'
const REFRESH = 'nrt_test_refresh_token_do_not_leak'
const origFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = origFetch
})

function oauthEnv(): Env {
  return {
    NOTION_OAUTH_CLIENT_ID: 'client-id-test',
    NOTION_OAUTH_CLIENT_SECRET: 'client-secret-test',
    NOTION_OAUTH_REDIRECT_URI: 'http://localhost:8788/api/oauth/callback',
    SESSION_SECRET: 'test-session-secret-at-least-32-characters!'
  }
}

function cookieValue(res: Response, name: string): string | null {
  const all =
    typeof res.headers.getSetCookie === 'function'
      ? res.headers.getSetCookie()
      : [res.headers.get('set-cookie') || '']
  for (const raw of all) {
    const part = raw.split(';')[0] || ''
    const eq = part.indexOf('=')
    if (eq > 0 && part.slice(0, eq) === name) return decodeURIComponent(part.slice(eq + 1))
  }
  return null
}

function assertNoSecrets(res: Response) {
  const body = ''
  // callback uses empty body; still inspect headers + any body
  const textPromise = res.clone().text()
  return textPromise.then((text) => {
    const haystack = [text, res.headers.get('location') || '', ...(typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [res.headers.get('set-cookie') || ''])].join('\n')
    expect(haystack).not.toContain(ACCESS)
    expect(haystack).not.toContain(REFRESH)
    expect(haystack).not.toContain('client-secret-test')
    return text
  })
}

describe('session encryption', () => {
  it('round-trips an OAuth session', async () => {
    const env = oauthEnv()
    const session: OAuthSession = {
      accessToken: ACCESS,
      refreshToken: REFRESH,
      workspaceName: 'Work',
      workspaceId: 'ws_1',
      botId: 'bot_1',
      obtainedAt: 1
    }
    const token = await encryptSession(env.SESSION_SECRET!, session)
    expect(token).not.toContain(ACCESS)
    expect(token).not.toContain(REFRESH)
    const back = await decryptSession(env.SESSION_SECRET!, token)
    expect(back).toEqual(session)
  })
})

describe('OAuth start + callback', () => {
  it('rejects a state mismatch and never puts the token in the response', async () => {
    const env = oauthEnv()
    const start = await handleOAuthStart(new Request('http://localhost:8788/api/oauth/start'), env)
    expect(start.status).toBe(302)
    const location = start.headers.get('location') || ''
    expect(location).toContain('https://api.notion.com/v1/oauth/authorize')
    expect(location).toContain('response_type=code')
    expect(location).toContain('owner=user')
    expect(location).toContain(encodeURIComponent('http://localhost:8788/api/oauth/callback'))
    const stateCookie = cookieValue(start, 'sln_oauth_state')
    expect(stateCookie).toBeTruthy()

    globalThis.fetch = async () => {
      throw new Error('token endpoint should not be called on state mismatch')
    }

    const bad = await handleOAuthCallback(
      new Request('http://localhost:8788/api/oauth/callback?code=abc&state=wrong-state', {
        headers: { cookie: `sln_oauth_state=${encodeURIComponent(stateCookie!)}` }
      }),
      env
    )
    expect(bad.status).toBe(302)
    expect(bad.headers.get('location')).toContain('oauth_error=state')
    await assertNoSecrets(bad)
  })

  it('exchanges the code, stores an encrypted cookie, and omits the token from the body', async () => {
    const env = oauthEnv()
    const start = await handleOAuthStart(new Request('http://localhost:8788/api/oauth/start'), env)
    const stateCookie = cookieValue(start, 'sln_oauth_state')!
    const loc = new URL(start.headers.get('location') || '')
    const state = loc.searchParams.get('state') || ''
    expect(stateCookie.startsWith(state + '.')).toBe(true)

    let posted: { url: string; body: unknown; auth: string | null } | null = null
    globalThis.fetch = async (input, init) => {
      posted = {
        url: String(input),
        body: init?.body ? JSON.parse(String(init.body)) : null,
        auth: new Headers(init?.headers).get('authorization')
      }
      return new Response(
        JSON.stringify({
          access_token: ACCESS,
          token_type: 'bearer',
          refresh_token: REFRESH,
          bot_id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
          workspace_name: 'Work',
          workspace_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
          workspace_icon: null,
          owner: { type: 'user', user: { object: 'user', id: 'user' } },
          duplicated_template_id: null
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    }

    const res = await handleOAuthCallback(
      new Request(`http://localhost:8788/api/oauth/callback?code=one-time-code&state=${encodeURIComponent(state)}`, {
        headers: { cookie: `sln_oauth_state=${encodeURIComponent(stateCookie)}` }
      }),
      env
    )
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('http://localhost:8788/')
    await assertNoSecrets(res)
    expect(posted?.url).toBe('https://api.notion.com/v1/oauth/token')
    expect(posted?.body).toEqual({
      grant_type: 'authorization_code',
      code: 'one-time-code',
      redirect_uri: 'http://localhost:8788/api/oauth/callback'
    })
    expect(posted?.auth?.startsWith('Basic ')).toBe(true)
    const sessionCookie = cookieValue(res, 'sln_oauth')
    expect(sessionCookie).toBeTruthy()
    expect(sessionCookie).not.toContain(ACCESS)
    const session = await decryptSession(env.SESSION_SECRET!, sessionCookie!)
    expect(session?.accessToken).toBe(ACCESS)
    expect(session?.refreshToken).toBe(REFRESH)
    expect(session?.workspaceName).toBe('Work')
    expect(session?.botId).toBe('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb')
  })
})

describe('OAuth session API', () => {
  it('does not put the access token in /api/me or /api/search bodies', async () => {
    const env = oauthEnv()
    const encrypted = await encryptSession(env.SESSION_SECRET!, {
      accessToken: ACCESS,
      refreshToken: REFRESH,
      workspaceName: 'Work',
      workspaceId: ROOT,
      botId: 'bot_1',
      obtainedAt: Date.now()
    })
    const request = new Request('http://localhost:8788/api/me', {
      headers: { cookie: `sln_oauth=${encodeURIComponent(encrypted)}` }
    })
    const auth = await getAuth(request, env)
    expect(auth?.mode).toBe('oauth')
    const me = await getMe({
      request,
      env,
      params: {},
      waitUntil() {},
      next: async () => new Response()
    } as unknown as EventContext<Env, string, unknown>)
    const meBody = await me.json() as Record<string, unknown>
    expect(meBody.ok).toBe(true)
    expect(meBody.mode).toBe('oauth')
    expect(meBody.workspaceName).toBe('Work')
    expect(JSON.stringify(meBody)).not.toContain(ACCESS)
    expect(JSON.stringify(meBody)).not.toContain(REFRESH)

    installNotionMock()
    const search = await handleSearch(
      ctx(
        new Request('http://localhost:8788/api/search', {
          headers: { cookie: `sln_oauth=${encodeURIComponent(encrypted)}` }
        }),
        {},
        env
      )
    )
    expect(search.status).toBe(200)
    const searchText = await search.text()
    expect(searchText).not.toContain(ACCESS)
    expect(searchText).not.toContain(REFRESH)
    const data = JSON.parse(searchText) as { pages: Array<{ title: string }> }
    expect(data.pages.some((p) => p.title === 'Root')).toBe(true)
  })
})

describe('OAuth search filtering', () => {
  it('omits database-row pages and keeps workspace and sub-pages', async () => {
    const env = oauthEnv()
    const encrypted = await encryptSession(env.SESSION_SECRET!, {
      accessToken: ACCESS,
      refreshToken: REFRESH,
      workspaceName: 'Work',
      workspaceId: ROOT,
      botId: 'bot_1',
      obtainedAt: Date.now()
    })

    const subId = 'dddddddd-dddd-dddd-dddd-dddddddddddd'
    const dbRowId = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'
    const dsRowId = '99999999-9999-9999-9999-999999999999'
    const workspace = pageObject(ROOT, 'Workspace Home')
    const sub = pageObject(subId, 'Sub page')
    sub.parent = { type: 'page_id', page_id: ROOT }
    const dbRow = pageObject(dbRowId, 'DB row')
    dbRow.parent = { type: 'database_id', database_id: 'ffffffff-ffff-ffff-ffff-ffffffffffff' }
    const dsRow = pageObject(dsRowId, 'Data source row')
    dsRow.parent = { type: 'data_source_id', data_source_id: '11111111-1111-1111-1111-111111111111' }

    const orig = globalThis.fetch
    globalThis.fetch = (async (input, init) => {
      const url = new URL(String(input))
      const method = (init?.method || 'GET').toUpperCase()
      if (url.pathname === '/v1/search' && method === 'POST') {
        return jsonResponse({
          object: 'list',
          results: [workspace, sub, dbRow, dsRow],
          next_cursor: null,
          has_more: false
        })
      }
      return jsonResponse({ object: 'error', message: `unmocked ${method} ${url.pathname}` }, 404)
    }) as typeof fetch

    try {
      const res = await handleSearch(
        ctx(
          new Request('http://localhost:8788/api/search', {
            headers: { cookie: `sln_oauth=${encodeURIComponent(encrypted)}` }
          }),
          {},
          env
        )
      )
      expect(res.status).toBe(200)
      const data = (await res.json()) as {
        pages: Array<{ id: string; title: string; parentId: string | null }>
      }
      expect(data.pages.map((p) => p.title).sort()).toEqual(['Sub page', 'Workspace Home'])
      const home = data.pages.find((p) => p.id === ROOT)
      const child = data.pages.find((p) => p.id === subId)
      expect(home?.parentId).toBeNull()
      expect(child?.parentId).toBe(ROOT)
      expect(data.pages.some((p) => p.id === dbRowId || p.id === dsRowId)).toBe(false)
    } finally {
      globalThis.fetch = orig
    }
  })
})
