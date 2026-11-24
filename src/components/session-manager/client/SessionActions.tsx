import clsx from 'clsx'
import {
  Button,
  IconArchiveOutlineRegular,
  IconArchiveOffOutlineRegular,
  IconTrashOutlineRegular,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { ConfirmModal } from '../../../client/ConfirmModal.tsx'
import type { Action, SessionRow } from '../shared/protocol.ts'
import { actionLabels } from './operations-store.ts'

export type SessionActionHandler = (action: Action, items: SessionRow[]) => void

const icons = {
  archive: IconArchiveOutlineRegular,
  restore: IconArchiveOffOutlineRegular,
  delete: IconTrashOutlineRegular,
}

export function SessionActions({
  targets,
  archived,
  busy,
  onAction,
}: {
  targets: SessionRow | SessionRow[]
  archived: boolean
  busy: boolean
  onAction: SessionActionHandler
}) {
  const single = !Array.isArray(targets)
  const items = single ? [targets] : targets
  function button(action: Action) {
    const Icon = icons[action]
    const label = actionLabels[action] + (single ? '「' + targets.title + '」' : '所选会话')
    return (
      <Button
        size="sm"
        variant={single ? 'ghost' : 'outline'}
        className={clsx(action === 'delete' && 'rong-danger-button')}
        aria-label={label}
        title={label}
        icon={<Icon size={16} />}
        disabled={busy || !items.length || (action === 'delete' && items.some((item) => item.live))}
        onClick={() => onAction(action, items)}
      >
        {single ? null : actionLabels[action]}
      </Button>
    )
  }
  return (
    <div className="rong-session-actions">
      {button(archived ? 'restore' : 'archive')}
      {button('delete')}
    </div>
  )
}

export function DeleteConfirmation({
  items,
  busy,
  cancel,
  confirm,
}: {
  items: SessionRow[]
  busy: boolean
  cancel: () => void
  confirm: () => void
}) {
  return (
    <ConfirmModal
      open={items.length > 0}
      title={'永久删除 ' + items.length + ' 个会话？'}
      description="将从磁盘删除所列会话的日志和专属文件。此操作无法撤销。"
      destructive
      busy={busy}
      confirmLabel="永久删除"
      confirmIcon={<IconTrashOutlineRegular size={16} />}
      onCancel={cancel}
      onConfirm={confirm}
    >
      <ul className="rong-session-targets">
        {items.map((row) => (
          <li key={row.id}>
            <strong>{row.title}</strong>
            {row.title !== row.id && <small>{row.id}</small>}
          </li>
        ))}
      </ul>
    </ConfirmModal>
  )
}
