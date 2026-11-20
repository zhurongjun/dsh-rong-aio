/** 测试宿主的 DSH 基础控件。插件提供菜单选项、事件处理和业务状态。 */
import { cloneElement, createElement as h, forwardRef, useLayoutEffect, useState } from 'react'

export const Button = forwardRef(
  ({ icon, size: _size, variant: _variant, children, ...props }, ref) =>
    h('button', { ...props, ref }, icon, children),
)
export const Input = forwardRef(({ icon: _icon, ...props }, ref) => h('input', { ...props, ref }))
export const Checkbox = ({ label, checked, onChange, disabled, className }) =>
  h(
    'label',
    { className },
    h('input', {
      type: 'checkbox',
      checked,
      disabled,
      onChange: (event) => onChange(event.target.checked),
    }),
    h('span', {}, label),
  )
export const MenuSurface = forwardRef(({ compact: _compact, ...props }, ref) =>
  h('div', { ...props, ref }),
)
export const Tag = ({ children }) => h('span', {}, children)
export function Tooltip({ label, children, disabled }) {
  const [shown, setShown] = useState(false)
  return [
    cloneElement(children, {
      key: 'anchor',
      onMouseEnter: () => setShown(true),
      onMouseLeave: () => setShown(false),
    }),
    shown &&
      !disabled &&
      h('li', { key: 'tooltip', role: 'tooltip' }, typeof label === 'function' ? label() : label),
  ]
}
export const MenuItemButton = ({ children, onSelect, disabled }) =>
  h('button', { role: 'menuitem', disabled, onClick: onSelect }, children)
export function Menu({ anchor, open, items, children, onSelect }) {
  return h(
    'div',
    {},
    anchor,
    open &&
      h(
        'div',
        { role: 'menu' },
        children,
        items?.map((item) =>
          h(
            'button',
            {
              key: item.id,
              role: 'menuitem',
              disabled: item.disabled,
              onClick: () => onSelect(item.id),
            },
            item.label,
          ),
        ),
      ),
  )
}
export const Modal = ({ open, title, children, footer }) =>
  open
    ? h('div', { role: 'dialog', 'aria-modal': true, 'aria-label': title }, children, footer)
    : null
export const Toast = ({ text, onDone }) =>
  h(
    'div',
    { role: 'status' },
    text,
    h('button', { 'aria-label': '关闭通知', onClick: onDone }, '关闭'),
  )
export const SegmentedTabs = ({ label, value, items, onChange }) =>
  h(
    'div',
    { role: 'tablist', 'aria-label': label },
    items.map((item) =>
      h(
        'button',
        {
          id: item.id,
          key: item.value,
          role: 'tab',
          'aria-selected': value === item.value,
          onClick: () => onChange(item.value),
        },
        item.label,
      ),
    ),
  )
export const isBehindModal = (anchor) => {
  const modal = anchor?.ownerDocument.querySelector('[aria-modal="true"]')
  return !!modal && !modal.contains(anchor)
}
export function useModalLayer(ref, open) {
  useLayoutEffect(() => {
    if (!open) return
    const previous = ref.current.ownerDocument.activeElement
    ref.current.querySelector('[data-modal-autofocus]')?.focus()
    return () => previous?.focus()
  }, [ref, open])
}
export const useDismissOnOutsidePointer = () => {}
export const writeClipboard = async (text) => {
  await globalThis.navigator.clipboard.writeText(text)
  return true
}
export const PathLabel = ({ path }) => h('span', {}, path)
const Icon = () => null
export {
  Icon as IconUsersOutlineRegular,
  Icon as IconShieldOutlineRegular,
  Icon as IconChevronDownOutlineRegular,
  Icon as IconCheckOutlineRegular,
  Icon as IconCloseOutlineRegular,
  Icon as IconDataOutlineRegular,
  Icon as IconRefreshOutlineRegular,
  Icon as IconChevronRightOutlineRegular,
  Icon as IconWarningOutlineRegular,
  Icon as IconPlusOutlineRegular,
  Icon as IconSearchOutlineRegular,
  Icon as IconTrashOutlineRegular,
  Icon as IconArchiveOutlineRegular,
  Icon as IconArchiveOffOutlineRegular,
  Icon as IconFolderOpenRegular,
  Icon as IconFolderCloseRegular,
  Icon as IconTriangleRightFillRegular,
  Icon as IconChevronLeftOutlineRegular,
  Icon as IconEllipsisOutlineRegular,
}
