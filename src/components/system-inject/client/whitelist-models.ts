/** 白名单展示的纯工具：无歧义路由键、名称回退及多词搜索。 */

import type { CatalogRoute, Route } from '../shared/protocol.ts'

/** 不拼接可歧义分隔符；同名模型在不同提供商下仍是两个独立授权。 */
export const routeKey = (route: Route) => JSON.stringify([route.provider, route.model])

/** 优先使用目录显示名，失联或缺失时保持原始 model 标识可读。 */
export const modelLabel = (route: CatalogRoute) => route.modelName || route.model

/** 优先使用提供商展示名；目录不可用不隐藏仍存在的授权条目。 */
export const providerLabel = (route: CatalogRoute) => route.providerName || route.provider

/** 与模型选择器保持多词、大小写无关的搜索语义，同时匹配显示名和精确标识。 */
export function matchingRoutes(routes: CatalogRoute[], query: string) {
  const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean)
  return routes.filter((route) => {
    const text = [route.provider, route.model, providerLabel(route), modelLabel(route)]
      .join(' ')
      .toLocaleLowerCase()
    return words.every((word) => text.includes(word))
  })
}
