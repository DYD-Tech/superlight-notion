import type { SearchPage } from '@shared/types'

export interface PageTreeNode {
  page: SearchPage
  children: PageTreeNode[]
}

export function compactId(id: string): string {
  return id.replace(/-/g, '').toLowerCase()
}

/** Build a forest from a flat page list. Roots have no parent in the list. Cycles are broken. */
export function buildPageTree(pages: SearchPage[]): PageTreeNode[] {
  const byId = new Map<string, SearchPage>()
  for (const page of pages) byId.set(compactId(page.id), page)

  const childrenOf = new Map<string, SearchPage[]>()
  const pendingRoots: SearchPage[] = []

  for (const page of pages) {
    const self = compactId(page.id)
    const parentKey = page.parentId ? compactId(page.parentId) : null
    if (!parentKey || parentKey === self || !byId.has(parentKey)) {
      pendingRoots.push(page)
      continue
    }
    const siblings = childrenOf.get(parentKey) ?? []
    siblings.push(page)
    childrenOf.set(parentKey, siblings)
  }

  const visiting = new Set<string>()
  const visited = new Set<string>()

  function walk(page: SearchPage): PageTreeNode | null {
    const key = compactId(page.id)
    if (visiting.has(key)) return null
    visiting.add(key)
    visited.add(key)
    const children = (childrenOf.get(key) ?? [])
      .map(walk)
      .filter((node): node is PageTreeNode => node !== null)
    visiting.delete(key)
    return { page, children }
  }

  const roots = pendingRoots.map(walk).filter((node): node is PageTreeNode => node !== null)
  for (const page of pages) {
    if (!visited.has(compactId(page.id))) {
      const node = walk(page)
      if (node) roots.push(node)
    }
  }
  return roots
}

/** IDs that should be expanded: ancestors of currentId, and every parent when searching. */
export function collectExpandIds(
  pages: SearchPage[],
  currentId: string | null,
  expandAllBranches: boolean
): Set<string> {
  const ids = new Set<string>()
  const byId = new Map(pages.map((page) => [compactId(page.id), page]))

  if (currentId) {
    let current = byId.get(compactId(currentId))
    const seen = new Set<string>()
    while (current?.parentId) {
      const key = compactId(current.parentId)
      if (seen.has(key)) break
      seen.add(key)
      if (!byId.has(key)) break
      ids.add(key)
      current = byId.get(key)
    }
  }

  if (expandAllBranches) {
    const visit = (nodes: PageTreeNode[]) => {
      for (const node of nodes) {
        if (node.children.length) {
          ids.add(compactId(node.page.id))
          visit(node.children)
        }
      }
    }
    visit(buildPageTree(pages))
  }

  return ids
}
