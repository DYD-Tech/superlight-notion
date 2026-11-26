import { useMemo, useState } from 'react'
import type { SearchPage } from '@shared/types'
import { buildPageTree, compactId, summarizePages, type PageTreeNode } from '../pageTree'

export function OverviewPage({
  workspaceName,
  pages,
  onSelect
}: {
  workspaceName: string | null
  pages: SearchPage[]
  onSelect: (id: string) => void
}) {
  const [jump, setJump] = useState('')
  const summary = useMemo(() => summarizePages(pages), [pages])
  const tree = useMemo(() => buildPageTree(pages), [pages])
  const query = jump.trim().toLowerCase()
  const matches = useMemo(() => {
    if (!query) return null
    return pages.filter((page) => (page.title || '无标题').toLowerCase().includes(query))
  }, [pages, query])

  const title = workspaceName || '概览'

  return (
    <div className="overview">
      <h1 className="overview-title">{title}</h1>
      <p className="overview-lead">已授权页面的概览，点击卡片即可打开阅读。</p>

      <div className="overview-stats">
        <div className="overview-stat">
          <div className="overview-stat-value">{summary.total}</div>
          <div className="overview-stat-label">已授权页面</div>
        </div>
        <div className="overview-stat">
          <div className="overview-stat-value">{summary.topLevelCount}</div>
          <div className="overview-stat-label">顶级页面</div>
        </div>
        <div className="overview-stat">
          <div className="overview-stat-value">{summary.subPageCount}</div>
          <div className="overview-stat-label">子页面</div>
        </div>
      </div>

      <div className="overview-search">
        <input
          type="search"
          value={jump}
          onChange={(e) => setJump(e.target.value)}
          placeholder="快速跳转到页面"
          aria-label="快速跳转到页面"
        />
      </div>

      {matches ? (
        <section className="overview-section">
          <h2>搜索结果</h2>
          {matches.length === 0 ? (
            <p className="overview-empty">没有匹配的页面</p>
          ) : (
            <div className="overview-grid">
              {matches.map((page) => (
                <PageCard key={page.id} page={page} pages={pages} onSelect={onSelect} />
              ))}
            </div>
          )}
        </section>
      ) : (
        <>
          <section className="overview-section">
            <h2>顶级页面</h2>
            {summary.topLevel.length === 0 ? (
              <p className="overview-empty">还没有已授权的页面。可在侧栏使用「授权更多页面」。</p>
            ) : (
              <div className="overview-grid">
                {summary.topLevel.map((page) => (
                  <PageCard key={page.id} page={page} pages={pages} onSelect={onSelect} />
                ))}
              </div>
            )}
          </section>
          {tree.length > 0 ? (
            <section className="overview-section">
              <h2>页面结构</h2>
              <div className="overview-tree">
                {tree.map((node) => (
                  <OverviewBranch key={node.page.id} node={node} depth={0} onSelect={onSelect} />
                ))}
              </div>
            </section>
          ) : null}
        </>
      )}
    </div>
  )
}

function PageCard({
  page,
  pages,
  onSelect
}: {
  page: SearchPage
  pages: SearchPage[]
  onSelect: (id: string) => void
}) {
  const childCount = pages.filter((item) => item.parentId && compactId(item.parentId) === compactId(page.id)).length
  return (
    <button type="button" className="overview-card" onClick={() => onSelect(page.id)}>
      <span className="overview-card-title">{page.title || '无标题'}</span>
      <span className="overview-card-meta">{childCount ? `${childCount} 个子页面` : '页面'}</span>
    </button>
  )
}

function OverviewBranch({
  node,
  depth,
  onSelect
}: {
  node: PageTreeNode
  depth: number
  onSelect: (id: string) => void
}) {
  return (
    <div className="overview-tree-block">
      <button
        type="button"
        className="overview-tree-row"
        style={{ paddingLeft: 8 + depth * 16 }}
        onClick={() => onSelect(node.page.id)}
      >
        {node.page.title || '无标题'}
      </button>
      {node.children.map((child) => (
        <OverviewBranch key={child.page.id} node={child} depth={depth + 1} onSelect={onSelect} />
      ))}
    </div>
  )
}
