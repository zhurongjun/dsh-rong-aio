import { memo, useEffect, useMemo, useState } from 'react'
import { Menu, writeClipboard } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SessionRow } from '../shared/protocol.ts'
import type { SessionSelection } from './selection.ts'
import type { SessionActionHandler } from './SessionActions.tsx'
import { SessionMenuOpen, type MenuTarget } from './SessionItem.tsx'
import { WorkspaceGroup } from './WorkspaceGroup.tsx'

interface Props {
  rows: SessionRow[]
  query: string
  selection: SessionSelection
  busy: boolean
  onAction: SessionActionHandler
  openDirectory: (row: SessionRow) => Promise<void>
  feedback: (message: string, failed?: boolean) => void
}

export const SessionGroups = memo(function SessionGroups({
  rows,
  query,
  selection,
  busy,
  onAction,
  openDirectory,
  feedback,
}: Props) {
  const [menu, setMenu] = useState<MenuTarget | null>(null)
  useEffect(() => setMenu(null), [rows, query])
  const groups = useMemo(() => {
    const groups = new Map<string, SessionRow[]>()
    for (const row of rows) {
      const key = row.workspace.key
      const members = groups.get(key)
      if (members) members.push(row)
      else groups.set(key, [row])
    }
    return [...groups]
  }, [rows])
  async function choose(action: string) {
    if (!menu) return
    const { row } = menu
    setMenu(null)
    try {
      if (action === 'open-session') await openDirectory(row)
      else {
        const value = action === 'copy-id' ? row.id : row.directory
        if (!value) return
        if (!(await writeClipboard(value))) throw new Error('无法写入剪贴板')
        feedback(action === 'copy-id' ? '已复制会话 ID' : '已复制路径')
      }
    } catch (error) {
      feedback(error instanceof Error ? error.message : String(error), true)
    }
  }
  return (
    <div className="rong-session-groups">
      <SessionMenuOpen.Provider value={menu !== null}>
        {groups.map(([key, members]) => (
          <WorkspaceGroup
            key={key}
            members={members}
            selection={selection}
            busy={busy}
            query={query}
            onMenu={setMenu}
            onAction={onAction}
          />
        ))}
      </SessionMenuOpen.Provider>
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
          onClose={() => setMenu(null)}
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
})
