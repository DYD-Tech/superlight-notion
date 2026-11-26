import { richTextEqual } from '@shared/richText'
import type { OfficialRichText } from '@shared/types'
import type { SaveOp, SaveQueue } from './saveQueue'

export type UpdateOp = Extract<SaveOp, { kind: 'update' }>

/** Enqueue an update only when rich text actually changed from the last saved baseline. */
export function enqueueUpdateIfChanged(
  queue: Pick<SaveQueue, 'enqueue' | 'cancelUpdate'>,
  baseline: OfficialRichText[] | undefined,
  op: UpdateOp
): boolean {
  if (op.richText && baseline && richTextEqual(op.richText, baseline)) {
    queue.cancelUpdate(op.blockId)
    return false
  }
  queue.enqueue(op)
  return true
}
