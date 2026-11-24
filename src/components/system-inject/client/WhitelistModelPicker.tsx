import { useId, useRef, useState, type KeyboardEvent, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { useStore } from 'zustand'
import {
  MenuSurface,
  useDismissOnOutsidePointer,
  useModalLayer,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { createAnchoredPopover } from '../../../client/anchored-popover.ts'
import {
  handlePickerKeyDown,
  ModelPickerList,
  type ModelPickerGroup,
} from '../../../client/ModelPickerList.tsx'
import type { CatalogRoute, Route } from '../shared/protocol.ts'
import { matchingRoutes, modelLabel, providerLabel, routeKey } from './Whitelist.tsx'

export function WhitelistModelPicker({
  anchor,
  routes,
  whitelist,
  disabled,
  onClose,
  onSelect,
}: {
  anchor: RefObject<HTMLButtonElement>
  routes: CatalogRoute[]
  whitelist: Route[]
  disabled: boolean
  onClose: () => void
  onSelect: (route: Route) => void
}) {
  const panel = useRef<HTMLDivElement | null>(null)
  const [popover] = useState(() => createAnchoredPopover({ placement: 'below-end' }))
  const position = useStore(popover.store, (state) => state.position)
  const search = useRef<HTMLInputElement>(null)
  const id = useId()
  const [query, setQuery] = useState('')
  const [highlight, setHighlight] = useState<string>()

  const authorized = new Set(whitelist.map(routeKey))
  const matches = matchingRoutes(routes, query)
  const indexed = matches.map((route, index) => {
    const key = routeKey(route)
    return { route, index, key, added: authorized.has(key) }
  })
  const enabled = indexed.filter((item) => !item.added)
  const active = enabled.find((item) => item.key === highlight) ?? enabled[0]
  const activeIndex = active?.index ?? -1

  const select = (route: CatalogRoute) => {
    if (disabled || authorized.has(routeKey(route))) return
    onClose()
    onSelect({ provider: route.provider, model: route.model })
  }

  const groupMap = new Map<string, ModelPickerGroup>()
  for (const { route, index, key, added } of indexed) {
    let group = groupMap.get(route.provider)
    if (!group) {
      group = {
        key: route.provider,
        label: providerLabel(route),
        title: route.provider,
        items: [],
      }
      groupMap.set(route.provider, group)
    }
    group.items.push({
      key,
      index,
      label: modelLabel(route),
      ariaLabel: `${modelLabel(route)}${added ? '，已添加' : ''}`,
      title: `${route.provider} / ${route.model}${added ? ' · 已添加' : ''}`,
      selected: added,
      disabled: disabled || added,
      highlighted: index === activeIndex && !disabled,
      onHighlight: () => setHighlight(key),
      onSelect: () => select(route),
    })
  }
  const groups = [...groupMap.values()]

  useDismissOnOutsidePointer(anchor, true, onClose, panel)
  useModalLayer(panel, position !== null, onClose)

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    handlePickerKeyDown(event, {
      container: panel.current,
      searchInput: search.current,
      onStepHighlight: (delta) => {
        const index = active ? enabled.indexOf(active) : -1
        const next = enabled.length
          ? enabled[(index + delta + enabled.length) % enabled.length]
          : undefined
        setHighlight(next ? next.key : undefined)
      },
      onConfirm: () => {
        if (active) select(active.route)
      },
    })
  }

  const bindSurface = (node: HTMLDivElement | null) => {
    panel.current = node
    popover.bindAnchor(anchor.current)
    popover.bindSurface(node)
  }

  return createPortal(
    <MenuSurface
      ref={bindSurface}
      className="rong-popover-surface rong-picker-popover"
      role="dialog"
      aria-modal="true"
      aria-hidden={position === null || undefined}
      aria-label="新增白名单模型"
      onKeyDown={onKeyDown}
      style={position ?? { visibility: 'hidden' }}
    >
      <ModelPickerList
        ref={search}
        listId={id}
        groups={groups}
        hasItems={matches.length > 0}
        activeIndex={activeIndex}
        query={query}
        searchLabel="搜索可添加模型"
        backLabel="返回模型白名单"
        autoFocusInput
        emptyText={query ? '没有匹配的模型' : '暂无可用模型'}
        onBack={onClose}
        onQueryChange={(next) => {
          setQuery(next)
          setHighlight(undefined)
        }}
      />
    </MenuSurface>,
    document.body,
  )
}
