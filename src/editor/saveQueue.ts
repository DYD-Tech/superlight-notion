import { api, ApiError } from '../api'
import type { OfficialRichText } from '@shared/types'

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error' | 'conflict'

export type SaveOp =
  | {
      kind: 'update'
      blockId: string
      pageId: string
      richText?: OfficialRichText[]
      checked?: boolean
      lastEditedTime?: string
    }
  | { kind: 'append'; afterId: string; pageId: string; asChild?: boolean }
  | { kind: 'delete'; blockId: string; pageId: string }

export interface SaveQueueOptions {
  debounceMs?: number
  onStatus?: (status: SaveStatus, message?: string) => void
  onConflict?: (blockId: string) => void
  onSettled?: (op: SaveOp, result?: unknown) => void
}

export class SaveQueue {
  private pending = new Map<string, SaveOp>()
  private timer: ReturnType<typeof setTimeout> | null = null
  private running = false
  private retries = 0
  readonly debounceMs: number
  private readonly onStatus?: SaveQueueOptions['onStatus']
  private readonly onConflict?: SaveQueueOptions['onConflict']
  private readonly onSettled?: SaveQueueOptions['onSettled']

  constructor(opts: SaveQueueOptions = {}) {
    this.debounceMs = opts.debounceMs ?? 600
    this.onStatus = opts.onStatus
    this.onConflict = opts.onConflict
    this.onSettled = opts.onSettled
  }

  enqueue(op: SaveOp) {
    const key = this.key(op)
    const prev = this.pending.get(key)
    if (prev && prev.kind === 'update' && op.kind === 'update') {
      this.pending.set(key, { ...prev, ...op })
    } else {
      this.pending.set(key, op)
    }
    this.onStatus?.('saving')
    this.schedule()
  }

  async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    await this.drain()
  }

  /** Drop a pending text update so a later no-op can cancel an unsent edit. */
  cancelUpdate(blockId: string) {
    const key = `update:${blockId}`
    if (!this.pending.has(key)) return
    this.pending.delete(key)
    if (this.pending.size === 0 && !this.running) {
      if (this.timer) {
        clearTimeout(this.timer)
        this.timer = null
      }
      this.onStatus?.('idle')
    }
  }

  private key(op: SaveOp): string {
    if (op.kind === 'update') return `update:${op.blockId}`
    if (op.kind === 'delete') return `delete:${op.blockId}`
    return `append:${op.afterId}:${Date.now()}:${Math.random()}`
  }

  private schedule() {
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.timer = null
      void this.drain()
    }, this.debounceMs)
  }

  private async drain() {
    if (this.running) return
    this.running = true
    this.onStatus?.('saving')
    try {
      while (this.pending.size) {
        const [key, op] = this.pending.entries().next().value as [string, SaveOp]
        this.pending.delete(key)
        try {
          const result = await this.execute(op)
          this.retries = 0
          this.onSettled?.(op, result)
        } catch (err) {
          if (err instanceof ApiError && err.status === 409) {
            this.onStatus?.('conflict', '内容已在别处修改，请刷新')
            this.onConflict?.(op.kind === 'update' || op.kind === 'delete' ? op.blockId : op.afterId)
            return
          }
          this.pending.set(key, op)
          this.retries += 1
          const wait = Math.min(8000, 400 * 2 ** Math.max(0, this.retries - 1))
          this.onStatus?.('error', err instanceof Error ? err.message : '保存失败')
          await sleep(wait)
        }
      }
      this.onStatus?.('saved')
    } finally {
      this.running = false
      if (this.pending.size) this.schedule()
    }
  }

  private execute(op: SaveOp) {
    if (op.kind === 'update') {
      return api.patchBlock(op.blockId, {
        richText: op.richText,
        checked: op.checked,
        lastEditedTime: op.lastEditedTime,
        pageId: op.pageId
      })
    }
    if (op.kind === 'delete') {
      return api.deleteBlock(op.blockId, op.pageId)
    }
    return api.appendAfter(op.afterId, { pageId: op.pageId, asChild: op.asChild })
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}
