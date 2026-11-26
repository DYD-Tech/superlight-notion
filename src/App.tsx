import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ExtendedRecordMap } from 'notion-types'
import { toUuid } from '@shared/ids'
import type { SearchPage } from '@shared/types'
import { api, ApiError } from './api'
import type { PagePayload } from './api'
import { LoginForm } from './components/LoginForm'
import { PageView } from './components/PageView'
import { SaveStatus } from './components/SaveStatus'
import { Sidebar } from './components/Sidebar'
import type { SaveStatus as Status } from './editor/saveQueue'

function pageIdFromUrl(): string | null {
  const p = new URLSearchParams(window.location.search).get('p')
  return p ? toUuid(p) : null
}

function oauthErrorFromUrl(): string | null {
  const code = new URLSearchParams(window.location.search).get('oauth_error')
  if (!code) return null
  if (code === 'state') return '登录校验失败，请再试一次。'
  if (code === 'access_denied') return '你取消了 Notion 授权。'
  if (code === 'exchange') return '无法完成 Notion 授权，请重试。'
  return 'Notion 授权失败，请重试。'
}

function stripOAuthErrorFromUrl() {
  const url = new URL(window.location.href)
  if (!url.searchParams.has('oauth_error')) return
  url.searchParams.delete('oauth_error')
  window.history.replaceState(window.history.state, '', url)
}

