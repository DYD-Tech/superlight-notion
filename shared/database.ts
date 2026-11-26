import type { DatabasePropertySchema, DatabaseRow, DatabaseView } from './types'

export function plainRichText(value: unknown): string {
  if (!Array.isArray(value)) return ''
  return value
    .map((item) => {
      if (!item || typeof item !== 'object') return ''
      const row = item as { plain_text?: unknown; text?: { content?: unknown } }
      if (typeof row.plain_text === 'string') return row.plain_text
      if (typeof row.text?.content === 'string') return row.text.content
      return ''
    })
    .join('')
}

export function databaseTitleFromSchema(schema: { title?: unknown } | null | undefined): string {
  const title = plainRichText(schema?.title)
  return title.trim() || '无标题'
}

export function orderDatabaseProperties(
  properties: Record<string, { id?: string; name?: string; type?: string }> | null | undefined
): DatabasePropertySchema[] {
  const list: DatabasePropertySchema[] = Object.values(properties ?? {})
    .map((prop) => ({
      id: String(prop?.id || prop?.name || ''),
      name: String(prop?.name || ''),
      type: String(prop?.type || 'rich_text')
    }))
    .filter((prop) => prop.name)
  const titles = list.filter((prop) => prop.type === 'title')
  const rest = list.filter((prop) => prop.type !== 'title')
  return [...titles, ...rest]
}

function named(value: unknown): string {
  if (!value || typeof value !== 'object') return ''
  const name = (value as { name?: unknown }).name
  return typeof name === 'string' ? name : ''
}

function formulaText(value: unknown): string {
  if (!value || typeof value !== 'object') return ''
  const f = value as { type?: string; string?: unknown; number?: unknown; boolean?: unknown; date?: { start?: string } }
  if (f.type === 'string') return typeof f.string === 'string' ? f.string : ''
  if (f.type === 'number') return f.number == null ? '' : String(f.number)
  if (f.type === 'boolean') return f.boolean ? 'Yes' : 'No'
  if (f.type === 'date') return f.date?.start ?? ''
  return ''
}

export function formatPropertyValue(property: unknown): string {
  if (!property || typeof property !== 'object') return ''
  const p = property as Record<string, unknown> & { type?: string }
  switch (p.type) {
    case 'title':
    case 'rich_text':
      return plainRichText(p[p.type])
    case 'select':
    case 'status':
      return named(p[p.type])
    case 'multi_select':
      return (Array.isArray(p.multi_select) ? p.multi_select : []).map(named).filter(Boolean).join(', ')
    case 'date': {
      const d = p.date as { start?: string; end?: string } | null
      if (!d?.start) return ''
      return d.end ? `${d.start} → ${d.end}` : d.start
    }
    case 'checkbox':
      return p.checkbox ? 'Yes' : ''
    case 'number':
      return p.number == null ? '' : String(p.number)
    case 'url':
    case 'email':
    case 'phone_number':
      return typeof p[p.type] === 'string' ? (p[p.type] as string) : ''
    case 'people':
    case 'created_by':
    case 'last_edited_by':
      if (p.type === 'people') {
        return (Array.isArray(p.people) ? p.people : []).map(named).filter(Boolean).join(', ')
      }
      return named(p[p.type])
    case 'relation':
      return String((Array.isArray(p.relation) ? p.relation : []).length)
    case 'formula':
      return formulaText(p.formula)
    case 'rollup': {
      const r = p.rollup as { type?: string; number?: unknown; date?: { start?: string }; array?: unknown[] } | undefined
      if (!r) return ''
      if (r.type === 'number') return r.number == null ? '' : String(r.number)
      if (r.type === 'date') return r.date?.start ?? ''
      if (r.type === 'array') return (r.array ?? []).map((item) => formatPropertyValue(item)).filter(Boolean).join(', ')
      return formulaText(r)
    }
    case 'created_time':
    case 'last_edited_time':
      return typeof p[p.type] === 'string' ? (p[p.type] as string) : ''
    case 'files':
      return (Array.isArray(p.files) ? p.files : [])
        .map((file) => named(file) || (file as { name?: string })?.name || '')
        .filter(Boolean)
        .join(', ')
    case 'unique_id': {
      const u = p.unique_id as { prefix?: string; number?: number } | undefined
      if (!u) return ''
      return u.prefix ? `${u.prefix}-${u.number ?? ''}` : String(u.number ?? '')
    }
    default:
      return ''
  }
}

export function isCheckboxProperty(property: unknown): boolean {
  return Boolean(property && typeof property === 'object' && (property as { type?: string }).type === 'checkbox')
}

export function checkboxChecked(property: unknown): boolean {
  return Boolean(property && typeof property === 'object' && (property as { checkbox?: unknown }).checkbox)
}

export function rowTitle(row: DatabaseRow, properties: DatabasePropertySchema[]): string {
  const titleProp = properties.find((prop) => prop.type === 'title')
  if (titleProp) {
    const value = formatPropertyValue(row.properties[titleProp.name])
    if (value) return value
  }
  for (const [key, value] of Object.entries(row.properties ?? {})) {
    if (value && typeof value === 'object' && (value as { type?: string }).type === 'title') {
      const text = formatPropertyValue(value)
      if (text) return text
    }
    void key
  }
  return '无标题'
}

export function emptyDatabaseView(id: string, error = 'unavailable'): DatabaseView {
  return { id, title: '', icon: null, properties: [], rows: [], hasMore: false, error }
}
