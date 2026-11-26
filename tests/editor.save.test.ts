/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { OfficialRichText } from '../shared/types'
import { officialFromEditor, seedEditorHtml } from '../src/editor/dom'
import { enqueueUpdateIfChanged } from '../src/editor/changes'
import { SaveQueue } from '../src/editor/saveQueue'
import type { ExtendedRecordMap } from 'notion-types'

const BLOCK = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const PAGE = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
const origFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = origFetch
  vi.useRealTimers()
})

function recordMap(title: OfficialRichText['text']['content'] = 'Hello'): ExtendedRecordMap {
  return {
    block: {
      [BLOCK]: {
        role: 'reader',
        value: {
          id: BLOCK,
          type: 'text',
          properties: { title: [[title]] }
        }
      }
    }
  } as unknown as ExtendedRecordMap
}

function trackPatches() {
  const patches: unknown[] = []
  const statuses: string[] = []
  globalThis.fetch = (async (input, init) => {
    const url = String(input)
    const method = (init?.method || 'GET').toUpperCase()
    if (method === 'PATCH' && url.includes('/api/block/')) {
      patches.push(init?.body ? JSON.parse(String(init.body)) : null)
    }
    return new Response(JSON.stringify({ block: { id: BLOCK, last_edited_time: '2026-01-03T00:00:00.000Z' } }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    })
  }) as typeof fetch
  const queue = new SaveQueue({
    debounceMs: 10_000,
    onStatus: (status) => statuses.push(status)
  })
  return { patches, statuses, queue }
}

describe('no-op editor saves', () => {
  it('does not enqueue or call the save API when opening a block and committing unchanged', async () => {
    const { patches, statuses, queue } = trackPatches()
    const editor = document.createElement('div')
    editor.innerHTML = seedEditorHtml(recordMap('Hello'), BLOCK)
    const baseline = officialFromEditor(editor)

    const changed = enqueueUpdateIfChanged(queue, baseline, {
      kind: 'update',
      blockId: BLOCK,
      pageId: PAGE,
      richText: officialFromEditor(editor)
    })

    expect(changed).toBe(false)
    expect(statuses).toEqual([])
    await queue.flush()
    expect(patches).toEqual([])
  })

  it('does not save when text is typed and then restored to the baseline', async () => {
    const { patches, statuses, queue } = trackPatches()
    const editor = document.createElement('div')
    editor.innerHTML = seedEditorHtml(recordMap('Hello'), BLOCK)
    const baseline = officialFromEditor(editor)

    editor.textContent = 'Hello!'
    expect(
      enqueueUpdateIfChanged(queue, baseline, {
        kind: 'update',
        blockId: BLOCK,
        pageId: PAGE,
        richText: officialFromEditor(editor)
      })
    ).toBe(true)
    expect(statuses).toContain('saving')

    editor.textContent = 'Hello'
    expect(
      enqueueUpdateIfChanged(queue, baseline, {
        kind: 'update',
        blockId: BLOCK,
        pageId: PAGE,
        richText: officialFromEditor(editor)
      })
    ).toBe(false)

    await queue.flush()
    expect(patches).toEqual([])
  })

  it('enqueues a save and calls the API when content actually changes', async () => {
    const { patches, queue } = trackPatches()
    const editor = document.createElement('div')
    editor.innerHTML = seedEditorHtml(recordMap('Hello'), BLOCK)
    const baseline = officialFromEditor(editor)

    editor.textContent = 'Hello world'
    const current = officialFromEditor(editor)
    expect(enqueueUpdateIfChanged(queue, baseline, {
      kind: 'update',
      blockId: BLOCK,
      pageId: PAGE,
      richText: current
    })).toBe(true)

    await queue.flush()
    expect(patches).toHaveLength(1)
    const body = patches[0] as { richText: OfficialRichText[]; pageId: string }
    expect(body.pageId).toBe(PAGE)
    expect(body.richText.map((t) => t.text.content).join('')).toBe('Hello world')
  })
})

describe('rich text baseline used after a real save', () => {
  it('does not double-save the same committed content', async () => {
    const { patches, queue } = trackPatches()
    const editor = document.createElement('div')
    editor.innerHTML = seedEditorHtml(recordMap('Hello'), BLOCK)
    let baseline = officialFromEditor(editor)

    editor.textContent = 'Edited'
    const first = officialFromEditor(editor)
    expect(enqueueUpdateIfChanged(queue, baseline, {
      kind: 'update',
      blockId: BLOCK,
      pageId: PAGE,
      richText: first
    })).toBe(true)
    baseline = first
    await queue.flush()
    expect(patches).toHaveLength(1)

    expect(enqueueUpdateIfChanged(queue, baseline, {
      kind: 'update',
      blockId: BLOCK,
      pageId: PAGE,
      richText: officialFromEditor(editor)
    })).toBe(false)
    await queue.flush()
    expect(patches).toHaveLength(1)
  })
})
