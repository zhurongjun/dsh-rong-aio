/** Fast 请求状态：按完整会话/模型路由隔离读取与保存，拒绝迟到响应和重复提交。 */

import { createStore } from 'zustand/vanilla'
import { requestJson } from '../../../../client/http.ts'
import { errorMessage } from '../../../../shared/error.ts'
import {
  SPEED_LABELS,
  speedKey,
  type SpeedIdentity,
  type SpeedMode,
  type SpeedState,
} from '../../shared/speed.ts'

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

/** 请求与组件生命周期分离；AbortController 留在闭包内。 */
export function createSpeedStore(onError: (message: string) => void) {
  const store = createStore<State>(() => ({
    key: '',
    value: EMPTY_SPEED,
    received: false,
    loading: false,
    saving: false,
  }))
  let identity: SpeedIdentity | undefined
  let reading: AbortController | undefined
  let writing: AbortController | undefined

  const report = (error: unknown) => onError(errorMessage(error, '无法保存速度设置'))

  const dispose = () => {
    reading?.abort()
    writing?.abort()
    reading = undefined
    writing = undefined
    identity = undefined
  }

  return Object.assign(store, {
    sync(next: SpeedIdentity | undefined, open: boolean) {
      const key = next ? speedKey(next) : ''
      reading?.abort()
      reading = undefined
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
      store.setState({ loading: shouldRead, saving: !!writing })
      if (!next || !shouldRead) return () => {}
      const controller = new AbortController()
      reading = controller
      void requestSpeed(next, controller.signal)
        .then((value) => {
          if (controller.signal.aborted) return
          store.setState({
            value: { ...value, modes: [...value.modes] },
            received: true,
          })
        })
        .catch((error: unknown) => {
          if (!controller.signal.aborted) report(error)
        })
        .finally(() => {
          if (reading !== controller) return
          reading = undefined
          if (!controller.signal.aborted) store.setState({ loading: false })
        })
      return () => controller.abort()
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
      const controller = new AbortController()
      writing = controller
      store.setState({ saving: true })
      try {
        const value = await requestSpeed(identity, controller.signal, mode)
        if (!controller.signal.aborted) {
          store.setState({ value: { ...value, modes: [...value.modes] } })
        }
      } catch (error) {
        if (!controller.signal.aborted) report(error)
      } finally {
        if (writing === controller) {
          writing = undefined
          if (!controller.signal.aborted) store.setState({ saving: false })
        }
      }
    },
    dispose,
  })
}

export type SpeedStore = ReturnType<typeof createSpeedStore>
