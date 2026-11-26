import {
  ENTERPRISE_BUDGET,
  MetricsRing,
  STANDARD_BUDGET,
  type NotionActionBatch,
  type PlanBudget
} from '@shared/notionMetrics'

const ring = new MetricsRing()
const listeners = new Set<() => void>()

const PLAN_KEY = 'sln-plan-budget'

export function loadPlanBudget(): PlanBudget {
  try {
    const raw = window.localStorage.getItem(PLAN_KEY)
    return raw === '600' ? ENTERPRISE_BUDGET : STANDARD_BUDGET
  } catch {
    return STANDARD_BUDGET
  }
}

export function savePlanBudget(budget: PlanBudget): void {
  try {
    window.localStorage.setItem(PLAN_KEY, String(budget))
  } catch {
    // memory-only fallback
  }
  emit()
}

export interface ResponseMeta {
  cache?: 'HIT' | 'MISS' | null
  action?: NotionActionBatch['action']
  notionRequests?: NotionActionBatch['requests']
}

export function ingestResponseMeta(meta: ResponseMeta | undefined, label?: string): void {
  if (!meta) return
  const requests = Array.isArray(meta.notionRequests) ? meta.notionRequests : []
  const batch: NotionActionBatch = {
    action: meta.action || requests[0]?.action || 'unknown',
    t: requests[0]?.t || Date.now(),
    cache: meta.cache ?? null,
    requests,
    label
  }
  ring.add(batch)
  emit()
}

export function relabelLastAction(label: string): void {
  ring.labelLast(label)
  emit()
}

export function getClientMetrics(budget: PlanBudget = loadPlanBudget()) {
  return ring.snapshot(Date.now(), budget)
}

export function subscribeMetrics(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function emit() {
  for (const listener of listeners) listener()
}

export function _resetClientMetrics() {
  ring.clear()
  emit()
}
