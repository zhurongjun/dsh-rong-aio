/** 图标选项菜单：Fast 与 Agent Team 共用定位、退场、键盘导航和焦点恢复。 */

import { useId, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import clsx from 'clsx'
import { useStore } from 'zustand'
import { MenuSurface, IconCheckOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import { createAnchoredPopover } from '../../../client/anchored-popover.ts'
import { createMenuPresence } from '../../../client/store.ts'
import { SelectionButton } from './SelectionButton.tsx'

function focusMenuRadio(el: HTMLButtonElement | null) {
  el?.focus({ preventScroll: true })
}

interface Props<Value extends string> {
  /** 已确认选项与菜单文案；组件不持有业务选择。 */
  value: Value
  items: readonly { value: Value; label: string }[]
  label: string
  menuLabel: string
  icon: ReactNode
  className: string
  /** 主菜单生命周期及业务可用性。 */
  open: boolean
  disabled: boolean
  busy: boolean
  onSelect(value: Value): void
}

/** 业务组件按会话或模型身份重建本组件；只维护 UI 生命周期。 */
export function OptionControl<Value extends string>({
  value,
  items,
  label,
  menuLabel,
  icon,
  className,
  open,
  disabled,
  busy,
  onSelect,
}: Props<Value>) {
  const [presence] = useState(() => createMenuPresence(180))
  const menuState = useStore(presence)
  const [popover] = useState(() =>
    createAnchoredPopover({
      placement: 'side',
      onMount(surface, signal, { getAnchor }) {
        document.addEventListener(
          'pointerdown',
          (event) => {
            if (
              !surface.contains(event.target as Node) &&
              !getAnchor()?.contains(event.target as Node)
            ) {
              presence.close()
            }
          },
          { signal },
        )
      },
    }),
  )
  const position = useStore(popover.store, (state) => state.position)
  const id = useId()
  const enabled = open && !disabled && !busy
  const visible = menuState.expanded && enabled
  const ready = visible && position !== null
  const { mounted } = menuState

  /** 先收起菜单并恢复按钮焦点，再委托业务保存；不提前改写显示值。 */
  function choose(next: Value) {
    if (!visible) return
    presence.close()
    popover.focusAnchor()
    onSelect(next)
  }

  const bindAnchor = (el: HTMLButtonElement | null) => popover.bindAnchor(el)
  const bindSurface = (el: HTMLDivElement | null) => popover.bindSurface(el)
  const closeDisabledMenu = (el: HTMLDivElement | null) => {
    if (el && presence.getState().expanded) presence.close()
  }

  return (
    <>
      <SelectionButton
        ref={bindAnchor}
        className={clsx('rong-icon-button rong-header-action', className)}
        disabled={disabled}
        inactive={!open}
        busy={busy}
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={visible}
        aria-controls={visible ? id : undefined}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault()
            event.stopPropagation()
            if (!presence.getState().expanded) presence.open()
            else {
              const buttons = popover.surface()?.querySelectorAll<HTMLButtonElement>('button')
              const index = event.key === 'ArrowDown' ? 0 : (buttons?.length ?? 1) - 1
              buttons?.[index]?.focus()
            }
          }
          if (presence.getState().expanded && event.key === 'Escape') {
            event.preventDefault()
            event.stopPropagation()
            presence.close()
          }
          if (event.key === 'Tab') presence.close()
        }}
        onClick={() => {
          if (presence.getState().expanded) presence.close()
          else presence.open()
        }}
      >
        {icon}
      </SelectionButton>
      {mounted &&
        createPortal(
          <MenuSurface
            compact
            ref={bindSurface}
            id={id}
            role={ready ? 'menu' : undefined}
            aria-hidden={!ready || undefined}
            aria-label={menuLabel}
            data-rong-option-menu
            data-open={visible}
            className="rong-option-menu"
            style={position ?? { visibility: 'hidden' }}
            onTransitionEnd={(event) => {
              if (
                event.target === event.currentTarget &&
                event.propertyName === 'transform' &&
                !visible
              ) {
                presence.unmount()
              }
            }}
            onKeyDown={(event) => {
              if (!visible) return
              const buttons = Array.from(
                event.currentTarget.querySelectorAll<HTMLButtonElement>('button'),
              )
              const current = buttons.indexOf(document.activeElement as HTMLButtonElement)
              if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
                event.preventDefault()
                const index =
                  event.key === 'Home'
                    ? 0
                    : event.key === 'End'
                      ? buttons.length - 1
                      : (current + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) %
                        buttons.length
                buttons[index]?.focus()
              }
              if (event.key === 'Escape' || event.key === 'Tab') {
                event.preventDefault()
                presence.close()
                popover.focusAnchor()
              }
              event.stopPropagation()
            }}
          >
            <div className="rong-option-items" ref={!enabled ? closeDisabledMenu : undefined}>
              {items.map((item) => (
                <button
                  ref={
                    visible && position !== null && value === item.value
                      ? focusMenuRadio
                      : undefined
                  }
                  key={item.value}
                  type="button"
                  role="menuitemradio"
                  aria-checked={value === item.value}
                  disabled={!visible}
                  onClick={() => void choose(item.value)}
                >
                  <span>{item.label}</span>
                  <span className="rong-option-check" aria-hidden="true">
                    {value === item.value && <IconCheckOutlineRegular size={16} />}
                  </span>
                </button>
              ))}
            </div>
          </MenuSurface>,
          document.body,
        )}
    </>
  )
}
