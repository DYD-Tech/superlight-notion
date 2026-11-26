import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, type ComponentProps } from 'react'
import { NotionRenderer } from 'react-notion-x'
import type { ExtendedRecordMap } from 'notion-types'
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
  onRecordMap,
  onStatus,
  onNeedRefresh
}: {
  pageId: string
  recordMap: ExtendedRecordMap
  rootPageId: string | null
  darkMode: boolean
  blockTimes: Record<string, string>
  onRecordMap: (rm: ExtendedRecordMap) => void
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
      Collection: UnsupportedBlock,
      Equation: UnsupportedBlock,
      Modal: UnsupportedBlock,
      Pdf: UnsupportedBlock
    }),
    []
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

    root.addEventListener('click', onClick)
    root.addEventListener('keydown', onKeyDown)
    root.addEventListener('input', onInput)
    document.addEventListener('pointerdown', onPointerDownCapture, true)
    return () => {
      root.removeEventListener('click', onClick)
      root.removeEventListener('keydown', onKeyDown)
      root.removeEventListener('input', onInput)
      document.removeEventListener('pointerdown', onPointerDownCapture, true)
    }
  }, [pageId, onRecordMap, startEditor, commitEditor, teardownEditor])

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
