import type { SearchPage } from '@shared/types'

export function Sidebar({
  pages,
  currentId,
  query,
  onQuery,
  onSelect,
  open,
  onToggle,
  showReauth
}: {
  pages: SearchPage[]
  currentId: string | null
  query: string
  onQuery: (q: string) => void
  onSelect: (id: string) => void
  open: boolean
  onToggle: () => void
  showReauth?: boolean
}) {
  return (
    <>
      <button type="button" className="sidebar-toggle" onClick={onToggle} aria-label="切换页面列表">
        菜单
      </button>
      <aside className={`sidebar ${open ? 'open' : ''}`}>
        <div className="sidebar-head">
          <strong>页面</strong>
          <input
            type="search"
            placeholder="搜索标题"
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            aria-label="搜索页面"
          />
        </div>
        <nav className="sidebar-list">
          {pages.length === 0 ? (
            <div className="sidebar-empty">没有找到页面</div>
          ) : (
            pages.map((p) => (
              <button
                type="button"
                key={p.id}
                className={p.id.replace(/-/g, '') === currentId?.replace(/-/g, '') ? 'active' : ''}
                onClick={() => onSelect(p.id)}
              >
                {p.title || '无标题'}
              </button>
            ))
          )}
        </nav>
        {showReauth ? (
          <a className="reauth-link" href="/api/oauth/start">
            授权更多页面
          </a>
        ) : null}
      </aside>
    </>
  )
}
