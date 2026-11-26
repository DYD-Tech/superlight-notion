import type { SaveStatus as Status } from '../editor/saveQueue'

export function SaveStatus({ status, message }: { status: Status; message?: string }) {
  const label =
    status === 'saving'
      ? '正在保存…'
      : status === 'saved'
        ? '已保存'
        : status === 'conflict'
          ? message || '内容已在别处修改，请刷新'
          : status === 'error'
            ? message || '保存失败，正在重试'
            : ''
  if (!label) return <span className="save-status idle" />
  return (
    <span className={`save-status ${status}`} role="status">
      {label}
    </span>
  )
}
