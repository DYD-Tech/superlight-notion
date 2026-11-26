import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentProps } from 'react'
import { NotionRenderer } from 'react-notion-x'
import type { ExtendedRecordMap } from 'notion-types'
import type { DatabaseView } from '@shared/types'
import { DatabaseTable } from './DatabaseTable'
import { UnsupportedBlock } from './UnsupportedBlock'
import { SaveQueue, type SaveStatus } from '../editor/saveQueue'
import {
  blockIdFromElement,
  findBlockElement,
  findTextHost,
  isCheckboxClick,
  isChecked,
  isEditableBlock,
  lastEditedOf,
  mountInlineEditor,
  officialFromEditor,
  placeCaretAtPoint,
  seedEditorHtml,
  type InlineEditorSession
} from '../editor/dom'
import { officialToDecorations } from '@shared/richText'
import type { OfficialRichText } from '@shared/types'
import { enqueueUpdateIfChanged } from '../editor/changes'
import { api } from '../api'
import { stripDashes } from '@shared/ids'

const Code = lazy(() => import('react-notion-x/third-party/code').then((m) => ({ default: m.Code })))

function LazyCode(props: ComponentProps<typeof Code>) {
  return (
    <Suspense fallback={<pre className="code-fallback">代码加载中…</pre>}>
      <Code {...props} />
    </Suspense>
  )
}