export default function App() {
  const [auth, setAuth] = useState<'loading' | 'login' | 'ok'>('loading')
  const [rootPageId, setRootPageId] = useState<string | null>(null)
  const [workspaceName, setWorkspaceName] = useState<string | null>(null)
  const [authMode, setAuthMode] = useState<'oauth' | 'password' | null>(null)
  const [oauthEnabled, setOauthEnabled] = useState(false)
  const [passwordEnabled, setPasswordEnabled] = useState(false)
  const [loginError, setLoginError] = useState<string | null>(() => oauthErrorFromUrl())
  const [pages, setPages] = useState<SearchPage[]>([])
  const [query, setQuery] = useState('')
  const [pageId, setPageId] = useState<string | null>(pageIdFromUrl)
  const [payload, setPayload] = useState<PagePayload | null>(null)
  const [recordMap, setRecordMap] = useState<ExtendedRecordMap | null>(null)
  const [blockTimes, setBlockTimes] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<Status>('idle')
  const [statusMsg, setStatusMsg] = useState<string | undefined>()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [darkMode, setDarkMode] = useState(() =>
    window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false
  )
  const [loadingPage, setLoadingPage] = useState(false)

  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode)
  }, [darkMode])

  const boot = useCallback(async () => {
    try {
      const me = await api.me()
      setOauthEnabled(me.oauthEnabled)
      setPasswordEnabled(me.passwordEnabled)
      if (!me.ok) {
        setAuth('login')
        setAuthMode(null)
        setWorkspaceName(null)
        return me
      }
      setRootPageId(me.rootPageId ?? null)
      setWorkspaceName(me.workspaceName ?? null)
      setAuthMode(me.mode ?? null)
      setAuth('ok')
      stripOAuthErrorFromUrl()
      return me
    } catch (err) {
      if (err instanceof ApiError && (err.status === 401 || err.status === 503)) {
        setAuth('login')
        if (err.status === 503) setLoginError(err.message)
        return null
      }
      setLoginError(err instanceof Error ? err.message : '无法连接')
      setAuth('login')
      return null
    }
  }, [])

  useEffect(() => {
    void boot()
  }, [boot])

  useEffect(() => {
    if (auth !== 'ok') return
    let cancelled = false
    void api
      .search(query)
      .then((res) => {
        if (cancelled) return
        setPages(res.pages)
        setRootPageId(res.rootPageId)
        setPageId((cur) => cur || res.rootPageId)
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : '搜索失败')
      })
    return () => {
      cancelled = true
    }
  }, [auth, query])

  const loadPage = useCallback(async (id: string, replaceUrl = true) => {
    setLoadingPage(true)
    setError(null)
    try {
      const data = await api.page(id)
      setPayload(data)
      setRecordMap(data.recordMap)
      setBlockTimes(collectTimes(data))
      setPageId(data.pageId)
      if (replaceUrl) {
        const url = new URL(window.location.href)
        url.searchParams.set('p', data.pageId.replace(/-/g, ''))
        window.history.pushState({ p: data.pageId }, '', url)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '无法打开页面')
    } finally {
      setLoadingPage(false)
    }
  }, [])

  useEffect(() => {
    if (auth !== 'ok' || !pageId) return
    void loadPage(pageId, false)
  }, [auth, pageId, loadPage])

  useEffect(() => {
    const onPop = () => {
      const id = pageIdFromUrl()
      if (id) setPageId(id)
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  const onSelect = (id: string) => {
    const uuid = toUuid(id)
    if (!uuid) return
    setSidebarOpen(false)
    setPageId(uuid)
    void loadPage(uuid, true)
  }

  const refresh = useCallback(() => {
    if (pageId) void loadPage(pageId, false)
  }, [pageId, loadPage])

  const title = useMemo(() => {
    if (!recordMap || !pageId) return 'superlight-notion'
    const wrap = recordMap.block[pageId] as
      | { value?: { properties?: { title?: Array<[string]> } } }
      | undefined
    const t = wrap?.value?.properties?.title?.map((x) => x[0]).join('') || 'superlight-notion'
    return t
  }, [recordMap, pageId])

  useEffect(() => {
    document.title = title
  }, [title])

  if (auth === 'loading') {
    return <div className="centered muted">加载中…</div>
  }

  if (auth === 'login') {
    return (
      <LoginForm
        oauthEnabled={oauthEnabled}
        passwordEnabled={passwordEnabled}
        errorMessage={loginError}
        onLogin={async (password) => {
          await api.login(password)
          setLoginError(null)
          setError(null)
          await boot()
        }}
      />
    )
  }

  return (
    <div className="app">
      <Sidebar
        pages={pages}
        currentId={pageId}
        query={query}
        onQuery={setQuery}
        onSelect={onSelect}
        open={sidebarOpen}
        onToggle={() => setSidebarOpen((v) => !v)}
        showReauth={authMode === 'oauth'}
      />
      <div className="main">
        <header className="topbar">
          <div className="topbar-titles">
            {workspaceName ? <div className="workspace-name">{workspaceName}</div> : null}
            <div className="topbar-title">{title}</div>
          </div>
          <div className="topbar-actions">
            <SaveStatus status={status} message={statusMsg} />
            <button type="button" onClick={() => setDarkMode((v) => !v)}>
              {darkMode ? '浅色' : '深色'}
            </button>
            {pageId ? (
              <a
                className="open-notion"
                href={`https://www.notion.so/${pageId.replace(/-/g, '')}`}
                target="_blank"
                rel="noreferrer"
              >
                在 Notion 中打开
              </a>
            ) : null}
            <button
              type="button"
              onClick={() => {
                void api.logout().then(() => {
                  setAuth('login')
                  setAuthMode(null)
                  setWorkspaceName(null)
                  setPayload(null)
                  setRecordMap(null)
                })
              }}
            >
              退出
            </button>
          </div>
        </header>
        {error ? (
          <div className="banner error">
            {error}{' '}
            <button type="button" onClick={refresh}>
              刷新
            </button>
          </div>
        ) : null}
        {loadingPage && !recordMap ? <div className="centered muted">正在打开页面…</div> : null}
        {recordMap && pageId ? (
          <PageView
            pageId={pageId}
            recordMap={recordMap}
            rootPageId={rootPageId}
            darkMode={darkMode}
            blockTimes={blockTimes}
            onRecordMap={setRecordMap}
            onStatus={(s, m) => {
              setStatus(s)
              setStatusMsg(m)
            }}
            onNeedRefresh={refresh}
          />
        ) : (
          !loadingPage && <div className="centered muted">选择左侧的一个页面开始阅读。</div>
        )}
        {payload && loadingPage ? <div className="progress-bar" /> : null}
      </div>
    </div>
  )
}

function collectTimes(data: PagePayload): Record<string, string> {
  const times: Record<string, string> = {}
  const raw = (data.recordMap as unknown as { raw?: { page?: { last_edited_time?: string; id?: string }; block?: { last_edited_time?: string; id?: string }; children?: Array<{ id: string; last_edited_time?: string }> } }).raw
  if (raw?.page?.last_edited_time && raw.page.id) times[raw.page.id] = raw.page.last_edited_time
  if (raw?.block?.last_edited_time && raw.block.id) times[raw.block.id] = raw.block.last_edited_time
  if (Array.isArray(raw?.children)) {
    for (const c of raw.children) {
      if (c.last_edited_time) times[c.id] = c.last_edited_time
    }
  }
  if (data.lastEditedTime && data.pageId) times[data.pageId] = data.lastEditedTime
  for (const [id, wrap] of Object.entries(data.recordMap.block || {})) {
    const t = (wrap as { value?: { last_edited_time?: string | number } }).value?.last_edited_time
    if (typeof t === 'string' && t.includes('T')) times[id] = t
  }
  return times
}
