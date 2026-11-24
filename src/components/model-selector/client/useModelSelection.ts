/** 模型选择控制器：只读订阅宿主目录，派生当前路由，并串行提交模型、档位和重置。 */

import { useSyncExternalStore } from 'react'
import { useStore } from 'zustand'
import type { ModelSelectInjected } from '@deepseek-ai/dsh-client-ui-model-selection/client'
import type {
  ModelCatalogModel,
  ModelSelection,
} from '@deepseek-ai/dsh-api-session-controller/types'
import { errorMessage } from '../../../shared/error.ts'
import {
  currentEffortOf,
  currentModelOf,
  effortsOf,
  selectionFor,
} from '../shared/model-selection.ts'
import type { SelectionOperation } from './selector-store.ts'
import type { SelectorSession } from './selector-session.ts'

interface Props extends Omit<ModelSelectInjected, 'resolveText'> {
  session: SelectorSession
  locked: boolean
}

/** 请求完成才释放待确认预览；关闭面板不取消宿主操作，卸载后不投递迟到结果。 */
export function useModelSelection({ directory, select, load, available, locked, session }: Props) {
  const store = session.selectorStore
  const actions = store.getState().actions
  const operation = useStore(store, (state) => state.operation)
  const errorSource = useStore(store, (state) => state.errorSource)
  const state = useSyncExternalStore(
    session.directorySource.subscribe,
    session.directorySource.getSnapshot,
  )
  const current = state.current
  const model = currentModelOf(state.groups, current)
  const efforts = effortsOf(model)
  const selected = currentEffortOf(model, current)
  const routeKey = JSON.stringify([current?.provider, current?.model, efforts.map((e) => e.id)])

  const refresh = () => {
    if (store.getState().operation || directory.getSnapshot().pending !== null) return
    actions.startLoad()
    load()
  }

  const submit = async (selection: ModelSelection, kind: SelectionOperation['kind']) => {
    if (!available || locked || directory.getSnapshot().pending !== null) return false
    const id = actions.startSelection({
      kind,
      routeKey,
      effort: kind === 'model' ? undefined : selection.reasoningEffort,
    })
    if (id === null) return false
    try {
      const result = await select(selection)
      if (!result?.ok) throw new Error(result ? result.error.message : '当前会话无法切换模型')
      return true
    } catch (reason) {
      if (session.isMounted()) actions.reportError(errorMessage(reason, '保存失败，请重试'))
      return false
    } finally {
      if (session.isMounted()) actions.finishSelection(id)
    }
  }

  const chooseEffort = async (
    value: string,
    kind: 'effort' | 'reset' = 'effort',
  ): Promise<boolean> => {
    try {
      if (!current || !efforts.some((entry) => entry.id === value)) return false
      if (current.reasoningEffort === value) return true
      return await submit(
        { provider: current.provider, model: current.model, reasoningEffort: value },
        kind,
      )
    } finally {
      if (session.isMounted()) actions.preview(routeKey, undefined)
    }
  }

  const chooseModel = async (provider: string, next: ModelCatalogModel) => {
    const result = await submit(selectionFor(provider, next), 'model')
    if (result && session.isMounted()) actions.setPane('effort')
  }

  const preview = (effort: string | undefined) => actions.preview(routeKey, effort)

  return {
    state,
    current,
    model,
    efforts,
    selected,
    routeKey,
    chooseEffort,
    chooseModel,
    preview,
    refresh,
    selecting: operation !== null || state.pending !== null,
    visibleError: errorSource === 'load' ? state.error : null,
  }
}
