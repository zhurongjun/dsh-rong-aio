import { useId, useState } from 'react'
import { useStore } from 'zustand'
import {
  Checkbox,
  IconFolderCloseRegular,
  IconFolderOpenRegular,
  IconTriangleRightFillRegular,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { SessionNode } from '../shared/tree.ts'
import type { SessionActionHandler } from './SessionActions.tsx'
import { SessionItem, type MenuTarget } from './SessionItem.tsx'
import type { SessionSelection } from './operations-store.ts'

interface GroupSelectionProps {
  members: SessionNode[]
  selection: SessionSelection
  busy: boolean
}

function WorkspaceCheckbox({ members, selection, busy }: GroupSelectionProps) {
  const selectable = members.filter((node) => !node.row.subagent)
  const checked = useStore(selection.store, (ids) => {
    if (!selectable.length) return false
    const first = ids.has(selectable[0].row.id)
    return selectable.some((node) => ids.has(node.row.id) !== first) ? 'mixed' : first
  })
  const label = `全选工作区「${members[0].row.workspace.title}」`
  const isMixed = checked === 'mixed'

  const bindCheck = (el: HTMLSpanElement | null) => {
    const input = el?.querySelector('input')
    if (input) input.indeterminate = isMixed
  }

  return (
    <span className="rong-session-group-check" ref={bindCheck}>
      <Checkbox
        label={label}
        title={label}
        checked={checked === true}
        disabled={busy || !selectable.length}
        onChange={(next) => selection.select(selectable, next)}
      />
    </span>
  )
}

interface Props extends GroupSelectionProps {
  searchRevision: number
  openMenuId?: string
  collapsedIds: ReadonlySet<string>
  onToggleNode: (id: string) => void
  onMenu: (target: MenuTarget) => void
  onAction: SessionActionHandler
}

export function WorkspaceGroup({
  members,
  selection,
  busy,
  searchRevision,
  openMenuId,
  collapsedIds,
  onToggleNode,
  onMenu,
  onAction,
}: Props) {
  const [collapsedAtRevision, setCollapsedAtRevision] = useState<number | null>(null)
  const expanded = collapsedAtRevision !== searchRevision
  const listId = useId()
  const { workspace, cwd } = members[0].row
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
          onClick={() => setCollapsedAtRevision(expanded ? searchRevision : null)}
        >
          <Folder size={16} className="rong-session-folder" />
          <IconTriangleRightFillRegular size={16} className="rong-session-arrow" />
          <span className="rong-truncate">{workspace.title}</span>
        </button>
        <WorkspaceCheckbox members={members} selection={selection} busy={busy} />
      </div>

      <ul
        className="rong-session-tree-root"
        hidden={!expanded}
        id={listId}
        aria-label={workspace.title}
      >
        {expanded &&
          members.map((node) => (
            <SessionItem
              key={node.row.id}
              node={node}
              selection={selection}
              busy={busy}
              openMenuId={openMenuId}
              collapsedIds={collapsedIds}
              onToggleNode={onToggleNode}
              onMenu={onMenu}
              onAction={onAction}
            />
          ))}
      </ul>
    </div>
  )
}
