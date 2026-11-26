import { describe, expect, it } from 'vitest'
import type { SearchPage } from '../shared/types'
import { buildPageTree, collectExpandIds, compactId } from '../src/pageTree'

function page(id: string, title: string, parentId: string | null): SearchPage {
  return { id, title, parentId }
}

describe('buildPageTree', () => {
  it('groups pages by parent and treats missing parents as roots', () => {
    const root = page('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Root', null)
    const child = page('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Child', root.id)
    const other = page('cccccccc-cccc-cccc-cccc-cccccccccccc', 'Orphan', 'dddddddd-dddd-dddd-dddd-dddddddddddd')
    const tree = buildPageTree([root, child, other])
    expect(tree.map((n) => n.page.title)).toEqual(['Root', 'Orphan'])
    expect(tree[0]?.children.map((n) => n.page.title)).toEqual(['Child'])
    expect(tree[1]?.children).toEqual([])
  })

  it('breaks parent cycles so every page still appears once', () => {
    const a = page('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'A', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb')
    const b = page('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'B', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')
    const titles = flattenTitles(buildPageTree([a, b])).sort()
    expect(titles).toEqual(['A', 'B'])
  })
})

describe('collectExpandIds', () => {
  it('includes ancestors of the current page', () => {
    const root = page('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Root', null)
    const mid = page('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Mid', root.id)
    const leaf = page('cccccccc-cccc-cccc-cccc-cccccccccccc', 'Leaf', mid.id)
    const ids = collectExpandIds([root, mid, leaf], leaf.id, false)
    expect([...ids].sort()).toEqual([compactId(root.id), compactId(mid.id)].sort())
  })

  it('expands every branch when searching', () => {
    const root = page('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Root', null)
    const mid = page('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Mid', root.id)
    const leaf = page('cccccccc-cccc-cccc-cccc-cccccccccccc', 'Leaf', mid.id)
    const ids = collectExpandIds([root, mid, leaf], null, true)
    expect(ids.has(compactId(root.id))).toBe(true)
    expect(ids.has(compactId(mid.id))).toBe(true)
    expect(ids.has(compactId(leaf.id))).toBe(false)
  })
})

function flattenTitles(nodes: ReturnType<typeof buildPageTree>): string[] {
  return nodes.flatMap((n) => [n.page.title, ...flattenTitles(n.children)])
}
