export interface Env {
  NOTION_TOKEN?: string
  NOTION_ROOT_PAGE_ID?: string
  APP_PASSWORD?: string
  PAGE_CACHE?: KVNamespace
  NOTION_OAUTH_CLIENT_ID?: string
  NOTION_OAUTH_CLIENT_SECRET?: string
  NOTION_OAUTH_REDIRECT_URI?: string
  SESSION_SECRET?: string
}

export function oauthEnabled(env: Env): boolean {
  return Boolean(env.NOTION_OAUTH_CLIENT_ID && env.NOTION_OAUTH_CLIENT_SECRET && env.SESSION_SECRET)
}

export function passwordFallbackEnabled(env: Env): boolean {
  return Boolean(env.NOTION_TOKEN && env.APP_PASSWORD)
}

export function json(data: unknown, status = 200, headers?: HeadersInit): Response {
  const h = new Headers(headers)
  h.set('content-type', 'application/json; charset=utf-8')
  h.set('cache-control', 'no-store')
  return new Response(JSON.stringify(data), { status, headers: h })
}

export function attachCookies(res: Response, cookies?: string[]): Response {
  if (!cookies?.length) return res
  const headers = new Headers(res.headers)
  for (const cookie of cookies) headers.append('Set-Cookie', cookie)
  return new Response(res.body, { status: res.status, headers })
}

export function requireToken(env: Env): string {
  const token = env.NOTION_TOKEN
  if (!token) {
    throw new ConfigError('未配置 NOTION_TOKEN')
  }
  return token
}

export function requireRootPageId(env: Env): string {
  const id = env.NOTION_ROOT_PAGE_ID
  if (!id) {
    throw new ConfigError('未配置 NOTION_ROOT_PAGE_ID')
  }
  return id
}

export class ConfigError extends Error {
  override name = 'ConfigError'
}

export class HttpError extends Error {
  override name = 'HttpError'
  constructor(
    public status: number,
    message: string,
    public details?: unknown
  ) {
    super(message)
  }
}

export function errorResponse(err: unknown): Response {
  if (err instanceof ConfigError) {
    return json({ error: err.message }, 500)
  }
  if (err instanceof HttpError) {
    return json({ error: err.message, details: err.details }, err.status)
  }
  const message = err instanceof Error ? err.message : '未知错误'
  return json({ error: message }, 500)
}
