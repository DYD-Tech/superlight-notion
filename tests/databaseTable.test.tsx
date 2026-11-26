/** @vitest-environment jsdom */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { describe, expect, it, afterEach } from 'vitest'
import { DatabaseTable } from '../src/components/DatabaseTable'
import type { DatabaseView } from '../shared/types'

const VIEW: DatabaseView = {
  id: 'db-1',
  title: '工作台条目',
  icon: '📒',
  properties: [
    { id: 'title', name: 'Name', type: 'title' },
    { id: 'st', name: 'Status', type: 'select' },
    { id: 'do', name: 'Done', type: 'checkbox' }
  ],
  rows: [
    {
      id: 'row-1',
      properties: {
        Name: { type: 'title', title: [{ type: 'text', text: { content: 'Alpha' }, plain_text: 'Alpha' }] },
        Status: { type: 'select', select: { name: 'Open' } },
        Done: { type: 'checkbox', checkbox: true }
      }
    }
  ],
  hasMore: true
}

let root: Root | null = null
let host: HTMLDivElement | null = null

async function render(view?: DatabaseView) {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => {
    root!.render(<DatabaseTable view={view} mapPageUrl={(id) => `/?p=${id}`} />)
  })
  return host
}

afterEach(async () => {
  if (root) {
    const current = root
    await act(async () => {
      current.unmount()
    })
  }
  root = null
  host?.remove()
  host = null
})

describe('DatabaseTable', () => {
  it('renders title, visible columns, row title link, and hasMore note', async () => {
    const el = await render(VIEW)
    expect(el.textContent).toContain('工作台条目')
    expect(el.textContent).toContain('Name')
    expect(el.textContent).toContain('Status')
    expect(el.textContent).toContain('Open')
    expect(el.textContent).toContain('仅显示前 1 行')
    const link = el.querySelector('a.db-row-link') as HTMLAnchorElement
    expect(link).toBeTruthy()
    expect(link.textContent).toBe('Alpha')
    expect(link.getAttribute('href')).toBe('/?p=row-1')
  })

  it('renders a permission error without crashing', async () => {
    const el = await render({
      id: 'db-2',
      title: 'Secret',
      properties: [],
      rows: [],
      hasMore: false,
      error: 'unavailable'
    })
    expect(el.textContent).toContain('无法加载此数据库')
  })
})