export function PageView({
  pageId,
  recordMap,
  rootPageId,
  darkMode,
  blockTimes,
  lazyBlockIds = [],
  databases = {},
  onRecordMap,
  onBlockTimes,
  onLazyBlockIds,
  onDatabases,
  onStatus,
  onNeedRefresh
}: {
  pageId: string
  recordMap: ExtendedRecordMap
  rootPageId: string | null
  darkMode: boolean
  blockTimes: Record<string, string>
  lazyBlockIds?: string[]
  databases?: Record<string, DatabaseView>
  onRecordMap: (rm: ExtendedRecordMap) => void
  onBlockTimes?: (times: Record<string, string>) => void
  onLazyBlockIds?: (ids: string[]) => void
  onDatabases?: (databases: Record<string, DatabaseView>) => void
  onStatus: (status: SaveStatus, message?: string) => void
  onNeedRefresh: () => void
}) {
  const editorRef = useRef<HTMLElement | null>(null)
  const sessionRef = useRef<InlineEditorSession | null>(null)
  const editingId = useRef<string | null>(null)
  const queueRef = useRef<SaveQueue | null>(null)
  const recordRef = useRef(recordMap)
  const timesRef = useRef(blockTimes)
  const lastSavedRef = useRef<Record<string, OfficialRichText[]>>({})
  recordRef.current = recordMap
  timesRef.current = blockTimes
  const lazyRef = useRef(new Set(lazyBlockIds))
  const loadedRef = useRef(new Set<string>())
  const loadingRef = useRef(new Set<string>())
  const expandedRef = useRef(new Set<string>())
  const [toggleUi, setToggleUi] = useState<Record<string, 'loading' | 'error'>>({})
  lazyRef.current = new Set([...lazyRef.current, ...lazyBlockIds])

  useEffect(() => {
    lazyRef.current = new Set(lazyBlockIds)
    loadedRef.current = new Set()
    loadingRef.current = new Set()
    expandedRef.current = new Set()
    setToggleUi({})
  }, [pageId])

  useLayoutEffect(() => {
    const root = document.querySelector('.page-canvas')
    if (!root) return
    for (const id of expandedRef.current) {
      const el = root.querySelector(`details.notion-block-${stripDashes(id)}`) as HTMLDetailsElement | null
      if (el) el.open = true
    }
  }, [recordMap])

  useEffect(() => {
    const queue = new SaveQueue({
      onStatus,
      onConflict: () => onNeedRefresh(),
      onSettled: (op, result) => {
        if (op.kind === 'update' && result && typeof result === 'object' && 'block' in result) {
          const t = (result as { block?: { last_edited_time?: string } }).block?.last_edited_time
          if (t) timesRef.current[op.blockId] = t
          if (op.richText) lastSavedRef.current[op.blockId] = op.richText
        }
        if (op.kind === 'append' || op.kind === 'delete') onNeedRefresh()
      }
    })
    queueRef.current = queue
    return () => {
      void queue.flush()
    }
  }, [pageId, onStatus, onNeedRefresh])

  const mapPageUrl = useCallback((id: string) => `/?p=${id.replace(/-/g, '')}`, [])
  const mapImageUrl = useCallback((url?: string) => {
    if (!url) return url ?? ''
    if (url.startsWith('/api/img')) return url
    return `/api/img?u=${encodeURIComponent(url)}`
  }, [])

  const components = useMemo(
    () => ({
      Code: LazyCode,
      Collection: function Collection({ block }: { block?: { id?: string } }) {
        const id = block?.id
        return (
          <DatabaseTable
            view={id ? databases[id] : undefined}
            mapPageUrl={mapPageUrl}
          />
        )
      },
      Equation: UnsupportedBlock,
      Modal: UnsupportedBlock,
      Pdf: UnsupportedBlock
    }),
    [databases, mapPageUrl]
  )

  const commitEditor = useCallback(() => {
    const editor = editorRef.current
    const id = editingId.current
    const queue = queueRef.current
    if (!editor || !id || !queue) return
    const richText = officialFromEditor(editor)
    const changed = enqueueUpdateIfChanged(queue, lastSavedRef.current[id], {
      kind: 'update',
      blockId: id,
      pageId,
      richText,
      lastEditedTime: lastEditedOf(recordRef.current, id, timesRef.current)
    })
    if (!changed) return
    patchLocalTitle(recordRef.current, id, richText, onRecordMap)
    lastSavedRef.current[id] = richText
  }, [onRecordMap, pageId])

  const teardownEditor = useCallback(
    (commit: boolean) => {
      const id = editingId.current
      if (editorRef.current && commit) commitEditor()
      else if (id) queueRef.current?.cancelUpdate(id)
      sessionRef.current?.teardown()
      sessionRef.current = null
      editorRef.current = null
      editingId.current = null
    },
    [commitEditor]
  )

  const startEditor = useCallback(
    (blockEl: HTMLElement, blockId: string, ev?: MouseEvent) => {
      if (editingId.current === blockId && editorRef.current) {
        return
      }
      teardownEditor(true)
      const host = findTextHost(blockEl)
      const session = mountInlineEditor(host, seedEditorHtml(recordRef.current, blockId))
      sessionRef.current = session
      editorRef.current = session.editor
      editingId.current = blockId
      lastSavedRef.current[blockId] = officialFromEditor(session.editor)
      placeCaretAtPoint(session.editor, ev?.clientX, ev?.clientY)
    },
    [teardownEditor]
  )

  useEffect(() => {
    const root = document.querySelector('.page-canvas')
    if (!root) return

    const onClick = (event: Event) => {
      const ev = event as MouseEvent
      const target = ev.target
      const blockEl = findBlockElement(target)
      const blockId = blockIdFromElement(blockEl)
      if (!blockEl || !blockId) {
        if (editingId.current) teardownEditor(true)
        return
      }

      // Internal page links — client-side navigation via query string is handled by the browser.
      if (target instanceof Element && target.closest('a')) {
        return
      }

      if (isCheckboxClick(target) && isEditableBlock(recordRef.current, blockId)) {
        ev.preventDefault()
        ev.stopPropagation()
        const next = !isChecked(recordRef.current, blockId)
        patchLocalChecked(recordRef.current, blockId, next, onRecordMap)
        queueRef.current?.enqueue({
          kind: 'update',
          blockId,
          pageId,
          checked: next,
          lastEditedTime: lastEditedOf(recordRef.current, blockId, timesRef.current)
        })
        return
      }

      if (!isEditableBlock(recordRef.current, blockId)) {
        if (editingId.current) teardownEditor(true)
        return
      }
      startEditor(blockEl, blockId, ev)
    }

    const onKeyDown = (event: Event) => {
      const ev = event as KeyboardEvent
      const editor = editorRef.current
      const id = editingId.current
      if (!editor || !id || !editor.contains(ev.target as Node)) return

      const meta = ev.metaKey || ev.ctrlKey
      if (meta && ev.key.toLowerCase() === 'b') {
        ev.preventDefault()
        document.execCommand('bold')
        return
      }
      if (meta && ev.key.toLowerCase() === 'i') {
        ev.preventDefault()
        document.execCommand('italic')
        return
      }
      if (meta && ev.key.toLowerCase() === 'e') {
        ev.preventDefault()
        document.execCommand('insertHTML', false, wrapSelection('code'))
        return
      }
      if (meta && ev.key.toLowerCase() === 'k') {
        ev.preventDefault()
        const url = window.prompt('链接地址')
        if (url) document.execCommand('createLink', false, url)
        return
      }
      if (ev.key === 'Escape') {
        ev.preventDefault()
        teardownEditor(false)
        return
      }
      if (ev.key === 'Enter' && !ev.shiftKey) {
        ev.preventDefault()
        commitEditor()
        queueRef.current?.enqueue({ kind: 'append', afterId: id, pageId })
        teardownEditor(false)
        return
      }
      if (ev.key === 'Backspace') {
        const text = editor.innerText.replace(/\u00a0/g, ' ').trim()
        if (!text) {
          ev.preventDefault()
          teardownEditor(false)
          queueRef.current?.enqueue({ kind: 'delete', blockId: id, pageId })
        }
      }
    }

    const onInput = () => {
      const editor = editorRef.current
      const id = editingId.current
      const queue = queueRef.current
      if (!editor || !id || !queue) return
      const richText = officialFromEditor(editor)
      enqueueUpdateIfChanged(queue, lastSavedRef.current[id], {
        kind: 'update',
        blockId: id,
        pageId,
        richText,
        lastEditedTime: lastEditedOf(recordRef.current, id, timesRef.current)
      })
    }

    const onPointerDownCapture = (event: Event) => {
      const editor = editorRef.current
      if (!editor) return
      const target = event.target
      if (target instanceof Node && editor.contains(target)) return
      const blockEl = findBlockElement(target)
      const blockId = blockIdFromElement(blockEl)
      if (blockId && blockId === editingId.current) return
      teardownEditor(true)
    }

    let cancelled = false
    const onToggle = (event: Event) => {
      const details = event.target
      if (!(details instanceof HTMLDetailsElement) || !details.classList.contains('notion-toggle')) return
      if (!details.open) return
      const blockId = blockIdFromElement(details)
      if (!blockId) return
      expandedRef.current.add(blockId)
      if (!lazyRef.current.has(blockId) || loadedRef.current.has(blockId) || loadingRef.current.has(blockId)) {
        return
      }
      loadingRef.current.add(blockId)
      setToggleUi((prev) => ({ ...prev, [blockId]: 'loading' }))
      const requestedPageId = pageId
      void (async () => {
        try {
          const data = await api.blockChildren(blockId, requestedPageId)
          if (cancelled || requestedPageId !== pageId) return
          const next = cloneRecordMap(recordRef.current)
          for (const [id, wrap] of Object.entries(data.recordMap.block ?? {})) {
            if (id === blockId) continue
            next.block[id] = wrap as (typeof next.block)[string]
          }
          const prev = next.block[blockId]
          if (prev) {
            const value = { ...(prev as { value: Record<string, unknown> }).value, content: data.content }
            next.block[blockId] = { ...(prev as object), value } as (typeof next.block)[string]
          }
          onRecordMap(next)
          if (data.databases && Object.keys(data.databases).length) {
            onDatabases?.(data.databases)
          }
          if (data.lazyBlockIds?.length) {
            for (const id of data.lazyBlockIds) lazyRef.current.add(id)
            onLazyBlockIds?.(data.lazyBlockIds)
          }
          const times: Record<string, string> = {}
          for (const [id, wrap] of Object.entries(data.recordMap.block ?? {})) {
            const raw = (wrap as { value?: { last_edited_time?: number | string } }).value?.last_edited_time
            if (typeof raw === 'number') times[id] = new Date(raw).toISOString()
            else if (typeof raw === 'string') times[id] = raw
          }
          if (Object.keys(times).length) onBlockTimes?.(times)
          loadedRef.current.add(blockId)
          setToggleUi((cur) => {
            const nextState = { ...cur }
            delete nextState[blockId]
            return nextState
          })
        } catch {
          if (cancelled || requestedPageId !== pageId) return
          setToggleUi((cur) => ({ ...cur, [blockId]: 'error' }))
        } finally {
          loadingRef.current.delete(blockId)
        }
      })()
    }

    root.addEventListener('click', onClick)
    root.addEventListener('keydown', onKeyDown)
    root.addEventListener('input', onInput)
    root.addEventListener('toggle', onToggle, true)
    document.addEventListener('pointerdown', onPointerDownCapture, true)
    return () => {
      cancelled = true
      root.removeEventListener('click', onClick)
      root.removeEventListener('keydown', onKeyDown)
      root.removeEventListener('input', onInput)
      root.removeEventListener('toggle', onToggle, true)
      document.removeEventListener('pointerdown', onPointerDownCapture, true)
    }
  }, [pageId, onRecordMap, onBlockTimes, onLazyBlockIds, onDatabases, startEditor, commitEditor, teardownEditor])

  return (
    <div className="page-canvas">
      <NotionRenderer
        recordMap={recordMap}
        fullPage
        darkMode={darkMode}
        rootPageId={rootPageId ?? undefined}
        mapPageUrl={mapPageUrl}
        mapImageUrl={mapImageUrl}
        components={components}
        isImageZoomable={false}
        previewImages={false}
        showCollectionViewDropdown={false}
        disableHeader
        className="sln-notion"
      />
      {Object.entries(toggleUi).map(([id, state]) =>
        state === 'loading' ? (
          <div key={id} className="toggle-status muted">
            正在加载折叠内容…
          </div>
        ) : (
          <div key={id} className="toggle-status error">
            折叠内容加载失败，请再展开一次重试。
          </div>
        )
      )}
      <p className="hint">
        点击文字即可编辑。Enter 在后面插入新段落，空块上按 Backspace 删除。Ctrl/Cmd+B / I / E / K
        分别是加粗、斜体、行内代码和链接。
      </p>
    </div>
  )
}

