import { useId, useState } from 'react'
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
import type { SessionSelection } from './operations-store.ts'

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
  const label = `全选工作区「${members[0].workspace.title}」`
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
        disabled={busy}
        onChange={(next) => selection.select(members, next)}
      />
    </span>
  )
}

interface Props extends GroupSelectionProps {
  searchRevision: number
  openMenuId?: string
  onMenu: (target: MenuTarget) => void
  onAction: SessionActionHandler
}

export function WorkspaceGroup({
  members,
  selection,
  busy,
  searchRevision,
  openMenuId,
  onMenu,
  onAction,
}: Props) {
  const [collapsedAtRevision, setCollapsedAtRevision] = useState<number | null>(null)
  const expanded = collapsedAtRevision !== searchRevision
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
          onClick={() => setCollapsedAtRevision(expanded ? searchRevision : null)}
        >
          <Folder size={16} className="rong-session-folder" />
          <IconTriangleRightFillRegular size={16} className="rong-session-arrow" />
          <span className="rong-truncate">{workspace.title}</span>
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
              menuOpen={openMenuId === row.id}
              onMenu={onMenu}
              onAction={onAction}
            />
          ))}
      </ul>
    </div>
  )
}
