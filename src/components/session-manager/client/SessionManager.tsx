import { useState } from 'react'
import { useStore } from 'zustand'
import { useShallow } from 'zustand/react/shallow'
import {
  Button,
  Checkbox,
  Input,
  SegmentedTabs,
  Toast,
  IconChevronsUpDownOutlineRegular,
  IconSearchOutlineRegular,
  IconRefreshOutlineRegular,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { buildSessionTree, collectExpandableIds, type SessionNode } from '../shared/tree.ts'
import { SessionGroups } from './SessionGroups.tsx'
import { SessionActions, DeleteConfirmation, type SessionActionHandler } from './SessionActions.tsx'
import { createSessionOperationsStore, type SessionSelection } from './operations-store.ts'

const EMPTY_COLLAPSED: ReadonlySet<string> = new Set()

const tabs = [
  {
    value: 'archived',
    label: '已归档',
    id: 'rong-session-archived',
    panelId: 'rong-session-panel',
  },
  { value: 'open', label: '未归档', id: 'rong-session-open', panelId: 'rong-session-panel' },
] as const

function BatchToolbar({
  nodes,
  selection,
  archived,
  busy,
  onAction,
  expandableCount,
  allCollapsed,
  onToggleAll,
}: {
  nodes: SessionNode[]
  selection: SessionSelection
  archived: boolean
  busy: boolean
  onAction: SessionActionHandler
  expandableCount: number
  allCollapsed: boolean
  onToggleAll: () => void
}) {
  const selected = useStore(selection.store)
  const selectable = nodes.filter((node) => !node.row.subagent)
  const chosen = selectable.filter((node) => selected.has(node.row.id))
  const foldLabel = allCollapsed ? '展开全部子会话' : '折叠全部子会话'

  return (
    <div className="rong-session-toolbar">
      <Checkbox
        label={chosen.length ? '已选 ' + chosen.length + ' 项' : '全选'}
        disabled={busy || !selectable.length}
        checked={selectable.length > 0 && chosen.length === selectable.length}
        onChange={(checked) => selection.select(selectable, checked)}
      />
      <div className="rong-session-toolbar-right">
        {expandableCount > 0 && (
          <Button
            size="sm"
            variant="ghost"
            icon={<IconChevronsUpDownOutlineRegular size={15} />}
            aria-label={foldLabel}
            title={foldLabel}
            disabled={busy}
            onClick={onToggleAll}
          >
            {allCollapsed ? '展开子会话' : '折叠子会话'}
          </Button>
        )}
        <SessionActions targets={chosen} archived={archived} busy={busy} onAction={onAction} />
      </div>
    </div>
  )
}

function emptyStatusText(busy: boolean, hasFilter: boolean, archived: boolean): string {
  if (busy) return '正在读取会话…'
  if (hasFilter) return '没有匹配的会话'
  return archived ? '暂无已归档会话' : '暂无未归档会话'
}

export function SessionManager({ refreshSidebar }: { refreshSidebar: () => Promise<void> }) {
  const [ops] = useState(() => createSessionOperationsStore(refreshSidebar))
  const { rows, busy, notice, errors, pendingDelete } = useStore(
    ops,
    useShallow((state) => ({
      rows: state.rows,
      busy: state.busy,
      notice: state.notice,
      errors: state.errors,
      pendingDelete: state.pendingDelete,
    })),
  )
  const {
    selection,
    refresh,
    onAction,
    openDirectory,
    feedback,
    dismissNotice,
    cancelDelete,
    confirmDelete,
  } = ops

  const [tab, setTab] = useState<'archived' | 'open'>('archived')
  const [query, setQuery] = useState('')
  const [searchRevision, setSearchRevision] = useState(0)
  const [foldState, setFoldState] = useState<{
    tab: 'archived' | 'open'
    revision: number
    collapsed: ReadonlySet<string>
  }>({
    tab: 'archived',
    revision: 0,
    collapsed: EMPTY_COLLAPSED,
  })

  const archived = tab === 'archived'
  const filter = query.trim().toLowerCase()
  const visible = buildSessionTree(rows, query, archived)
  const expandableIds = collectExpandableIds(visible)
  const collapsedIds =
    foldState.tab === tab && foldState.revision === searchRevision
      ? foldState.collapsed
      : EMPTY_COLLAPSED
  const allCollapsed = expandableIds.length > 0 && expandableIds.every((id) => collapsedIds.has(id))

  function toggleNode(id: string) {
    setFoldState((current) => {
      const base =
        current.tab === tab && current.revision === searchRevision
          ? current.collapsed
          : EMPTY_COLLAPSED
      const next = new Set(base)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return { tab, revision: searchRevision, collapsed: next }
    })
  }

  function toggleAllNodes() {
    setFoldState({
      tab,
      revision: searchRevision,
      collapsed: allCollapsed ? EMPTY_COLLAPSED : new Set(expandableIds),
    })
  }

  return (
    <section className="rong-session-page" aria-label="会话管理">
      <div className="rong-session-toolbar">
        <SegmentedTabs
          label="归档状态"
          size="sm"
          items={tabs}
          value={tab}
          onChange={(next) => {
            setTab(next)
            selection.replace([])
          }}
        />
        <Button
          size="sm"
          onClick={refresh}
          disabled={busy}
          aria-label="刷新会话"
          title="刷新会话"
          icon={<IconRefreshOutlineRegular size={16} />}
        />
      </div>

      <Input
        aria-label="搜索会话"
        placeholder="搜索标题、工作区或会话 ID"
        value={query}
        icon={<IconSearchOutlineRegular size={16} />}
        onChange={(event) => {
          setQuery(event.target.value)
          setSearchRevision((revision) => revision + 1)
          selection.replace([])
        }}
      />

      <div role="tabpanel" id="rong-session-panel" aria-labelledby={'rong-session-' + tab}>
        <BatchToolbar
          nodes={visible}
          selection={selection}
          archived={archived}
          busy={busy}
          onAction={onAction}
          expandableCount={expandableIds.length}
          allCollapsed={allCollapsed}
          onToggleAll={toggleAllNodes}
        />

        {visible.length ? (
          <SessionGroups
            key={tab}
            nodes={visible}
            query={query}
            searchRevision={searchRevision}
            selection={selection}
            busy={busy}
            collapsedIds={collapsedIds}
            onToggleNode={toggleNode}
            onAction={onAction}
            openDirectory={openDirectory}
            feedback={feedback}
          />
        ) : (
          <p role="status">{emptyStatusText(busy, !!filter, archived)}</p>
        )}
      </div>

      {notice &&
        (notice.toast ? (
          <Toast text={notice.text} tone="success" onDone={dismissNotice} />
        ) : (
          <div role="status">{notice.text}</div>
        ))}

      {errors.length > 0 && (
        <ul role="alert">
          {errors.map((error, index) => (
            <li key={index}>{error}</li>
          ))}
        </ul>
      )}

      <DeleteConfirmation
        items={pendingDelete}
        busy={busy}
        cancel={cancelDelete}
        confirm={confirmDelete}
      />
    </section>
  )
}