function wrapSelection(tag: string): string {
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0) return ''
  const text = sel.toString()
  return `<${tag}>${escapeHtml(text)}</${tag}>`
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function cloneRecordMap(rm: ExtendedRecordMap): ExtendedRecordMap {
  return {
    ...rm,
    block: { ...rm.block }
  }
}

function patchLocalTitle(
  rm: ExtendedRecordMap,
  blockId: string,
  richText: OfficialRichText[],
  publish: (rm: ExtendedRecordMap) => void
) {
  const next = cloneRecordMap(rm)
  const prev = rm.block[blockId]
  if (!prev) return
  const value = { ...(prev as { value: Record<string, unknown> }).value }
  const properties = { ...((value.properties as Record<string, unknown>) || {}) }
  properties.title = officialToDecorations(richText)
  value.properties = properties
  next.block[blockId] = { ...(prev as object), value } as (typeof next.block)[string]
  publish(next)
}

function patchLocalChecked(
  rm: ExtendedRecordMap,
  blockId: string,
  checked: boolean,
  publish: (rm: ExtendedRecordMap) => void
) {
  const next = cloneRecordMap(rm)
  const prev = rm.block[blockId]
  if (!prev) return
  const value = { ...(prev as { value: Record<string, unknown> }).value }
  const properties = { ...((value.properties as Record<string, unknown>) || {}) }
  properties.checked = [[checked ? 'Yes' : 'No']]
  value.properties = properties
  next.block[blockId] = { ...(prev as object), value } as (typeof next.block)[string]
  publish(next)
}
