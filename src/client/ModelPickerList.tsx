/** 通用分组可搜索模型列表：统一工具栏、提供商分组、高亮度滚动定位与键盘导航。 */

import { forwardRef, type KeyboardEvent } from 'react'
import clsx from 'clsx'
import {
  isBehindModal,
  IconCheckOutlineRegular,
  IconChevronLeftOutlineRegular,
  IconSearchOutlineRegular,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { scrollNearest } from './store.ts'

export interface ModelPickerItem {
  key: string
  index: number
  label: string
  title?: string
  ariaLabel?: string
  selected: boolean
  disabled?: boolean
  busy?: boolean
  highlighted: boolean
  onHighlight: () => void
  onSelect: () => void
}

export interface ModelPickerGroup {
  key: string
  label: string
  title?: string
  items: ModelPickerItem[]
}

export interface ModelPickerListProps {
  listId: string
  groups: ModelPickerGroup[]
  hasItems: boolean
  activeIndex: number
  query: string
  searchLabel: string
  backLabel: string
  backDisabled?: boolean
  autoFocusInput?: boolean
  focusReady?: boolean
  emptyText: string
  onBack: () => void
  onQueryChange: (query: string) => void
}

function focusSearchInput(el: HTMLDivElement | null) {
  const input = el?.querySelector<HTMLInputElement>('input')
  if (input && !isBehindModal(input)) input.focus({ preventScroll: true })
}

/** 面板内 Tab / Shift+Tab 首尾焦点循环，跳过禁用元素。 */
export function trapFocusTabKey(
  event: KeyboardEvent<HTMLElement>,
  container: HTMLElement | null,
): void {
  if (event.key !== 'Tab' || !container) return
  const controls = Array.from(
    container.querySelectorAll<HTMLElement>(
      'button:not(:disabled),input:not(:disabled),[tabindex="0"]',
    ),
  ).filter((element) => element.tabIndex >= 0)
  const first = controls[0]
  const last = controls.at(-1)
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault()
    last?.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first?.focus()
  }
}

/** 列表搜索模式键盘导航：屏蔽 IME 组合与系统快捷键，统一方向键、Enter 提交与 Tab 循环。 */
export function handlePickerKeyDown(
  event: KeyboardEvent<HTMLElement>,
  options: {
    container: HTMLElement | null
    searchInput: HTMLInputElement | null
    onStepHighlight: (delta: 1 | -1) => void
    onConfirm: () => void
  },
): void {
  if (event.nativeEvent.isComposing || event.ctrlKey || event.metaKey || event.altKey) return
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault()
    options.onStepHighlight(event.key === 'ArrowDown' ? 1 : -1)
    options.searchInput?.focus({ preventScroll: true })
    return
  }
  if (event.key === 'Enter' && event.target === options.searchInput) {
    event.preventDefault()
    options.onConfirm()
    return
  }
  trapFocusTabKey(event, options.container)
}

/** 可搜索分组选择器面板；ref 指向搜索输入框，键盘导航由外层浮层协调。 */
export const ModelPickerList = forwardRef<HTMLInputElement, ModelPickerListProps>(
  function ModelPickerList(
    {
      listId,
      groups,
      hasItems,
      activeIndex,
      query,
      searchLabel,
      backLabel,
      backDisabled = false,
      autoFocusInput = false,
      focusReady = false,
      emptyText,
      onBack,
      onQueryChange,
    },
    ref,
  ) {
    const listboxId = `${listId}-list`
    return (
      <div className="rong-picker-pane">
        <div className="rong-picker-toolbar" ref={focusReady ? focusSearchInput : undefined}>
          <button
            className="rong-picker-back"
            type="button"
            aria-label={backLabel}
            disabled={backDisabled}
            onClick={onBack}
          >
            <IconChevronLeftOutlineRegular size={18} />
          </button>
          <div className="rong-picker-search">
            <IconSearchOutlineRegular size={16} />
            <input
              ref={ref}
              data-modal-autofocus={autoFocusInput || undefined}
              placeholder="搜索模型…"
              aria-label={searchLabel}
              value={query}
              onChange={(event) => onQueryChange(event.target.value)}
              role="combobox"
              aria-expanded="true"
              aria-controls={listboxId}
              aria-autocomplete="list"
              aria-activedescendant={
                activeIndex >= 0 ? `${listId}-option-${activeIndex}` : undefined
              }
            />
          </div>
        </div>
        <div className="rong-picker-list" role="listbox" id={listboxId} aria-label="模型">
          {groups.map((group) => (
            <div key={group.key} role="group" aria-label={group.label}>
              <div className="rong-picker-provider" title={group.title ?? group.label}>
                {group.label}
              </div>
              {group.items.map((item) => (
                <button
                  ref={item.highlighted ? scrollNearest : undefined}
                  key={item.key}
                  type="button"
                  role="option"
                  id={`${listId}-option-${item.index}`}
                  tabIndex={-1}
                  data-highlighted={item.highlighted || undefined}
                  aria-selected={item.selected}
                  aria-label={item.ariaLabel}
                  aria-disabled={item.disabled || item.busy || undefined}
                  aria-busy={item.busy || undefined}
                  disabled={item.disabled}
                  title={item.title ?? item.label}
                  className={clsx('rong-picker-option')}
                  onPointerMove={() => {
                    if (!item.disabled) item.onHighlight()
                  }}
                  onClick={(event) => {
                    if (item.disabled || item.busy) {
                      event.preventDefault()
                      return
                    }
                    item.onSelect()
                  }}
                >
                  <span className="rong-truncate">{item.label}</span>
                  {item.selected && <IconCheckOutlineRegular size={18} />}
                </button>
              ))}
            </div>
          ))}
          {!hasItems && <p className="rong-picker-empty">{emptyText}</p>}
        </div>
      </div>
    )
  },
)
