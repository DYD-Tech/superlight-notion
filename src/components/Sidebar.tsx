import { useEffect, useMemo, useState } from 'react'
import type { SearchPage } from '@shared/types'
import {
  buildPageTree,
  collectExpandIds,
  compactId,
  type PageTreeNode
} from '../pageTree'

export function Sidebar({
  pages,
  currentId,
  query,
  onQuery,
  onSelect,
  open,
  onToggle,
  showReauth,
  overviewActive,
  onOverview
}: {
  pages: SearchPage[]
  currentId: string | null
  query: string
  onQuery: (q: string) => void
  onSelect: (id: string) => void
  open: boolean
  onToggle: () => void
  showReauth?: boolean
  overviewActive?: boolean
  onOverview?: () => void
}) {
  const tree = useMemo(() => buildPageTree(pages), [pages])
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())

  useEffect(() => {
    const extra = collectExpandIds(pages, currentId, Boolean(query.trim()))
    setExpanded((prev) => {
      const next = new Set(prev)
      for (const id of extra) next.add(id)
      return next
    })
  }, [pages, currentId, query])

  function toggle(id: string) {
    const key = compactId(id)
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  return (
    <>
      <button type="button" className="sidebar-toggle" onClick={onToggle} aria-label="切换页面列表">
        菜单
      </button>
      <aside className={`sidebar ${open ? 'open' : ''}`}>
        <div className="sidebar-head">
          <div className="sidebar-heading">页面</div>
          <input
            type="search"
            placeholder="搜索标题"
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            aria-label="搜索页面"
          />
        </div>
        <nav className="sidebar-list" aria-label="页面列表">
          <button
            type="button"
            className={`nav-overview${overviewActive ? ' active' : ''}`}
            onClick={() => onOverview?.()}
          >
            <OverviewIcon />
            <span>概览</span>
          </button>
          {pages.length === 0 ? (
            <div className="sidebar-empty">没有找到页面</div>
          ) : (
            tree.map((node) => (
              <TreeBranch
                key={node.page.id}
                node={node}
                level={0}
                currentId={currentId}
                expanded={expanded}
                onToggle={toggle}
                onSelect={onSelect}
              />
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

function TreeBranch({
  node,
  level,
  currentId,
  expanded,
  onToggle,
  onSelect
}: {
  node: PageTreeNode
  level: number
  currentId: string | null
  expanded: Set<string>
  onToggle: (id: string) => void
  onSelect: (id: string) => void
}) {
  const { page, children } = node
  const key = compactId(page.id)
  const active = currentId != null && key === compactId(currentId)
  const hasChildren = children.length > 0
  const isOpen = hasChildren && expanded.has(key)
  const pad = 8 + level * 16

  return (
    <div className="tree-branch">
      <div className={`tree-row${active ? ' active' : ''}`} style={{ paddingLeft: pad }}>
        {hasChildren ? (
          <button
            type="button"
            className="tree-chevron"
            aria-label={isOpen ? '折叠' : '展开'}
            aria-expanded={isOpen}
            onClick={(e) => {
              e.stopPropagation()
              onToggle(page.id)
            }}
          >
            <Chevron open={isOpen} />
          </button>
        ) : (
          <span className="tree-chevron spacer" aria-hidden="true" />
        )}
        <button type="button" className="tree-page" onClick={() => onSelect(page.id)}>
          <DocIcon />
          <span className="tree-title">{page.title || '无标题'}</span>
        </button>
      </div>
      {isOpen
        ? children.map((child) => (
            <TreeBranch
              key={child.page.id}
              node={child}
              level={level + 1}
              currentId={currentId}
              expanded={expanded}
              onToggle={onToggle}
              onSelect={onSelect}
            />
          ))
        : null}
    </div>
  )
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      className={`tree-chevron-icon${open ? ' open' : ''}`}
      viewBox="0 0 16 16"
      width="16"
      height="16"
      aria-hidden="true"
    >
      <path
        d="M6 4.5l4 3.5-4 3.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function DocIcon() {
  return (
    <svg className="tree-doc-icon" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <path
        d="M4.25 2.5h5.1L12 5.2v8.3a.8.8 0 0 1-.8.8H4.8a.8.8 0 0 1-.8-.8V3.3a.8.8 0 0 1 .8-.8z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      <path d="M9.2 2.6v2.8H12" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
    </svg>
  )
}

function OverviewIcon() {
  return (
    <svg className="tree-doc-icon" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <rect x="2.5" y="2.5" width="4.5" height="4.5" rx="0.8" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <rect x="9" y="2.5" width="4.5" height="4.5" rx="0.8" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <rect x="2.5" y="9" width="4.5" height="4.5" rx="0.8" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <rect x="9" y="9" width="4.5" height="4.5" rx="0.8" fill="none" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  )
}

