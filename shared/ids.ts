/** Compact 32-char id <-> dashed UUID helpers. */

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function stripDashes(id: string): string {
  return id.replace(/-/g, '').toLowerCase()
}

export function toUuid(id: string): string | null {
  const s = stripDashes(id)
  if (!/^[0-9a-f]{32}$/.test(s)) return null
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`
}

export function isUuid(id: string): boolean {
  return UUID_RE.test(id) || /^[0-9a-f]{32}$/i.test(id)
}

export function notionPageUrl(pageId: string): string {
  const compact = stripDashes(pageId)
  return `https://www.notion.so/${compact}`
}

const COMPACT_ID_RE = /\b([0-9a-f]{32})\b/i
const DASHED_ID_RE =
  /\b([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})\b/i

/**
 * Extract a Notion page ID from a raw id, pathname, or Notion URL.
 * Defaults to a dashed UUID, matching `parsePageId` from notion-utils.
 */
export function parsePageId(
  raw = '',
  { uuid = true }: { uuid?: boolean } = {}
): string | null {
  if (!raw) return null
  const id = raw.split('?')[0] ?? ''
  if (!id) return null
  const compact = id.match(COMPACT_ID_RE)
  if (compact?.[1]) {
    const hex = compact[1].toLowerCase()
    return uuid ? toUuid(hex) : hex
  }
  const dashed = id.match(DASHED_ID_RE)
  if (dashed?.[1]) {
    const value = dashed[1].toLowerCase()
    return uuid ? value : stripDashes(value)
  }
  return null
}
