import { useState } from 'react'
import { useStore } from 'zustand'
import { useShallow } from 'zustand/react/shallow'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import {
  Button,
  Menu,
  MenuItemButton,
  IconBranchOutlineRegular,
  IconPlusOutlineRegular,
  IconTrashOutlineRegular,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { ConfirmDialog, SideError } from './feedback.tsx'
import type { SideClient } from './store.ts'
import type { SideTabs } from './tabs.ts'
import { useSideHistory } from './useSideHistory.ts'
import type { SideRow } from '../shared/protocol.ts'

type Entry = { title: string } & ({ draft: SideClient } | { row: SideRow })

export function Manager({ tabs, source }: { tabs: SideTabs; source: SessionId }) {
  const [open, setOpen] = useState(false)
  const [confirm, setConfirm] = useState<Entry>()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const history = useSideHistory(tabs, source, open)
  async function remove(entry: Entry) {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      if ('draft' in entry) {
        const { busy, selected } = entry.draft.view.getState()
        if (busy || selected) throw new Error('这条草稿已开始发送，请重新选择侧聊。')
        entry.draft.close()
      } else {
        await tabs.remove(source, entry.row)
      }
    } catch (err) {
      setError(String(err))
      setOpen(true)
    } finally {
      setBusy(false)
    }
  }

  async function pick(entry: Entry) {
    setOpen(false)
    try {
      if ('draft' in entry) await tabs.focus(entry.draft.source, entry.draft.tabId)
      else await tabs.open(source, entry.row)
    } catch (err) {
      setError(String(err))
      setOpen(true)
    }
  }
  const discard = confirm && 'draft' in confirm
  return (
    <>
      <Menu
        portal
        autoFocus
        dense
        align="end"
        open={open}
        onClose={() => setOpen(false)}
        listClassName="rong-side-list"
        anchor={
          <Button
            size="sm"
            className="rong-side-trigger"
            aria-label="侧聊列表"
            title="侧聊列表"
            aria-expanded={open}
            aria-haspopup="menu"
            icon={<IconBranchOutlineRegular size={16} />}
            onClick={() => {
              setError('')
              setOpen(!open)
            }}
          />
        }
      >
        <MenuItemButton
          icon={<IconPlusOutlineRegular size={16} />}
          onSelect={() => {
            tabs.show()
            setOpen(false)
          }}
        >
          新建侧聊
        </MenuItemButton>
        {open && (
          <SideRows
            tabs={tabs}
            source={source}
            rows={history.rows}
            busy={busy}
            hasError={!!(error || history.error)}
            pick={pick}
            confirm={setConfirm}
          />
        )}
        <SideError
          message={error || history.error}
          retry={() => {
            setError('')
            tabs.historyChanges.dispatchEvent(new Event(source))
          }}
        />
      </Menu>
      {confirm && (
        <ConfirmDialog
          destructive
          close={() => setConfirm(undefined)}
          action={discard ? '丢弃草稿' : '永久删除'}
          confirm={() => void remove(confirm)}
          title={discard ? '丢弃侧聊草稿？' : '永久删除侧聊？'}
          description={
            discard
              ? '将关闭「' + confirm.title + '」并丢弃未发送的内容。'
              : '将永久删除「' + confirm.title + '」的对话和工具记录。'
          }
        />
      )}
    </>
  )
}

type ListActions = {
  busy: boolean
  pick: (entry: Entry) => Promise<void>
  confirm: (entry: Entry) => void
}

function SideRows({
  tabs,
  source,
  rows,
  hasError,
  ...actions
}: ListActions & {
  tabs: SideTabs
  source: SessionId
  rows?: SideRow[]
  hasError: boolean
}) {
  const drafts = useStore(
    tabs.drafts,
    useShallow((all) => all.filter((c) => c.view.getState().draft?.fork.parent === source)),
  )
  return (
    <>
      {drafts.map((draft) => (
        <DraftRow key={draft.key} draft={draft} {...actions} />
      ))}
      {rows?.map((row) => (
        <ListRow
          key={row.id}
          entry={{ row, title: row.title || '新侧聊' }}
          note={row.pending ? '待审批' : undefined}
          {...actions}
        />
      ))}
      {!drafts.length && !rows?.length && !hasError && (
        <div className="rong-side-list-note">{rows ? '暂无侧聊' : '正在读取侧聊…'}</div>
      )}
    </>
  )
}

function DraftRow({ draft, ...actions }: ListActions & { draft: SideClient }) {
  const title = useStore(draft.view, (s) => s.draft?.text.trim().split('\n', 1)[0] || '新侧聊')
  const sending = useStore(draft.view, (s) => s.busy)
  return (
    <ListRow entry={{ draft, title }} note="草稿" {...actions} busy={actions.busy || sending} />
  )
}
function ListRow({
  entry,
  note,
  busy,
  pick,
  confirm,
}: ListActions & { entry: Entry; note?: string }) {
  return (
    <div className="rong-side-list-row" role="group" aria-label={entry.title}>
      <MenuItemButton onSelect={() => void pick(entry)}>
        <span className="rong-side-list-label">
          <span className="rong-side-list-title" title={entry.title}>
            {entry.title}
          </span>
          {note && <small>{note}</small>}
        </span>
      </MenuItemButton>
      <Button
        role="menuitem"
        size="sm"
        variant="ghost"
        className="rong-side-delete"
        aria-label={'删除 ' + entry.title}
        title={'draft' in entry ? '丢弃草稿' : '删除侧聊'}
        icon={<IconTrashOutlineRegular size={16} />}
        disabled={busy}
        onClick={() => confirm(entry)}
      />
    </div>
  )
}
