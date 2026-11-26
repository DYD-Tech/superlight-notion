export const EDITABLE_OFFICIAL_TYPES = [
  'paragraph',
  'heading_1',
  'heading_2',
  'heading_3',
  'bulleted_list_item',
  'numbered_list_item',
  'quote',
  'to_do'
] as const

export type EditableOfficialType = (typeof EDITABLE_OFFICIAL_TYPES)[number]

/** Unofficial / react-notion-x block types that we allow editing. */
export const EDITABLE_UNOFFICIAL_TYPES = [
  'text',
  'header',
  'sub_header',
  'sub_sub_header',
  'bulleted_list',
  'numbered_list',
  'quote',
  'to_do'
] as const

export type EditableUnofficialType = (typeof EDITABLE_UNOFFICIAL_TYPES)[number]

export const UNOFFICIAL_TO_OFFICIAL: Record<EditableUnofficialType, EditableOfficialType> = {
  text: 'paragraph',
  header: 'heading_1',
  sub_header: 'heading_2',
  sub_sub_header: 'heading_3',
  bulleted_list: 'bulleted_list_item',
  numbered_list: 'numbered_list_item',
  quote: 'quote',
  to_do: 'to_do'
}

export function isEditableOfficialType(type: string): type is EditableOfficialType {
  return (EDITABLE_OFFICIAL_TYPES as readonly string[]).includes(type)
}

export function isEditableUnofficialType(type: string): type is EditableUnofficialType {
  return (EDITABLE_UNOFFICIAL_TYPES as readonly string[]).includes(type)
}

export interface RichTextAnnotations {
  bold: boolean
  italic: boolean
  strikethrough: boolean
  underline: boolean
  code: boolean
  color: string
}

export interface OfficialRichText {
  type: 'text'
  text: {
    content: string
    link: { url: string } | null
  }
  annotations: RichTextAnnotations
  plain_text?: string
  href?: string | null
}

export interface SearchPage {
  id: string
  title: string
  parentId: string | null
  icon?: string | null
}

export const RICH_TEXT_ITEM_MAX = 2000
export const APPEND_CHILDREN_MAX = 100
export const NOTION_RATE_PER_SEC = 3

export const DEFAULT_ANNOTATIONS: RichTextAnnotations = {
  bold: false,
  italic: false,
  strikethrough: false,
  underline: false,
  code: false,
  color: 'default'
}

/** First-page size for official database queries (no per-row fetches). */
export const DATABASE_QUERY_PAGE_SIZE = 50

export interface DatabasePropertySchema {
  id: string
  name: string
  type: string
}

export interface DatabaseRow {
  id: string
  properties: Record<string, unknown>
  url?: string
  lastEditedTime?: string | null
}

export interface DatabaseView {
  id: string
  title: string
  icon?: string | null
  properties: DatabasePropertySchema[]
  rows: DatabaseRow[]
  hasMore: boolean
  error?: string | null
}
