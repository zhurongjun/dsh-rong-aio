import clsx from 'clsx'
import {
  Button,
  IconArchiveOutlineRegular,
  IconArchiveOffOutlineRegular,
  IconTrashOutlineRegular,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { ConfirmModal } from '../../../client/ConfirmModal.tsx'
import type { Action } from '../shared/protocol.ts'
import { buildSessionTree, type SessionNode } from '../shared/tree.ts'
import { actionLabels } from './operations-store.ts'

export type SessionActionHandler = (action: Action, items: SessionNode[]) => void

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
  targets: SessionNode | SessionNode[]
  archived: boolean
  busy: boolean
  onAction: SessionActionHandler
}) {
  const single = !Array.isArray(targets)
  const items = single ? [targets] : targets
  function button(action: Action) {
    const Icon = icons[action]
    const label = actionLabels[action] + (single ? '「' + targets.row.title + '」' : '所选会话')
    return (
      <Button
        size="sm"
        variant={single ? 'ghost' : 'outline'}
        className={clsx(action === 'delete' && 'rong-danger-button')}
        aria-label={label}
        title={label}
        icon={<Icon size={16} />}
        disabled={
          busy ||
          !items.length ||
          (action === 'delete' &&
            items.some((item) => item.row.subagent || item.row.live || item.descendantLive))
        }
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

function DeleteTargetBranch({ node }: { node: SessionNode }) {
  const { row, children } = node
  return (
    <li className="rong-session-target-node">
      <span>
        {row.subagent ? `子会话：${row.title}` : row.title}
        {row.missing && '（主会话缺失）'}
      </span>
      {row.title !== row.id && <small>{row.id}</small>}
      {children.length > 0 && (
        <ul className="rong-session-target-children">
          {children.map((child) => (
            <DeleteTargetBranch key={child.row.id} node={child} />
          ))}
        </ul>
      )}
    </li>
  )
}

export function DeleteConfirmation({
  items,
  busy,
  cancel,
  confirm,
}: {
  items: SessionNode[]
  busy: boolean
  cancel: () => void
  confirm: () => void
}) {
  const subagentCount = items.reduce((sum, item) => sum + item.descendants.length, 0)
  const description = subagentCount
    ? `将从磁盘删除所列主会话及其关联的 ${subagentCount} 个子会话的日志和专属文件。此操作无法撤销。`
    : '将从磁盘删除所列会话的日志和专属文件。此操作无法撤销。'

  return (
    <ConfirmModal
      open={items.length > 0}
      title={'永久删除 ' + items.length + ' 个会话？'}
      description={description}
      destructive
      busy={busy}
      confirmLabel="永久删除"
      confirmIcon={<IconTrashOutlineRegular size={16} />}
      onCancel={cancel}
      onConfirm={confirm}
    >
      <ul className="rong-session-targets">
        {items.map((item) => {
          const { row, descendants } = item
          const treeChildren = descendants.length
            ? (buildSessionTree([row, ...descendants])[0]?.children ?? item.children)
            : item.children
          return (
            <li key={row.id}>
              <strong>
                {row.title}
                {row.missing && '（主会话缺失）'}
              </strong>
              {row.title !== row.id && <small>{row.id}</small>}
              {treeChildren.length > 0 && (
                <ul className="rong-session-target-children">
                  {treeChildren.map((child) => (
                    <DeleteTargetBranch key={child.row.id} node={child} />
                  ))}
                </ul>
              )}
            </li>
          )
        })}
      </ul>
    </ConfirmModal>
  )
}
