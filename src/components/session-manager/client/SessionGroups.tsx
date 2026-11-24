import { useState } from 'react'
import { Menu, writeClipboard } from '@deepseek-ai/dsh-client-ui-primitives'
import { errorMessage } from '../../../shared/error.ts'
import type { SessionRow } from '../shared/protocol.ts'
import type { SessionSelection } from './operations-store.ts'
import type { SessionActionHandler } from './SessionActions.tsx'
import type { MenuTarget } from './SessionItem.tsx'
import { WorkspaceGroup } from './WorkspaceGroup.tsx'

interface Props {
  rows: SessionRow[]
  query: string
  searchRevision: number
  selection: SessionSelection
  busy: boolean
  onAction: SessionActionHandler
  openDirectory: (row: SessionRow) => Promise<void>
  feedback: (message: string, failed?: boolean) => void
}

export function SessionGroups({
  rows,
  query,
  searchRevision,
  selection,
  busy,
  onAction,
  openDirectory,
  feedback,
}: Props) {
  const [menuState, setMenuState] = useState<{
    target: MenuTarget
    rows: SessionRow[]
    query: string
  } | null>(null)
  const menu =
    menuState && menuState.rows === rows && menuState.query === query ? menuState.target : null

  const groupMap = new Map<string, SessionRow[]>()
  for (const row of rows) {
    const key = row.workspace.key
    const members = groupMap.get(key)
    if (members) members.push(row)
    else groupMap.set(key, [row])
  }
  const groups = [...groupMap]

  async function choose(action: string) {
    if (!menu) return
    const { row } = menu
    setMenuState(null)
    if (action === 'open-session') {
      try {
        await openDirectory(row)
      } catch (error) {
        feedback(errorMessage(error), true)
      }
      return
    }
    const value = action === 'copy-id' ? row.id : row.directory
    if (!value) return
    const copied = action === 'copy-id' ? '已复制会话 ID' : '已复制路径'
    try {
      if (await writeClipboard(value)) feedback(copied)
      else feedback('无法写入剪贴板', true)
    } catch (error) {
      feedback(errorMessage(error), true)
    }
  }
  return (
    <div className="rong-session-groups">
      {groups.map(([key, members]) => (
        <WorkspaceGroup
          key={key}
          members={members}
          selection={selection}
          busy={busy}
          searchRevision={searchRevision}
          openMenuId={menu?.row.id}
          onMenu={(target) => setMenuState({ target, rows, query })}
          onAction={onAction}
        />
      ))}
      {menu && (
        <Menu
          key={menu.row.id}
          open
          portal
          contextual
          compact
          autoFocus
          anchor={null}
          anchorPoint={menu}
          returnFocus={() => menu.anchor.querySelector<HTMLButtonElement>('button[aria-pressed]')}
          onClose={() => setMenuState(null)}
          onSelect={(id) => void choose(id)}
          items={[
            { id: 'copy-session', label: '复制存档路径', disabled: !menu.row.directory },
            { id: 'copy-id', label: '复制会话 ID' },
            {
              id: 'open-session',
              label: '在文件管理器中打开',
              disabled: !menu.row.canOpenDirectory,
            },
          ]}
        />
      )}
    </div>
  )
}
