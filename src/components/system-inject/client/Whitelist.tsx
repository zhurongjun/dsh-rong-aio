import { useMemo, useRef, useState } from 'react'
import {
  Button,
  IconPlusOutlineRegular,
  IconSearchOutlineRegular,
  IconTrashOutlineRegular,
  Input,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { CatalogRoute, Route } from '../shared/protocol.ts'
import { WhitelistModelPicker } from './WhitelistModelPicker.tsx'
import { matchingRoutes, modelLabel, providerLabel, routeKey } from './whitelist-models.ts'

/** 白名单只维护精确路由；目录失联时保留已有卡片，用原始标识回退显示。 */
export function Whitelist({
  whitelist,
  routes,
  catalogErrors,
  disabled,
  onAdd,
  onRemove,
}: {
  whitelist: Route[]
  routes: CatalogRoute[]
  catalogErrors: string[]
  disabled: boolean
  onAdd: (route: Route) => void
  onRemove: (route: Route) => void
}) {
  const [query, setQuery] = useState('')
  const [picking, setPicking] = useState(false)
  const anchor = useRef<HTMLButtonElement>(null)
  const catalog = useMemo(() => new Map(routes.map((route) => [routeKey(route), route])), [routes])
  const cards = matchingRoutes(
    whitelist.map((route) => catalog.get(routeKey(route)) ?? route),
    query,
  )
  return (
    <>
      <div className="rong-inject-toolbar">
        <Input
          type="search"
          aria-label="搜索白名单"
          placeholder="搜索模型或提供商"
          icon={<IconSearchOutlineRegular />}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <Button
          ref={anchor}
          size="sm"
          variant="primary"
          icon={<IconPlusOutlineRegular />}
          disabled={disabled}
          aria-haspopup="dialog"
          aria-expanded={picking}
          onClick={() => setPicking(!picking)}
        >
          新增
        </Button>
      </div>
      {!!catalogErrors.length && (
        <div className="rong-inject-error" role="status">
          {catalogErrors.join('；')}
        </div>
      )}
      {cards.length ? (
        <ul className="rong-inject-whitelist-grid" aria-label="已授权模型">
          {cards.map((route) => (
            <li className="rong-inject-whitelist-card" key={routeKey(route)}>
              <span className="rong-inject-whitelist-info">
                <strong title={route.model}>{modelLabel(route)}</strong>
                <small title={route.provider}>{providerLabel(route)}</small>
              </span>
              <Button
                size="sm"
                className="rong-inject-whitelist-remove"
                icon={<IconTrashOutlineRegular size={16} />}
                disabled={disabled}
                aria-label={`删除 ${modelLabel(route)}（${providerLabel(route)}）的授权`}
                title="删除授权"
                onClick={() => onRemove({ provider: route.provider, model: route.model })}
              />
            </li>
          ))}
        </ul>
      ) : (
        <p className="rong-inject-muted" role="status">
          {whitelist.length ? '没有匹配的已授权模型' : '尚未授权任何模型，点击新增选择。'}
        </p>
      )}
      <p className="rong-inject-muted">
        全局生效，按提供商与模型精确匹配。实际发送时校验，携带破甲正文的压缩请求也需要授权。
      </p>
      {picking && (
        <WhitelistModelPicker
          anchor={anchor}
          routes={routes}
          whitelist={whitelist}
          disabled={disabled}
          onClose={() => setPicking(false)}
          onSelect={onAdd}
        />
      )}
    </>
  )
}
