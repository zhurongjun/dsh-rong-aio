import { useStore } from 'zustand'
import { createContext, memo, useContext, useState } from 'react'
import {
  Button,
  IconChevronDownOutlineRegular,
  Menu,
  MenuItemButton,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { ConfirmDialog } from './feedback.tsx'
import type { SideClient } from './store.ts'

export const SideComposerContext = createContext<SideClient | null>(null)

export function EmbeddedPermission({ sessionId }: { sessionId: string }) {
  const store = useContext(SideComposerContext)
  if (!store || store.view.getState().selected !== sessionId) return null
  return <PermissionControl store={store} />
}

export const PermissionControl = memo(function PermissionControl({ store }: { store: SideClient }) {
  const permission = useStore(store.view, (s) => s.permission)
  const parentPermission = useStore(store.view, (s) => s.parentPermission)
  const disabled = useStore(
    store.view,
    (s) => s.busy || (!s.reference && (!s.draft || !!s.selected)),
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
})
