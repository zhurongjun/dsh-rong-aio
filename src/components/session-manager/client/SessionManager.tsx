import { SessionGroups } from './SessionGroups.tsx'
import { useEffect, useRef, useState } from 'react'
import {
  Button,
  Checkbox,
  Input,
  Modal,
  SegmentedTabs,
  Toast,
  IconArchiveOutlineRegular,
  IconArchiveOffOutlineRegular,
  IconSearchOutlineRegular,
  IconRefreshOutlineRegular,
  IconTrashOutlineRegular,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { API, type Action, type BatchResult, type SessionRow } from '../shared/protocol.ts'

const labels = { archive: '归档', restore: '复原', delete: '删除' }
const icons = {
  archive: IconArchiveOutlineRegular,
  restore: IconArchiveOffOutlineRegular,
  delete: IconTrashOutlineRegular,
}

function ActionButton({
  action,
  onClick,
  disabled,
  row,
}: {
  action: Action
  onClick: () => void
  disabled: boolean
  row?: string
}) {
  const Icon = icons[action]
  const label = row ? labels[action] + '「' + row + '」' : labels[action] + '所选会话'
  return (
    <Button
      size="sm"
      variant={row ? 'ghost' : 'outline'}
      className={action === 'delete' ? 'rong-session-danger' : undefined}
      aria-label={label}
      title={label}
      icon={<Icon size={16} />}
      disabled={disabled}
      onClick={onClick}
    >
      {row ? null : labels[action]}
    </Button>
  )
}

async function request<T>(signal: AbortSignal, body?: unknown): Promise<T> {
  const response = await fetch(API.slice(1), {
    signal,
    cache: 'no-store',
    ...(body
      ? {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        }
      : {}),
  })
  const data = await response.json()
  if (!response.ok) throw new Error(data.error ?? '无法读取会话管理接口')
  return data
}

export function SessionManager({ refreshSidebar }: { refreshSidebar: () => Promise<void> }) {
  const [rows, setRows] = useState<SessionRow[]>([])
  const [tab, setTab] = useState<'archived' | 'open'>('archived')
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(new Set<string>())
  const [confirm, setConfirm] = useState<SessionRow[]>([])
  const [busy, setBusy] = useState(true)
  const [notice, setNotice] = useState<{ text: string; toast?: boolean }>()
  const [errors, setErrors] = useState<string[]>([])
  const active = useRef<AbortController>()

  async function load(signal: AbortSignal) {
    const data = await request<SessionRow[]>(signal)
    if (!signal.aborted) setRows(data)
  }
  async function refresh() {
    active.current?.abort()
    const controller = new AbortController()
    active.current = controller
    setBusy(true)
    setErrors([])
    setSelected(new Set())
    setNotice(undefined)
    try {
      await Promise.all([load(controller.signal), refreshSidebar()])
    } catch (error) {
      if (!controller.signal.aborted) setErrors([String(error)])
    } finally {
      if (!controller.signal.aborted) setBusy(false)
    }
  }
  useEffect(() => {
    void refresh()
    return () => active.current?.abort()
  }, [])

  const archived = tab === 'archived'
  const filter = query.trim().toLowerCase()
  const visible = rows.filter(
    (row) =>
      row.archived === archived &&
      [row.title, row.id, row.cwd, row.workspace.title].some((field) =>
        field?.toLowerCase().includes(filter),
      ),
  )
  const chosen = visible.filter((row) => selected.has(row.id))
  const change: Action = archived ? 'restore' : 'archive'

  async function perform(action: Action, items: SessionRow[]) {
    if (busy || !items.length) return
    const controller = new AbortController()
    active.current = controller
    const { signal } = controller
    setBusy(true)
    setConfirm([])
    setErrors([])
    setNotice(undefined)
    try {
      const { outcomes, warning } = await request<BatchResult>(signal, {
        action,
        targets: items.map(({ id, createdAt }) => ({ id, createdAt })),
        ...(action === 'delete' ? { confirmed: true } : {}),
      })
      if (signal.aborted) return
      const failed = outcomes.filter((result) => result.error)
      const titles = new Map(items.map((row) => [row.id, row.title]))
      const messages = failed.map(
        (result) => (titles.get(result.id) ?? result.id) + '：' + result.error,
      )
      if (warning) messages.push(warning)
      setErrors(messages)
      const succeeded = outcomes.length - failed.length
      if (succeeded > 0 || action !== 'delete') {
        setNotice({ text: `已${labels[action]} ${succeeded} 个会话`, toast: action === 'delete' })
      }
      setSelected(new Set(failed.map((result) => result.id)))
      await Promise.all([load(signal), action === 'delete' && succeeded > 0 && refreshSidebar()])
    } catch (error) {
      if (!signal.aborted) setErrors((previous) => [...previous, String(error)])
    } finally {
      if (!signal.aborted) setBusy(false)
    }
  }
  function actions(items: SessionRow[], row?: string) {
    return (
      <>
        <ActionButton
          action={change}
          row={row}
          disabled={busy || !items.length}
          onClick={() => void perform(change, items)}
        />
        <ActionButton
          action="delete"
          row={row}
          disabled={busy || !items.length || items.some((item) => item.live)}
          onClick={() => setConfirm(items)}
        />
      </>
    )
  }

  return (
    <section className="rong-session-page" aria-label="会话管理">
      <div className="rong-session-toolbar">
        <SegmentedTabs
          label="归档状态"
          size="sm"
          value={tab}
          onChange={(value) => {
            setTab(value)
            setSelected(new Set())
          }}
          items={[
            {
              value: 'archived',
              label: '已归档',
              id: 'rong-session-archived',
              panelId: 'rong-session-panel',
            },
            {
              value: 'open',
              label: '未归档',
              id: 'rong-session-open',
              panelId: 'rong-session-panel',
            },
          ]}
        />
        <Button
          size="sm"
          onClick={() => void refresh()}
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
          setSelected(new Set())
        }}
      />
      <div role="tabpanel" id="rong-session-panel" aria-labelledby={'rong-session-' + tab}>
        <div className="rong-session-toolbar">
          <Checkbox
            label={chosen.length ? '已选 ' + chosen.length + ' 项' : '全选'}
            disabled={busy || !visible.length}
            checked={visible.length > 0 && chosen.length === visible.length}
            onChange={(checked) =>
              setSelected(new Set(checked ? visible.map((row) => row.id) : []))
            }
          />
          <div className="rong-session-actions">{actions(chosen)}</div>
        </div>
        {visible.length ? (
          <SessionGroups
            key={JSON.stringify([tab, query])}
            rows={visible}
            busy={busy}
            selected={selected}
            select={(items, checked) =>
              setSelected((previous) => {
                const next = new Set(previous)
                for (const { id } of items) {
                  if (checked) next.add(id)
                  else next.delete(id)
                }
                return next
              })
            }
            actions={(row) => actions([row], row.title)}
            openDirectory={async ({ id, createdAt }) => {
              const signal = active.current?.signal
              if (signal && !signal.aborted)
                await request(signal, {
                  action: 'open-directory',
                  target: { id, createdAt },
                })
            }}
            feedback={(message, failed) => {
              if (failed) setErrors([message])
              else {
                setErrors([])
                setNotice({ text: message })
              }
            }}
          />
        ) : (
          <p role="status">
            {busy
              ? '正在读取会话…'
              : filter
                ? '没有匹配的会话'
                : archived
                  ? '暂无已归档会话'
                  : '暂无未归档会话'}
          </p>
        )}
      </div>
      {notice &&
        (notice.toast ? (
          <Toast text={notice.text} tone="success" onDone={() => setNotice(undefined)} />
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
      <Modal
        open={confirm.length > 0}
        onClose={() => setConfirm([])}
        title={'永久删除 ' + confirm.length + ' 个会话？'}
        closeLabel="关闭"
        description="将从磁盘删除所列会话的日志和专属文件。此操作无法撤销。"
        footer={
          <>
            <Button data-modal-autofocus onClick={() => setConfirm([])}>
              取消
            </Button>
            <Button
              variant="outline"
              className="rong-session-danger rong-session-confirm"
              icon={<IconTrashOutlineRegular size={16} />}
              onClick={() => void perform('delete', confirm)}
            >
              永久删除
            </Button>
          </>
        }
      >
        <ul className="rong-session-targets">
          {confirm.map((row) => (
            <li key={row.id}>
              <strong>{row.title}</strong>
              {row.title !== row.id && <small>{row.id}</small>}
            </li>
          ))}
        </ul>
      </Modal>
    </section>
  )
}
