/** 输入框入口：选择菜单、只读快照、管理入口和 Toast 共用同一宿主会话视图。 */

import { useState } from 'react'
import { useStore } from 'zustand'
import {
  Menu,
  MenuItemButton,
  Toast,
  IconWarningOutlineRegular,
  IconChevronDownOutlineRegular,
  IconCheckOutlineRegular,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { useComposerToastAnchor } from '../../../client/useComposerToastAnchor.ts'
import { stateLabel, type InjectState } from '../shared/state.ts'
import { Settings } from './Settings.tsx'
import type { InjectStore } from './store.ts'
import { sessionState } from './session-state.ts'
import { ArmorIcon } from './ArmorIcon.tsx'
import { Dialog } from './Dialog.tsx'
import { SnapshotDialog } from './SnapshotDialog.tsx'

/** 原生输入框插槽输入与本组件注入的依赖；独立运行时通过 available 排除。 */
type Props = PropsRuntime<'conversation.input.left'> & {
  /** 此会话长期持有的权威视图与通知确认状态。 */
  store: InjectStore

  /** 按固定工作区获取管理 store，不允许管理页切换工程。 */
  settingsFor: (workspace?: string) => InjectStore

  /** 当前输入框是否属于可接管的本地会话。 */
  available: boolean
}

/** 独立运行时不挂载状态订阅，避免触发会话 store 的自动拉取和发送阻塞。 */
export function Composer(props: Props) {
  if (!props.available) return null
  return (
    <ActiveComposer
      sessionId={props.sessionId}
      store={props.store}
      settingsFor={props.settingsFor}
    />
  )
}

/**
 * 把宿主 resolve 结果投影为按钮、光晕与菜单/只读快照。
 * 有效选择即显示开启状态；是否可编辑只看 resolved.editable，不推断发送历史。
 */
function ActiveComposer({
  sessionId,
  store,
  settingsFor,
}: Pick<Props, 'sessionId' | 'store' | 'settingsFor'>) {
  const data = useStore(store, (state) => state.data)
  const error = useStore(store, (state) => state.error)
  const errorId = useStore(store, (state) => state.errorId)
  const verified = useStore(store, (state) => state.verified)
  const saving = useStore(store, (state) => state.saving)
  const dismissedNotice = useStore(store, (state) => state.dismissedNotice)

  // 本次视图的弹层状态；权威选择、通知和模板数据均留在 store。
  const [open, setOpen] = useState(false)
  const [manage, setManage] = useState(false)
  const [snapshotOpen, setSnapshotOpen] = useState(false)
  const { bindTrigger, toastAnchor } = useComposerToastAnchor()

  // 统一展示链路：不再把模型、快照文件存在性或最近错误作为开启状态来源。
  const view = data?.session
  const readOnly = !!view && !view.resolved.editable
  const menuOpen = open && !readOnly
  const { notice, active } = sessionState(data, verified, saving, error, errorId, dismissedNotice)

  const statusLabel = view ? stateLabel(view.resolved) : '未破甲'
  const choice = view?.resolved.state

  /** 先关闭选择菜单，再提交候选。拒绝只产生通知，原名称、图标和光晕继续来自权威视图。 */
  const choose = (state: InjectState) => {
    setOpen(false)
    void store.execute({ type: 'select', sessionId, state })
  }

  // 交互资格来自宿主 busy/editable 与传输状态，不能由菜单预览提前修改。
  const disabled = saving || !verified || !!view?.busy || !view
  return (
    <>
      <span
        className="rong-inject-marker"
        data-rong-inject-active={active ? 'true' : 'false'}
        aria-hidden="true"
      />
      <Menu
        className="rong-inject-control"
        open={menuOpen}
        onClose={() => setOpen(false)}
        side="top"
        portal
        autoFocus={false}
        listClassName="rong-inject-menu"
        anchor={
          <button
            ref={bindTrigger}
            type="button"
            className="rong-inject-trigger"
            data-active={active ? 'true' : 'false'}
            aria-label={`破甲模式：${statusLabel}`}
            aria-haspopup={readOnly ? 'dialog' : 'menu'}
            aria-expanded={readOnly ? snapshotOpen : menuOpen}
            title={readOnly ? '查看破甲快照' : '选择破甲词'}
            onClick={() => {
              if (readOnly) setSnapshotOpen(true)
              else setOpen((previous) => !previous)
              void store.refresh()
            }}
          >
            <span className="rong-inject-trigger-icon" aria-hidden="true">
              <ArmorIcon active={active} />
            </span>
            <span className="rong-inject-trigger-label" title={statusLabel}>
              {statusLabel}
            </span>
            {!readOnly && (
              <span className="rong-inject-trigger-chevron" aria-hidden="true">
                <IconChevronDownOutlineRegular size={14} />
              </span>
            )}
          </button>
        }
      >
        {view?.resolved.status === 'invalid' && (
          <div className="rong-inject-menu-hint">{view.resolved.message}</div>
        )}
        {!!data?.config?.errors.length && view?.resolved.status !== 'invalid' && (
          <div className="rong-inject-menu-hint">{data.config.errors.join('；')}</div>
        )}
        {error && (
          <MenuItemButton icon={<span />} onSelect={() => void store.refresh()}>
            重试读取
          </MenuItemButton>
        )}
        {!readOnly && (
          <>
            <MenuItemButton
              current={choice?.name === null}
              icon={choice?.name === null ? <IconCheckOutlineRegular /> : <span />}
              disabled={disabled}
              onSelect={() => void choose({ name: null })}
            >
              关闭
            </MenuItemButton>
            {data?.config?.templates.map((item) => (
              <MenuItemButton
                key={item.file}
                current={choice?.name === item.name}
                icon={choice?.name === item.name ? <IconCheckOutlineRegular /> : <span />}
                disabled={disabled || item.conflict}
                onSelect={() => void choose({ name: item.name })}
              >
                <span className="rong-inject-menu-label">
                  <span
                    className="rong-inject-menu-name"
                    title={`${item.display_name} · ${item.name} · ${item.file}`}
                  >
                    {item.display_name}
                  </span>
                  <small className="rong-inject-menu-detail">
                    {item.scope === 'user' ? '用户' : '工程'}
                    {item.conflict ? ' · 名称冲突' : ''}
                  </small>
                </span>
              </MenuItemButton>
            ))}
          </>
        )}
        <MenuItemButton
          separatorBefore
          icon={<span />}
          onSelect={() => {
            setOpen(false)
            setManage(true)
          }}
        >
          管理破甲模式…
        </MenuItemButton>
      </Menu>
      {snapshotOpen && (
        <SnapshotDialog
          open
          onClose={() => setSnapshotOpen(false)}
          view={view}
          statusLabel={statusLabel}
        />
      )}
      {manage && (
        <Dialog
          open
          onClose={() => {
            setManage(false)
            void store.refresh()
          }}
          title="破甲模式"
          size="content"
        >
          <Settings key={view?.workspace ?? ''} store={settingsFor(view?.workspace)} />
        </Dialog>
      )}
      {notice && (
        <Toast
          key={notice.key}
          text={notice.message}
          icon={<IconWarningOutlineRegular />}
          anchor={toastAnchor}
          holdMs={5000}
          onDone={() => store.dismissNotice(notice.key)}
        />
      )}
    </>
  )
}
