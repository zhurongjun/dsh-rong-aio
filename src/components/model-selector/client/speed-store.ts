/** Fast 请求状态与视图订阅：按完整会话/模型路由隔离读取与保存，拒绝迟到响应和重复提交。 */

import { useStore } from 'zustand'
import { useShallow } from 'zustand/react/shallow'
import { createStore } from 'zustand/vanilla'
import { requestJson } from '../../../client/http.ts'
import { createAbortScope, isAbortError } from '../../../client/store.ts'
import { errorMessage } from '../../../shared/error.ts'
import {
  SPEED_LABELS,
  speedKey,
  type SpeedIdentity,
  type SpeedMode,
  type SpeedState,
} from '../shared/speed.ts'

/** 未取得本路由有效数据时的保守显示值：标准档且无可交互能力。 */
export const EMPTY_SPEED: SpeedState = { mode: 'standard', modes: [] }

async function requestSpeed(
  identity: SpeedIdentity,
  signal: AbortSignal,
  mode?: SpeedMode,
): Promise<SpeedState> {
  const route = `api/rong-aio.speed?${new URLSearchParams({ ...identity })}`
  const value = await requestJson<SpeedState>(route, {
    ...(mode ? { method: 'POST', body: { ...identity, mode } } : {}),
    signal,
    fallbackError: '无法保存速度设置',
  })
  if (
    !Array.isArray(value.modes) ||
    !value.modes.every((item) => item in SPEED_LABELS) ||
    !(value.mode in SPEED_LABELS)
  ) {
    throw new Error('速度接口响应无效')
  }
  return value
}

/** 速度的已确认快照与请求状态；路由更换会清空之前的接收标记。 */
export interface State {
  key: string
  value: SpeedState
  received: boolean
  loading: boolean
  saving: boolean
}

/** 请求与组件生命周期分离；AbortController 留在请求作用域闭包内。 */
export function createSpeedStore(onError: (message: string) => void) {
  const store = createStore<State>(() => ({
    key: '',
    value: EMPTY_SPEED,
    received: false,
    loading: false,
    saving: false,
  }))
  const scope = createAbortScope()
  let identity: SpeedIdentity | undefined
  let writing = false

  const report = (error: unknown) => onError(errorMessage(error, '无法保存速度设置'))

  const dispose = () => {
    scope.abortAll()
    writing = false
    identity = undefined
  }

  return Object.assign(store, {
    sync(next: SpeedIdentity | undefined, open: boolean) {
      const key = next ? speedKey(next) : ''
      if (key !== store.getState().key) {
        dispose()
        store.setState({
          key,
          value: EMPTY_SPEED,
          received: false,
          saving: false,
        })
      }
      identity = next

      const shouldRead = !!next && !writing && (open || !store.getState().received)
      store.setState({ loading: shouldRead, saving: writing })
      if (!next || !shouldRead) {
        scope.latest().abort()
        return () => {}
      }
      const req = scope.latest()
      void requestSpeed(next, req.signal)
        .then((value) => {
          if (!req.isCurrent()) return
          store.setState({
            value: { ...value, modes: [...value.modes] },
            received: true,
          })
        })
        .catch((error: unknown) => {
          if (req.isCurrent() && !isAbortError(error)) report(error)
        })
        .finally(() => {
          if (req.isCurrent()) store.setState({ loading: false })
          req.finish()
        })
      return req.abort
    },

    async select(key: string, mode: SpeedMode) {
      const snapshot = store.getState()
      if (
        !identity ||
        key !== snapshot.key ||
        !snapshot.received ||
        snapshot.loading ||
        writing ||
        !snapshot.value.modes.includes(mode) ||
        mode === snapshot.value.mode
      ) {
        return
      }
      const activeIdentity = identity
      writing = true
      store.setState({ saving: true })
      try {
        await scope.run(async (signal) => {
          const value = await requestSpeed(activeIdentity, signal, mode)
          if (!signal.aborted) {
            store.setState({ value: { ...value, modes: [...value.modes] } })
          }
        })
      } catch (error) {
        if (!isAbortError(error)) report(error)
      } finally {
        writing = false
        store.setState({ saving: false })
      }
    },
    dispose,
  })
}

export type SpeedStore = ReturnType<typeof createSpeedStore>

/** 在订阅时按路由屏蔽旧状态，不等待 effect 清理，避免模型切换闪现旧图标。 */
export function useSpeedSelection(store: SpeedStore, key: string) {
  const view = useStore(
    store,
    useShallow((state) => ({
      state: state.key === key ? state.value : EMPTY_SPEED,
      loading: !!key && (state.key !== key || !state.received || state.loading),
      saving: state.key === key && state.saving,
    })),
  )
  return { ...view, select: (mode: SpeedMode) => store.select(key, mode) }
}
