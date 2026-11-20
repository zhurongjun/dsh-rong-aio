import { useState, type ReactNode } from 'react'
import { Menu, Tag, Tooltip, writeClipboard } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SessionRow } from '../shared/protocol.ts'
import { WorkspaceGroup } from './WorkspaceGroup.tsx'

interface Props {
  rows: SessionRow[]
  selected: Set<string>
  busy: boolean
  select: (rows: SessionRow[], checked: boolean) => void
  actions: (row: SessionRow) => ReactNode
  openDirectory: (row: SessionRow) => Promise<void>
  feedback: (message: string, failed?: boolean) => void
}

export function SessionGroups({
  rows,
  selected,
  busy,
  select,
  actions,
  openDirectory,
  feedback,
}: Props) {
  const [menu, setMenu] = useState<{
    row: SessionRow
    anchor: HTMLElement
    x: number
    y: number
  } | null>(null)
  const groups = new Map<string, SessionRow[]>()
  for (const row of rows) {
    const members = groups.get(row.workspace.key)
    if (members) members.push(row)
    else groups.set(row.workspace.key, [row])
  }
  async function choose(action: string) {
    if (!menu) return
    const { row } = menu
    setMenu(null)
    try {
      if (action === 'open-session') {
        await openDirectory(row)
      } else {
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
      {[...groups].map(([key, members]) => (
        <WorkspaceGroup
          key={key}
          title={members[0].workspace.title}
          path={members[0].cwd}
          count={members.length}
          selectedCount={members.filter((row) => selected.has(row.id)).length}
          disabled={busy}
          onSelect={(checked) => select(members, checked)}
        >
          {members.map((row) => (
            <Tooltip
              key={row.id}
              portal
              side="bottom"
              maxWidth={420}
              delayMs={450}
              disabled={menu !== null}
              label={() =>
                [
                  row.title,
                  '会话 ID：' + row.id,
                  row.cwd && '工作区路径：' + row.cwd,
                  '会话存档：' + (row.directory ?? '暂无存档目录'),
                  '创建时间：' + new Date(row.createdAt).toLocaleString(),
                ]
                  .filter(Boolean)
                  .join('\n')
              }
            >
              <li
                className="rong-session-row"
                tabIndex={-1}
                data-selected={selected.has(row.id) || undefined}
                onCopy={(event) => event.preventDefault()}
                onContextMenu={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  if (!busy) setMenu({ row, anchor: e.currentTarget, x: e.clientX, y: e.clientY })
                }}
                onKeyDown={(e) => {
                  if (busy || !(e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10'))) return
                  e.preventDefault()
                  const rect = e.currentTarget.getBoundingClientRect()
                  setMenu({ row, anchor: e.currentTarget, x: rect.left + 24, y: rect.bottom })
                }}
              >
                <button
                  type="button"
                  className="rong-session-select"
                  aria-label={'选择「' + row.title + '」 ' + row.id}
                  aria-pressed={selected.has(row.id)}
                  disabled={busy}
                  onClick={() => select([row], !selected.has(row.id))}
                >
                  <span className="rong-session-heading">
                    <span className={row.archived ? 'rong-session-title-archived' : undefined}>
                      {row.title}
                    </span>
                    {row.live && (
                      <Tag className="rong-session-busy" tone="danger">
                        DSH 占用中
                      </Tag>
                    )}
                  </span>
                  <small>{row.id}</small>
                </button>
                <div className="rong-session-actions">{actions(row)}</div>
              </li>
            </Tooltip>
          ))}
        </WorkspaceGroup>
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
}
