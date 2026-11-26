import type { OfficialRichText, SearchPage } from '@shared/types'
import type { ExtendedRecordMap } from 'notion-types'

export interface PagePayload {
  pageId: string
  recordMap: ExtendedRecordMap
  lastEditedTime: string | null
}

export interface MeResponse {
  ok: boolean
  rootPageId: string | null
  hasToken: boolean
}

async function parseJson<T>(res: Response): Promise<T> {
  const data = (await res.json().catch(() => ({}))) as T & { error?: string; message?: string }
  if (!res.ok) {
    const err = new ApiError(res.status, data.error || data.message || `请求失败 (${res.status})`, data)
    throw err
  }
  return data
}

export class ApiError extends Error {
  override name = 'ApiError'
  constructor(
    public status: number,
    message: string,
    public details?: unknown
  ) {
    super(message)
  }
}

export const api = {
  me: () => fetch('/api/me').then((r) => parseJson<MeResponse>(r)),

  login: (password: string) =>
    fetch('/api/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password })
    }).then((r) => parseJson<{ ok: boolean }>(r)),

  logout: () => fetch('/api/logout', { method: 'POST' }).then((r) => parseJson<{ ok: boolean }>(r)),

  search: (q = '') =>
    fetch(`/api/search?q=${encodeURIComponent(q)}`).then((r) =>
      parseJson<{ pages: SearchPage[]; rootPageId: string }>(r)
    ),

  page: (id: string) =>
    fetch(`/api/page/${encodeURIComponent(id)}`).then((r) => parseJson<PagePayload>(r)),

  patchBlock: (
    id: string,
    body: {
      richText?: OfficialRichText[]
      checked?: boolean
      lastEditedTime?: string
      pageId?: string
    }
  ) =>
    fetch(`/api/block/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    }).then((r) => parseJson<{ block: { id: string; last_edited_time?: string } }>(r)),

  deleteBlock: (id: string, pageId?: string) =>
    fetch(
      `/api/block/${encodeURIComponent(id)}${pageId ? `?pageId=${encodeURIComponent(pageId)}` : ''}`,
      { method: 'DELETE' }
    ).then((r) => parseJson<{ block: unknown }>(r)),

  appendAfter: (id: string, body: { pageId?: string; asChild?: boolean; richText?: OfficialRichText[] }) =>
    fetch(`/api/block/${encodeURIComponent(id)}/children`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    }).then((r) => parseJson<{ results: Array<{ id: string }>; parentId: string }>(r))
}
