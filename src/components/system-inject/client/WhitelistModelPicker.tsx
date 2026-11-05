/** 待授权模型菜单：只返回精确路由，不调用会话选模或模型选择器组件。 */

import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type RefObject,
} from 'react'
import { createPortal } from 'react-dom'
import {
  Button,
  IconCheckOutlineRegular,
  IconChevronLeftOutlineRegular,
  IconSearchOutlineRegular,
  MenuSurface,
  useAnchoredPosition,
  useDismissOnOutsidePointer,
  useModalLayer,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { CatalogRoute, Route } from '../shared/protocol.ts'
import { matchingRoutes, modelLabel, providerLabel, routeKey } from './whitelist-models.ts'

/** 只选择待授权路由，不调用会话选模服务。浮层定位、模态层级及焦点恢复交给 DSH。 */
export function WhitelistModelPicker({
  anchor,
  routes,
  whitelist,
  disabled,
  onClose,
  onSelect,
}: {
  /** 新增按钮锚点，用于菜单定位及关闭后的焦点恢复。 */
  anchor: RefObject<HTMLButtonElement>

  /** 宿主公开模型目录，仅用于待授权选项。 */
  routes: CatalogRoute[]

  /** 已授权精确路由，匹配选项置灰且方向键跳过。 */
  whitelist: Route[]

  /** 设置保存期间禁止再次提交新增。 */
  disabled: boolean

  /** 关闭新增菜单，由外层释放菜单实例。 */
  onClose: () => void

  /** 只返回 provider/model，不执行会话模型切换。 */
  onSelect: (route: Route) => void
}) {
  const panel = useRef<HTMLDivElement>(null)
  const search = useRef<HTMLInputElement>(null)
  const id = useId()
  const [query, setQuery] = useState('')
  const [highlight, setHighlight] = useState<string>()

  // 身份、搜索和分组都由公开目录派生；显示名称绝不作为授权键。
  const authorized = useMemo(() => new Set(whitelist.map(routeKey)), [whitelist])
  const matches = useMemo(() => matchingRoutes(routes, query), [routes, query])
  const groups = useMemo(() => {
    const result = new Map<string, { name: string; models: CatalogRoute[] }>()
    for (const route of matches) {
      const group = result.get(route.provider)
      if (group) group.models.push(route)
      else result.set(route.provider, { name: providerLabel(route), models: [route] })
    }
    return [...result]
  }, [matches])
  const enabled = matches.filter((route) => !authorized.has(routeKey(route)))
  const active = enabled.find((route) => routeKey(route) === highlight) ?? enabled[0]
  const activeIndex = active ? matches.indexOf(active) : -1

  // 官方定位和模态层负责可见性与焦点；首帧未定位时不抢焦点。
  const position = useAnchoredPosition({
    open: true,
    anchorRef: anchor,
    panelRef: panel,
    side: 'bottom',
    align: 'end',
    gap: 8,
    margin: 12,
  })
  useDismissOnOutsidePointer(anchor, true, onClose, panel)

  // 首帧等待定位时 visibility:hidden；此时聚焦会被浏览器忽略，必须等可见后注册焦点层。
  useModalLayer(panel, position !== null, onClose)
  useEffect(() => {
    if (activeIndex >= 0)
      panel.current
        ?.querySelector(`[data-route-index="${activeIndex}"]`)
        ?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex])

  /** 忽略已授权或禁用项；先收起浮层，再提交精确路由，保存结果由外层接受。 */
  const select = (route: CatalogRoute) => {
    if (disabled || authorized.has(routeKey(route))) return

    // 先收起浮层，再提交；保存失败由设置页呈现，不能遮住错误或提前显示已授权。
    onClose()
    onSelect({ provider: route.provider, model: route.model })
  }

  /** 跳过中文输入法与组合快捷键；方向键只遍历可新增项，Enter 选择，Tab 约束焦点。 */
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.nativeEvent.isComposing || event.ctrlKey || event.metaKey || event.altKey) return
    if (['ArrowDown', 'ArrowUp'].includes(event.key)) {
      event.preventDefault()
      const index = active ? enabled.indexOf(active) : -1
      const next = enabled.length
        ? enabled[(index + (event.key === 'ArrowDown' ? 1 : -1) + enabled.length) % enabled.length]
        : undefined
      setHighlight(next ? routeKey(next) : undefined)
      search.current?.focus({ preventScroll: true })
    } else if (event.key === 'Enter' && event.target === search.current) {
      event.preventDefault()
      if (active) select(active)
    } else if (event.key === 'Tab') {
      // 与模型选择器一致：选项由方向键遍历，Tab 只走返回键和搜索框。
      const controls = [
        ...(panel.current?.querySelectorAll<HTMLElement>('button,input') ?? []),
      ].filter((item) => item.tabIndex >= 0)
      const target = event.shiftKey ? controls.at(-1) : controls[0]
      const edge = event.shiftKey ? controls[0] : controls.at(-1)
      if (event.target === edge) {
        event.preventDefault()
        target?.focus()
      }
    }
  }

  return createPortal(
    <MenuSurface
      ref={panel}
      className="rong-inject-model-picker"
      role="dialog"
      aria-modal="true"
      aria-label="新增白名单模型"
      onKeyDown={onKeyDown}
      style={position ?? { visibility: 'hidden' }}
    >
      <div className="rong-inject-picker-content">
        <div className="rong-inject-picker-toolbar">
          <Button
            size="sm"
            className="rong-inject-picker-back"
            icon={<IconChevronLeftOutlineRegular size={18} />}
            aria-label="返回模型白名单"
            onClick={onClose}
          />
          <div className="rong-inject-picker-search">
            <IconSearchOutlineRegular size={16} />
            <input
              ref={search}
              data-modal-autofocus
              placeholder="搜索模型…"
              aria-label="搜索可添加模型"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value)
                setHighlight(undefined)
              }}
              role="combobox"
              aria-expanded="true"
              aria-controls={`${id}-list`}
              aria-autocomplete="list"
              aria-activedescendant={activeIndex >= 0 ? `${id}-option-${activeIndex}` : undefined}
            />
          </div>
        </div>
        <div className="rong-inject-picker-list" role="listbox" id={`${id}-list`} aria-label="模型">
          {groups.map(([provider, group]) => (
            <div key={provider} role="group" aria-label={group.name}>
              <div className="rong-inject-picker-provider" title={provider}>
                {group.name}
              </div>
              {group.models.map((route) => {
                const key = routeKey(route)
                const index = matches.indexOf(route)
                const added = authorized.has(key)
                return (
                  <button
                    type="button"
                    role="option"
                    key={key}
                    id={`${id}-option-${index}`}
                    tabIndex={-1}
                    data-route-index={index}
                    data-highlighted={(index === activeIndex && !disabled) || undefined}
                    aria-selected={added}
                    aria-label={`${modelLabel(route)}${added ? '，已添加' : ''}`}
                    disabled={disabled || added}
                    className="rong-inject-picker-option"
                    title={`${route.provider} / ${route.model}${added ? ' · 已添加' : ''}`}
                    onPointerMove={() => {
                      if (!added) setHighlight(key)
                    }}
                    onClick={() => select(route)}
                  >
                    <span>{modelLabel(route)}</span>
                    {added && <IconCheckOutlineRegular size={18} />}
                  </button>
                )
              })}
            </div>
          ))}
          {!matches.length && (
            <p className="rong-inject-picker-empty">{query ? '没有匹配的模型' : '暂无可用模型'}</p>
          )}
        </div>
      </div>
    </MenuSurface>,
    document.body,
  )
}
