import { json, type Env } from './env'

export const SESSION_COOKIE = 'sln_session'
const SESSION_PURPOSE = 'superlight-notion-session-v1'

export async function sessionToken(password: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(SESSION_PURPOSE))
  return bufferToBase64Url(sig)
}

export async function isAuthed(request: Request, env: Env): Promise<boolean> {
  if (!env.APP_PASSWORD) return false
  const cookie = readCookie(request, SESSION_COOKIE)
  if (!cookie) return false
  const expected = await sessionToken(env.APP_PASSWORD)
  return timingSafeEqual(cookie, expected)
}

export function readCookie(request: Request, name: string): string | null {
  const raw = request.headers.get('Cookie') || ''
  for (const part of raw.split(';')) {
    const [k, ...rest] = part.trim().split('=')
    if (k === name) return decodeURIComponent(rest.join('='))
  }
  return null
}

export function sessionCookie(token: string, clear = false): string {
  const maxAge = clear ? 0 : 60 * 60 * 24 * 30
  const value = clear ? '' : encodeURIComponent(token)
  return `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`
}

export async function requireAuth(request: Request, env: Env): Promise<Response | null> {
  if (!env.APP_PASSWORD) {
    return json({ error: '未配置 APP_PASSWORD，拒绝访问以免代理被公开' }, 503)
  }
  if (!(await isAuthed(request, env))) {
    return json({ error: 'unauthorized' }, 401)
  }
  return null
}

export function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder()
  const aa = enc.encode(a)
  const bb = enc.encode(b)
  if (aa.length !== bb.length) {
    // Still walk the longer one so length leaks are a bit harder.
    let acc = aa.length ^ bb.length
    const len = Math.max(aa.length, bb.length)
    for (let i = 0; i < len; i++) {
      acc |= (aa[i] ?? 0) ^ (bb[i] ?? 0)
    }
    return false
  }
  let acc = 0
  for (let i = 0; i < aa.length; i++) {
    acc |= aa[i]! ^ bb[i]!
  }
  return acc === 0
}

function bufferToBase64Url(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!)
  // btoa is available in Workers and in browsers; Node tests polyfill it.
  const b64 = globalThis.btoa(bin)
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}
