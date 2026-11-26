import { notionPageUrl } from '@shared/ids'

export function UnsupportedBlock({
  block,
  type
}: {
  block?: { id?: string; type?: string }
  type?: string
}) {
  const id = block?.id
  const label = type || block?.type || '未知'
  return (
    <div className="unsupported-block">
      <span>此块（{label}）暂不支持预览。</span>
      {id ? (
        <a href={notionPageUrl(id)} target="_blank" rel="noreferrer">
          在 Notion 中打开
        </a>
      ) : null}
    </div>
  )
}
