import type { DatabasePropertySchema, DatabaseView } from '@shared/types'
import {
  checkboxChecked,
  formatPropertyValue,
  isCheckboxProperty,
  rowTitle
} from '@shared/database'

export function DatabaseTable({
  view,
  mapPageUrl,
  onOpenPage
}: {
  view?: DatabaseView
  mapPageUrl: (id: string) => string
  onOpenPage?: (id: string) => void
}) {
  if (!view) {
    return <div className="db-table-empty muted">正在加载数据库…</div>
  }
  if (view.error) {
    return (
      <div className="db-table-wrap">
        {view.title ? <div className="db-table-title">{view.icon ? `${view.icon} ` : ''}{view.title}</div> : null}
        <div className="db-table-error">无法加载此数据库（无权限或已删除）</div>
      </div>
    )
  }

  const columns = view.properties
  const titleProp = columns.find((col) => col.type === 'title')

  return (
    <div className="db-table-wrap">
      <div className="db-table-title">
        {view.icon ? <span className="db-table-icon">{view.icon}</span> : null}
        <span>{view.title || '无标题'}</span>
      </div>
      <div className="db-table-scroll">
        <table className="db-table">
          <thead>
            <tr>
              {columns.map((col) => (
                <th key={col.id || col.name}>{col.name}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {view.rows.length === 0 ? (
              <tr>
                <td className="db-table-empty" colSpan={Math.max(columns.length, 1)}>
                  没有条目
                </td>
              </tr>
            ) : (
              view.rows.map((row) => (
                <tr key={row.id}>
                  {columns.map((col) => (
                    <td key={col.id || col.name} className={cellClass(col, row.properties[col.name])}>
                      {renderCell(col, row, titleProp, mapPageUrl, onOpenPage)}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {view.hasMore ? (
        <div className="db-table-more muted">仅显示前 {view.rows.length} 行</div>
      ) : null}
    </div>
  )
}

function cellClass(col: DatabasePropertySchema, property: unknown): string {
  if (col.type === 'title') return 'db-cell-title'
  if (col.type === 'checkbox' || isCheckboxProperty(property)) return 'db-cell-check'
  if (col.type === 'select' || col.type === 'status' || col.type === 'multi_select') return 'db-cell-tag'
  return ''
}

function renderCell(
  col: DatabasePropertySchema,
  row: DatabaseView['rows'][number],
  titleProp: DatabasePropertySchema | undefined,
  mapPageUrl: (id: string) => string,
  onOpenPage?: (id: string) => void
) {
  const property = row.properties[col.name]
  if (col.type === 'checkbox' || isCheckboxProperty(property)) {
    return (
      <span className={checkboxChecked(property) ? 'db-check on' : 'db-check'} aria-hidden>
        {checkboxChecked(property) ? '☑' : '☐'}
      </span>
    )
  }
  if (col.type === 'select' || col.type === 'status') {
    const label = formatPropertyValue(property)
    return label ? <span className="db-tag">{label}</span> : null
  }
  if (col.type === 'multi_select') {
    const labels = formatPropertyValue(property)
      .split(', ')
      .filter(Boolean)
    return (
      <>
        {labels.map((label) => (
          <span key={label} className="db-tag">
            {label}
          </span>
        ))}
      </>
    )
  }
  const text = col.type === 'title' ? rowTitle(row, titleProp ? [titleProp] : []) : formatPropertyValue(property)
  if (col.type === 'title' || col === titleProp) {
    return (
      <a
        className="db-row-link"
        href={mapPageUrl(row.id)}
        onClick={(event) => {
          if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return
          event.preventDefault()
          if (onOpenPage) onOpenPage(row.id)
          else {
            const url = new URL(window.location.href)
            url.searchParams.set('p', row.id.replace(/-/g, ''))
            window.history.pushState({ p: row.id }, '', url)
            window.dispatchEvent(new PopStateEvent('popstate'))
          }
        }}
      >
        {text}
      </a>
    )
  }
  if (col.type === 'url' && text) {
    return (
      <a href={text} target="_blank" rel="noreferrer" className="db-ext-link">
        {text}
      </a>
    )
  }
  return text
}
