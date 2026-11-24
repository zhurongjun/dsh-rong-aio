import { useState } from 'react'
import { useStore } from 'zustand'
import { useShallow } from 'zustand/react/shallow'
import {
  Button,
  Checkbox,
  Input,
  SegmentedTabs,
  Toast,
  IconSearchOutlineRegular,
  IconRefreshOutlineRegular,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { SessionRow } from '../shared/protocol.ts'
import { SessionGroups } from './SessionGroups.tsx'
import { SessionActions, DeleteConfirmation, type SessionActionHandler } from './SessionActions.tsx'
import { createSessionOperationsStore, type SessionSelection } from './operations-store.ts'

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
  visible,
  selection,
  archived,
  busy,
  onAction,
}: {
  visible: SessionRow[]
  selection: SessionSelection
  archived: boolean
  busy: boolean
  onAction: SessionActionHandler
}) {
  const selected = useStore(selection.store)
  const chosen = visible.filter((row) => selected.has(row.id))
  return (
    <div className="rong-session-toolbar">
      <Checkbox
        label={chosen.length ? '已选 ' + chosen.length + ' 项' : '全选'}
        disabled={busy || !visible.length}
        checked={visible.length > 0 && chosen.length === visible.length}
        onChange={(checked) => selection.select(visible, checked)}
      />
      <SessionActions targets={chosen} archived={archived} busy={busy} onAction={onAction} />
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

  const archived = tab === 'archived'
  const filter = query.trim().toLowerCase()
  const visible = rows.filter(
    (row) =>
      row.archived === archived &&
      (!filter ||
        [row.title, row.id, row.cwd, row.workspace.title].some((field) =>
          field?.toLowerCase().includes(filter),
        )),
  )

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
          visible={visible}
          selection={selection}
          archived={archived}
          busy={busy}
          onAction={onAction}
        />

        {visible.length ? (
          <SessionGroups
            key={tab}
            rows={visible}
            query={query}
            searchRevision={searchRevision}
            selection={selection}
            busy={busy}
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
