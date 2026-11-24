import { useStore } from 'zustand'
import { createContext, useContext, useState } from 'react'
import {
  Button,
  IconChevronDownOutlineRegular,
  Menu,
  MenuItemButton,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { ConfirmDialog } from './feedback.tsx'
import { selectedSessionOf, type SideClient } from './store.ts'

export const SideComposerContext = createContext<SideClient | null>(null)

function BoundEmbeddedPermission({ store, sessionId }: { store: SideClient; sessionId: string }) {
  const matches = useStore(store.view, (s) => selectedSessionOf(s.phase) === sessionId)
  if (!matches) return null
  return <PermissionControl store={store} />
}

export function EmbeddedPermission({ sessionId }: { sessionId: string }) {
  const store = useContext(SideComposerContext)
  if (!store) return null
  return <BoundEmbeddedPermission store={store} sessionId={sessionId} />
}

export function PermissionControl({ store }: { store: SideClient }) {
  const permission = useStore(store.view, (s) => s.permission)
  const parentPermission = useStore(store.view, (s) => s.parentPermission)
  const disabled = useStore(
    store.view,
    (s) =>
      s.busy ||
      (s.phase.kind !== 'ready' && !(s.phase.kind === 'draft' && !s.phase.creatingSessionId)),
  )
  const loading = useStore(store.view, (s) => s.busy || s.checkingPermission)
  const [open, setOpen] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const label = permission === 'follow' ? '跟随主会话' : '只读'
  return (
    <>
      <Menu
        portal
        side="top"
        open={open}
        onClose={() => setOpen(false)}
        anchor={
          <Button
            size="sm"
            className="rong-side-permission"
            disabled={disabled}
            aria-label={'侧聊权限：' + label}
            aria-haspopup="menu"
            aria-expanded={open}
            onClick={() => {
              if (!open) void store.refreshPermission()
              setOpen(!open)
            }}
          >
            {label}
            <IconChevronDownOutlineRegular size={14} />
          </Button>
        }
      >
        <MenuItemButton
          current={permission === 'read'}
          disabled={loading}
          onSelect={() => {
            setOpen(false)
            void store.setPermission('read')
          }}
        >
          只读
        </MenuItemButton>
        <MenuItemButton
          current={permission === 'follow'}
          disabled={loading}
          onSelect={() => {
            setOpen(false)
            if (permission !== 'follow') setConfirm(true)
          }}
        >
          跟随主会话
        </MenuItemButton>
      </Menu>
      {confirm && (
        <ConfirmDialog
          action="跟随主会话"
          close={() => setConfirm(false)}
          confirm={() => void store.setPermission('follow')}
          title="跟随主会话权限？"
          description={
            (parentPermission ? '主会话当前权限为 ' + parentPermission + '。' : '') +
            '这条侧聊将跟随主会话的权限，并单独处理审批。'
          }
        />
      )}
    </>
  )
}
