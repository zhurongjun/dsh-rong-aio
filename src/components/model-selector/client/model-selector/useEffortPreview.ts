/** 档位展示的唯一投影：同路由待确认操作、拖动预览、宿主已确认值依次取值。 */

import { useStore } from 'zustand'
import type { SelectorStore } from './selector-store.ts'

/** 只订阅最终 effort ID；无关菜单、请求和 Toast 更新不会刷新档位视图。 */
export function useEffortPreview(store: SelectorStore, routeKey: string, selected?: string) {
  return useStore(store, (state) => {
    if (state.operation?.routeKey === routeKey && state.operation.kind !== 'model')
      return state.operation.effort ?? selected
    return state.preview?.routeKey === routeKey ? state.preview.effort : selected
  })
}
