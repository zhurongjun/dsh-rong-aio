/** 模型选择器浮层键盘导航纯函数：Escape 返回/关闭、方向键高亮、Enter 提交与 Tab 循环。 */

import type { KeyboardEvent, RefObject } from 'react'
import type {
  ModelCatalogModel,
  ModelProviderGroup,
} from '@deepseek-ai/dsh-api-session-controller/types'
import type { SelectorStore } from './selector-store.ts'

interface KeyboardOptions {
  store: SelectorStore
  pane: 'effort' | 'models'
  hasModel: boolean
  busy: boolean
  rows: { group: ModelProviderGroup; model: ModelCatalogModel }[]
  menu: HTMLDivElement | null
  search: RefObject<HTMLInputElement | null>
  close: (restoreFocus?: boolean) => void
  chooseModel: (provider: string, model: ModelCatalogModel) => Promise<void>
}

export function handlePopoverKeyDown(
  event: KeyboardEvent<HTMLDivElement>,
  { store, pane, hasModel, busy, rows, menu, search, close, chooseModel }: KeyboardOptions,
) {
  if (event.nativeEvent.isComposing) return
  const actions = store.getState().actions
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    if (pane === 'models' && hasModel) actions.setPane('effort')
    else close(true)
  }
  if (pane === 'models' && ['ArrowDown', 'ArrowUp'].includes(event.key)) {
    event.preventDefault()
    const value = store.getState().highlight
    actions.highlight(
      rows.length ? (value + (event.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length : 0,
    )
    search.current?.focus({ preventScroll: true })
  }
  if (pane === 'models' && event.target === search.current && event.key === 'Enter') {
    event.preventDefault()
    const row = rows[store.getState().highlight]
    if (row && !busy) void chooseModel(row.group.id, row.model)
  }
  if (event.key === 'Tab') {
    const controls = Array.from(
      menu?.querySelectorAll<HTMLElement>('button:not(:disabled),input,[tabindex="0"]') ?? [],
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
}
