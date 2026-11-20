import { createContext, memo, useContext, type ReactElement } from 'react'
import { useStore } from 'zustand'
import { Tag, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SessionRow } from '../shared/protocol.ts'
import type { SessionSelection } from './selection.ts'
import { SessionActions, type SessionActionHandler } from './SessionActions.tsx'

export interface MenuTarget {
  row: SessionRow
  anchor: HTMLElement
  x: number
  y: number
}

export const SessionMenuOpen = createContext(false)

interface Props {
  row: SessionRow
  selection: SessionSelection
  busy: boolean
  onMenu: (target: MenuTarget) => void
  onAction: SessionActionHandler
}

function details(row: SessionRow) {
  return [
    row.title,
    '会话 ID：' + row.id,
    row.cwd && '工作区路径：' + row.cwd,
    '会话存档：' + (row.directory ?? '暂无存档目录'),
    '创建时间：' + new Date(row.createdAt).toLocaleString(),
  ]
    .filter(Boolean)
    .join('\n')
}

function SessionTooltip({ row, children }: { row: SessionRow; children: ReactElement }) {
  const menuOpen = useContext(SessionMenuOpen)
  return (
    <Tooltip
      portal
      side="bottom"
      maxWidth={420}
      delayMs={450}
      disabled={menuOpen}
      label={() => details(row)}
    >
      {children}
    </Tooltip>
  )
}

export const SessionItem = memo(function SessionItem({
  row,
  selection,
  busy,
  onMenu,
  onAction,
}: Props) {
  const selected = useStore(selection.store, (ids) => ids.has(row.id))
  return (
    <SessionTooltip row={row}>
      <li
        className="rong-session-row"
        tabIndex={-1}
        data-selected={selected || undefined}
        onCopy={(event) => event.preventDefault()}
        onContextMenu={(event) => {
          event.preventDefault()
          event.stopPropagation()
          if (!busy)
            onMenu({ row, anchor: event.currentTarget, x: event.clientX, y: event.clientY })
        }}
        onKeyDown={(event) => {
          if (busy || !(event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')))
            return
          event.preventDefault()
          const rect = event.currentTarget.getBoundingClientRect()
          onMenu({ row, anchor: event.currentTarget, x: rect.left + 24, y: rect.bottom })
        }}
      >
        <button
          type="button"
          className="rong-session-select"
          aria-label={'选择「' + row.title + '」 ' + row.id}
          aria-pressed={selected}
          disabled={busy}
          onClick={() => selection.select([row], !selected)}
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
        <SessionActions targets={row} archived={row.archived} busy={busy} onAction={onAction} />
      </li>
    </SessionTooltip>
  )
})
