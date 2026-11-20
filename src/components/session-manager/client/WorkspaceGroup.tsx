import { memo, useId, useLayoutEffect, useRef, useState } from 'react'
import { useStore } from 'zustand'
import {
  Checkbox,
  IconFolderCloseRegular,
  IconFolderOpenRegular,
  IconTriangleRightFillRegular,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { SessionRow } from '../shared/protocol.ts'
import type { SessionActionHandler } from './SessionActions.tsx'
import { SessionItem, type MenuTarget } from './SessionItem.tsx'
import type { SessionSelection } from './selection.ts'

interface GroupSelectionProps {
  members: SessionRow[]
  selection: SessionSelection
  busy: boolean
}
function WorkspaceCheckbox({ members, selection, busy }: GroupSelectionProps) {
  const checked = useStore(selection.store, (ids) => {
    const first = ids.has(members[0].id)
    return members.some((row) => ids.has(row.id) !== first) ? 'mixed' : first
  })
  const checkbox = useRef<HTMLSpanElement>(null)
  useLayoutEffect(() => {
    // DSH 的 Checkbox 提供原生 input；半选状态只能通过 DOM 属性设置。
    const input = checkbox.current?.querySelector('input')
    if (input) input.indeterminate = checked === 'mixed'
  }, [checked])
  const label = '全选工作区「' + members[0].workspace.title + '」'
  return (
    <span ref={checkbox} className="rong-session-group-check">
      <Checkbox
        label={label}
        title={label}
        checked={checked === true}
        disabled={busy}
        onChange={(checked) => selection.select(members, checked)}
      />
    </span>
  )
}

interface Props extends GroupSelectionProps {
  query: string
  onMenu: (target: MenuTarget) => void
  onAction: SessionActionHandler
}

export const WorkspaceGroup = memo(function WorkspaceGroup({
  members,
  selection,
  busy,
  query,
  onMenu,
  onAction,
}: Props) {
  const [expanded, setExpanded] = useState(true)
  // 新搜索展开匹配的工作区，同时保留仍在结果中的行实例。
  useLayoutEffect(() => setExpanded(true), [query])
  const listId = useId()
  const { workspace, cwd } = members[0]
  const Folder = expanded ? IconFolderOpenRegular : IconFolderCloseRegular
  return (
    <div className="rong-session-group">
      <div className="rong-session-group-header">
        <button
          type="button"
          className="rong-session-disclosure"
          title={cwd}
          aria-expanded={expanded}
          aria-controls={listId}
          onClick={() => setExpanded(!expanded)}
        >
          <Folder size={16} className="rong-session-folder" />
          <IconTriangleRightFillRegular size={16} className="rong-session-arrow" />
          <span>{workspace.title}</span>
        </button>
        <WorkspaceCheckbox members={members} selection={selection} busy={busy} />
      </div>
      <ul hidden={!expanded} id={listId} aria-label={workspace.title}>
        {expanded &&
          members.map((row) => (
            <SessionItem
              key={row.id}
              row={row}
              selection={selection}
              busy={busy}
              onMenu={onMenu}
              onAction={onAction}
            />
          ))}
      </ul>
    </div>
  )
})
