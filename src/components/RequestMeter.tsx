import { useEffect, useMemo, useState } from 'react'
import {
  ENTERPRISE_BUDGET,
  QUERY_LIMIT_PER_SEC,
  STANDARD_BUDGET,
  endpointBreakdown,
  type PlanBudget
} from '@shared/notionMetrics'
import { getClientMetrics, loadPlanBudget, savePlanBudget, subscribeMetrics } from '../metrics'

const ACTION_LABEL: Record<string, string> = {
  page_open: '打开页面',
  sidebar_load: '侧边栏',
  database_query: '数据库查询',
  toggle_expand: '展开折叠',
  block_edit: '编辑块',
  block_append: '插入块',
  block_delete: '删除块',
  unknown: '其他'
}

export function RequestMeter() {
  const [budget, setBudget] = useState<PlanBudget>(() => loadPlanBudget())
  const [open, setOpen] = useState(false)
  const [tick, setTick] = useState(0)

  useEffect(() => subscribeMetrics(() => setTick((n) => n + 1)), [])
  useEffect(() => {
    const id = window.setInterval(() => setTick((n) => n + 1), 1000)
    return () => window.clearInterval(id)
  }, [])

  const snapshot = useMemo(() => getClientMetrics(budget), [budget, tick])
  const queryHot = snapshot.queryUsed1s >= QUERY_LIMIT_PER_SEC

  return (
    <div className={`req-meter${open ? ' open' : ''}`}>
      <button
        type="button"
        className="req-meter-pill"
        onClick={() => setOpen((v) => !v)}
        title="Notion API 请求计量"
        aria-expanded={open}
      >
        <span>
          {snapshot.used} / {budget} req (60s)
        </span>
        <span className={queryHot ? 'req-meter-query hot' : 'req-meter-query'}>
          DB {snapshot.queryUsed1s}/{QUERY_LIMIT_PER_SEC}/s
        </span>
      </button>
      {open ? (
        <div className="req-meter-pop" role="dialog" aria-label="Notion 请求计量">
          <div className="req-meter-row">
            <strong>
              {snapshot.used} / {budget} · 剩余 {snapshot.remaining}
            </strong>
            <div className="req-meter-plan">
              <button
                type="button"
                className={budget === STANDARD_BUDGET ? 'on' : ''}
                onClick={() => {
                  setBudget(STANDARD_BUDGET)
                  savePlanBudget(STANDARD_BUDGET)
                }}
              >
                180
              </button>
              <button
                type="button"
                className={budget === ENTERPRISE_BUDGET ? 'on' : ''}
                onClick={() => {
                  setBudget(ENTERPRISE_BUDGET)
                  savePlanBudget(ENTERPRISE_BUDGET)
                }}
              >
                600
              </button>
            </div>
          </div>
          <div className={queryHot ? 'req-meter-query hot' : 'req-meter-query'}>
            数据源查询 {snapshot.queryUsed1s} / {QUERY_LIMIT_PER_SEC}（近 1 秒）
          </div>
          <ol className="req-meter-actions">
            {snapshot.actions.length === 0 ? <li className="muted">还没有记录到请求</li> : null}
            {[...snapshot.actions].reverse().map((batch, index) => {
              const endpoints = endpointBreakdown(batch.requests)
              const title = batch.label
                ? `${batch.label} (${batch.action})`
                : ACTION_LABEL[batch.action] || batch.action
              const cache = batch.cache === 'HIT' ? ' · cache hit' : batch.cache === 'MISS' ? ' · cache miss' : ''
              return (
                <li key={`${batch.t}-${index}`}>
                  <div>
                    {title}: {batch.requests.length} req{cache}
                  </div>
                  {Object.keys(endpoints).length ? (
                    <ul>
                      {Object.entries(endpoints).map(([key, count]) => (
                        <li key={key}>
                          {key} × {count}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              )
            })}
          </ol>
          {snapshot.recent429.length ? (
            <div className="req-meter-429">
              最近 429/529：
              {snapshot.recent429.map((event, index) => (
                <div key={`${event.t}-${index}`}>
                  {event.status} {event.endpoint}
                  {event.rateLimitReason ? ` · ${event.rateLimitReason}` : ''}
                </div>
              ))}
            </div>
          ) : null}
          <p className="req-meter-note">{snapshot.note}</p>
        </div>
      ) : null}
    </div>
  )
}
