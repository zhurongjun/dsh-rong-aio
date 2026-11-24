/** 模型列表视图：按提供商分组，通过通用分组搜索列表呈现实体目录。 */

import { forwardRef } from 'react'
import { useStore } from 'zustand'
import type {
  ModelCatalogModel,
  ModelProviderGroup,
  ModelSelection,
} from '@deepseek-ai/dsh-api-session-controller/types'
import type { ModelDirectoryState } from '@deepseek-ai/dsh-client-ui-model-selection/client'
import { ModelPickerList } from '../../../client/ModelPickerList.tsx'
import type { SelectorStore } from './selector-store.ts'

interface Props {
  store: SelectorStore
  groups: { group: ModelProviderGroup; offset: number }[]
  rowCount: number
  query: string
  current: ModelSelection | null
  busy: boolean
  locked: boolean
  hasModel: boolean
  focusReady?: boolean
  status: ModelDirectoryState['status']
  id: string
  chooseModel(provider: string, model: ModelCatalogModel): Promise<void>
}

/** 分组模型列表；ref 指向搜索框，焦点和整体键盘移动由外层选择器协调。 */
export const ModelList = forwardRef<HTMLInputElement, Props>(function ModelList(
  {
    store,
    groups,
    rowCount,
    query,
    current,
    busy,
    locked,
    hasModel,
    focusReady,
    status,
    id,
    chooseModel,
  },
  ref,
) {
  const highlight = useStore(store, (state) => state.highlight)
  const actions = store.getState().actions
  const pickerGroups = groups.map(({ group, offset }) => ({
    key: group.id,
    label: group.name,
    items: group.models.map((entry, modelIndex) => {
      const rowIndex = offset + modelIndex
      return {
        key: entry.id,
        index: rowIndex,
        label: entry.name,
        selected: current?.provider === group.id && current.model === entry.id,
        disabled: locked,
        busy,
        highlighted: rowIndex === highlight,
        onHighlight: () => actions.highlight(rowIndex),
        onSelect: () => void chooseModel(group.id, entry),
      }
    }),
  }))

  return (
    <ModelPickerList
      ref={ref}
      listId={id}
      groups={pickerGroups}
      hasItems={rowCount > 0}
      activeIndex={highlight < rowCount ? highlight : -1}
      query={query}
      searchLabel="搜索模型"
      backLabel="返回强度选择"
      backDisabled={!hasModel}
      focusReady={focusReady}
      emptyText={status === 'loading' ? '正在加载模型…' : query ? '没有匹配的模型' : '暂无可用模型'}
      onBack={() => actions.setPane('effort')}
      onQueryChange={(next) => actions.search(next)}
    />
  )
})
