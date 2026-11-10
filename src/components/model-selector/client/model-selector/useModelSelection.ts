/** 模型选择控制器：只读订阅宿主目录，派生当前路由，并串行提交模型、档位和重置。 */

import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import { useStore } from 'zustand'
import type { ModelSelectInjected } from '@deepseek-ai/dsh-client-ui-model-selection/client'
import type {
  ModelCatalogModel,
  ModelSelection,
} from '@deepseek-ai/dsh-api-session-controller/types'
import {
  currentEffortOf,
  currentModelOf,
  effortsOf,
  selectionFor,
} from '../../shared/model-selection.ts'
import type { SelectionOperation, SelectorStore } from './selector-store.ts'

interface Props extends ModelSelectInjected {
  /** 会话实例独立的交互状态；不复制或乐观改写宿主 current。 */
  store: SelectorStore
  /** 宿主会话锁，具有最高交互优先级。 */
  locked: boolean
}

/** 请求完成才释放待确认预览；关闭面板不取消宿主操作，卸载后不投递迟到结果。 */
export function useModelSelection({ directory, select, load, available, locked, store }: Props) {
  const actions = store.getState().actions
  const operation = useStore(store, (state) => state.operation)
  const source = useMemo(
    () => ({
      subscribe: (notify: () => void) => directory.subscribe(notify),
      getSnapshot: () => directory.getSnapshot(),
    }),
    [directory],
  )
  const state = useSyncExternalStore(source.subscribe, source.getSnapshot)
  const current = state.current
  const model = useMemo(
    () => currentModelOf(state.groups, current),
    [state.groups, current?.provider, current?.model],
  )
  const efforts = useMemo(() => effortsOf(model), [model])
  const selected = useMemo(() => currentEffortOf(model, current), [model, current?.reasoningEffort])
  const routeKey = useMemo(
    () => JSON.stringify([current?.provider, current?.model, efforts.map((entry) => entry.id)]),
    [current?.provider, current?.model, efforts],
  )
  const alive = useRef(true)
  const lastAction = useRef<'load' | 'select'>('load')

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])
  useEffect(() => () => actions.preview(routeKey, undefined), [actions, routeKey])

  /** 保存期间重开面板复用当前目录，避免并发 load 改写请求阶段与拒绝错误的归属。 */
  const refresh = useCallback(() => {
    if (store.getState().operation || directory.getSnapshot().pending !== null) return
    lastAction.current = 'load'
    load()
  }, [store, directory, load])

  /** 提交前同时核对宿主 pending 与本实例操作，拒绝或异常只通知一次且保留 current。 */
  const submit = useCallback(
    async (selection: ModelSelection, kind: SelectionOperation['kind']) => {
      if (!available || locked || directory.getSnapshot().pending !== null) return false
      const id = actions.startSelection({
        kind,
        routeKey,
        effort: kind === 'model' ? undefined : selection.reasoningEffort,
      })
      if (id === null) return false
      lastAction.current = 'select'
      try {
        const result = await select(selection)
        if (!result?.ok) throw new Error(result ? result.error.message : '当前会话无法切换模型')
        return true
      } catch (reason) {
        if (alive.current)
          actions.reportError(reason instanceof Error ? reason.message : '保存失败，请重试')
        return false
      } finally {
        if (alive.current) actions.finishSelection(id)
      }
    },
    [available, locked, directory, actions, routeKey, select],
  )

  /** 相同档位只结束手势；合法新档位与 Reset 共享提交及预览流程。 */
  const chooseEffort = useCallback(
    async (value: string, kind: 'effort' | 'reset' = 'effort'): Promise<boolean> => {
      try {
        if (!current || !efforts.some((entry) => entry.id === value)) return false
        if (current.reasoningEffort === value) return true
        return await submit(
          { provider: current.provider, model: current.model, reasoningEffort: value },
          kind,
        )
      } finally {
        if (alive.current) actions.preview(routeKey, undefined)
      }
    },
    [current, efforts, submit, actions, routeKey],
  )

  /** 模型成功后回到强度面板；失败不提前显示候选模型或其 Fast 状态。 */
  const chooseModel = useCallback(
    async (provider: string, next: ModelCatalogModel) => {
      const result = await submit(selectionFor(provider, next), 'model')
      if (result && alive.current) actions.setPane('effort')
    },
    [submit, actions],
  )
  const preview = useCallback(
    (effort: string | undefined) => actions.preview(routeKey, effort),
    [actions, routeKey],
  )

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
    visibleError: lastAction.current === 'load' ? state.error : null,
  }
}
