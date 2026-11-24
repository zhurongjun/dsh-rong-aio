import { useId } from 'react'
import clsx from 'clsx'
import { useStore } from 'zustand'
import {
  IconBranchOutlineRegular,
  IconTriangleRightFillRegular,
  Tag,
  Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { SessionRow } from '../shared/protocol.ts'
import type { SessionNode } from '../shared/tree.ts'
import type { SessionSelection } from './operations-store.ts'
import { SessionActions, type SessionActionHandler } from './SessionActions.tsx'

export interface MenuTarget {
  row: SessionRow
  anchor: HTMLElement
  x: number
  y: number
}

interface Props {
  node: SessionNode
  selection: SessionSelection
  busy: boolean
  openMenuId?: string
  collapsedIds: ReadonlySet<string>
  onToggleNode: (id: string) => void
  onMenu: (target: MenuTarget) => void
  onAction: SessionActionHandler
}

function sessionDetails(node: SessionNode): string {
  const { row, depth, descendants, maxSubtreeDepth } = node
  return [
    row.title,
    row.missing && '状态：所属主会话存档已不存在，可在此一并归档或清理其下子会话',
    row.subagent && `类型：第 ${depth} 层子会话（随所属主会话归档或删除）`,
    row.subagent && row.parentId && `上级会话：${row.parentId}`,
    descendants.length > 0 &&
      `关联子会话：共 ${descendants.length} 个（最深 ${maxSubtreeDepth} 层）`,
    `会话 ID：${row.id}`,
    row.cwd && `工作区路径：${row.cwd}`,
    `会话存档：${row.directory ?? '暂无存档目录'}`,
    `创建时间：${new Date(row.createdAt).toLocaleString()}`,
  ]
    .filter(Boolean)
    .join('\n')
}

export function SessionItem({
  node,
  selection,
  busy,
  openMenuId,
  collapsedIds,
  onToggleNode,
  onMenu,
  onAction,
}: Props) {
  const { row } = node
  const selected = useStore(selection.store, (ids) => !row.subagent && ids.has(row.id))
  const menuOpen = openMenuId === row.id
  const expandable = node.children.length > 0
  const expanded = expandable && !collapsedIds.has(row.id)
  const childrenId = useId()

  return (
    <li className="rong-session-tree-item">
      <Tooltip
        portal
        side="bottom"
        maxWidth={420}
        delayMs={450}
        disabled={menuOpen}
        label={() => sessionDetails(node)}
      >
        <div
          className={clsx('rong-session-row', row.subagent && 'rong-session-row-subagent')}
          tabIndex={-1}
          data-selected={selected || undefined}
          data-expanded={expanded || undefined}
          data-missing={row.missing || undefined}
          onCopy={(event) => event.preventDefault()}
          onContextMenu={(event) => {
            event.preventDefault()
            event.stopPropagation()
            if (!busy) {
              onMenu({ row, anchor: event.currentTarget, x: event.clientX, y: event.clientY })
            }
          }}
          onKeyDown={(event) => {
            if (
              event.key === 'ArrowLeft' &&
              !event.altKey &&
              !event.ctrlKey &&
              !event.metaKey &&
              !event.shiftKey
            ) {
              if (expandable && expanded) {
                event.preventDefault()
                event.stopPropagation()
                onToggleNode(row.id)
              }
              return
            }
            if (
              event.key === 'ArrowRight' &&
              !event.altKey &&
              !event.ctrlKey &&
              !event.metaKey &&
              !event.shiftKey
            ) {
              if (expandable && !expanded) {
                event.preventDefault()
                event.stopPropagation()
                onToggleNode(row.id)
              }
              return
            }
            if (busy || !(event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')))
              return
            event.preventDefault()
            event.stopPropagation()
            const rect = event.currentTarget.getBoundingClientRect()
            onMenu({ row, anchor: event.currentTarget, x: rect.left + 24, y: rect.bottom })
          }}
        >
          {expandable ? (
            <button
              type="button"
              className="rong-session-tree-toggle"
              aria-expanded={expanded}
              aria-controls={childrenId}
              aria-label={(expanded ? '折叠' : '展开') + '「' + row.title + '」的子会话'}
              title={(expanded ? '折叠' : '展开') + '子会话（' + node.descendants.length + '）'}
              onClick={() => onToggleNode(row.id)}
            >
              <IconTriangleRightFillRegular size={12} className="rong-session-tree-chevron" />
            </button>
          ) : (
            <span className="rong-session-tree-leaf" aria-hidden="true">
              {row.subagent ? (
                <IconBranchOutlineRegular size={13} />
              ) : (
                <span className="rong-session-root-dot" />
              )}
            </span>
          )}

          {row.subagent ? (
            <div
              className="rong-session-subagent-body"
              tabIndex={0}
              role="group"
              aria-label={`子会话「${row.title}」 ${row.id}`}
            >
              <span className="rong-session-heading">
                {expandable && (
                  <IconBranchOutlineRegular size={13} className="rong-session-branch-icon" />
                )}
                <span
                  className={clsx('rong-truncate', row.archived && 'rong-session-title-archived')}
                >
                  {row.title}
                </span>
                <Tag className="rong-session-subtag">子会话</Tag>
                {node.descendants.length > 0 && (
                  <Tag className="rong-session-subcount">{node.descendants.length} 个子会话</Tag>
                )}
                {row.live ? (
                  <Tag className="rong-session-busy" tone="danger">
                    DSH 占用中
                  </Tag>
                ) : (
                  node.descendantLive && (
                    <Tag className="rong-session-busy" tone="danger">
                      子会话占用中
                    </Tag>
                  )
                )}
              </span>
              <small className="rong-truncate">{row.id}</small>
            </div>
          ) : (
            <>
              <button
                type="button"
                className="rong-session-select"
                aria-label={`选择「${row.title}」 ${row.id}`}
                aria-pressed={selected}
                disabled={busy}
                onClick={() => selection.select([node], !selected)}
              >
                <span className="rong-session-heading">
                  <span
                    className={clsx(
                      'rong-truncate',
                      row.archived && 'rong-session-title-archived',
                      row.missing && 'rong-session-title-missing',
                    )}
                  >
                    {row.title}
                  </span>
                  {row.missing && <Tag className="rong-session-missing-tag">主会话缺失</Tag>}
                  {node.descendants.length > 0 && (
                    <Tag className="rong-session-subcount">{node.descendants.length} 个子会话</Tag>
                  )}
                  {row.live ? (
                    <Tag className="rong-session-busy" tone="danger">
                      DSH 占用中
                    </Tag>
                  ) : (
                    node.descendantLive && (
                      <Tag className="rong-session-busy" tone="danger">
                        子会话占用中
                      </Tag>
                    )
                  )}
                </span>
                <small className="rong-truncate">{row.id}</small>
              </button>

              <SessionActions
                targets={node}
                archived={row.archived}
                busy={busy}
                onAction={onAction}
              />
            </>
          )}
        </div>
      </Tooltip>

      {expandable && (
        <ul
          id={childrenId}
          hidden={!expanded}
          className="rong-session-children"
          role="group"
          aria-label={`「${row.title}」的子会话`}
        >
          {expanded &&
            node.children.map((child) => (
              <SessionItem
                key={child.row.id}
                node={child}
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
      )}
    </li>
  )
}
